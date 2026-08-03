/**
 * Import halls from the legacy MaxiTicket system into venues / seat_maps / seats.
 *
 * Input is the export directory: one subdirectory per hall, each holding a
 * `hall.json` (485 of them in the reference export). Imported halls land in the
 * shared venue library — organizer_id null, is_public true — so every organizer
 * can pick them and nobody can edit them (see 20260803114741_shared_venue_library).
 *
 * Run (dry run, no DB needed):
 *   node scripts/import-halls.ts ~/maxiticket-export-hall
 * Write:
 *   node --env-file=~/ticketio-secrets.env scripts/import-halls.ts ~/maxiticket-export-hall --commit
 *
 * The source model, and what this does with it:
 *
 *   seats[] {ts, x, y, c, n, l1, l2}   ts = source seat id, c = category,
 *                                      l1 = sector (loc1), n = seat number
 *   elements[] {t, x, y, w, h, ang, text}   t: E = stage (imported), T/R/W/D/I/C
 *                                      = decor (left in the source, see
 *                                      ELEMENT_KIND)
 *
 * x/y is the TOP-LEFT corner of a default_seat_width × default_seat_height box,
 * for seats and elements alike; our model stores a seat by its centre, so every
 * seat coordinate is shifted by half a seat on the way in. The `bbox` in the
 * export is cropped and therefore ignored — the canvas is measured from the
 * content itself.
 *
 * Three things in the source do not survive a naive reading:
 *
 *  - Standing areas are encoded as thousands of seats stacked on one coordinate
 *    (hall 3: 4001 seats on a single point). They are NOT reliably marked by
 *    n = 0 — that same hall numbers half of them n = 1 — so they are detected
 *    geometrically, as clusters of >= 10 seats sharing an exact (x, y, l1, c).
 *    Each cluster becomes one `area` object carrying the count as capacity.
 *    Clusters of 2-9 are just overlapping seats and stay seats.
 *  - l2 is the row number in most halls but the TABLE number in ball-room halls,
 *    so it is used as an opaque row label and never parsed as a row index.
 *  - Whole blocks of seats can carry n = 0 (no number at all). Those are
 *    renumbered from their geometry — rows banded across the block's short axis,
 *    seats counted along the long one.
 *
 * (sector, row_label, seat_number) is a unique constraint on `seats`, and the
 * source does not respect it: the same (l2, n) pair can appear several times in
 * one sector, once per physical block. Sectors are therefore split into
 * connected blocks and the row label gets a per-block suffix — but only in the
 * sectors that actually collide, since the sector name is the pricing key in
 * event_sector_pricing and must stay exactly as the hall knows it.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { alphaLabel, LAYOUT_VERSION } from '../src/lib/seating.ts'
import type {
  MapLevel,
  MapObject,
  MapObjectKind,
  SeatMapLayout,
  SectorShape,
} from '../src/lib/seating.ts'

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Seats this dense on one exact coordinate are a standing area, not seats. */
const STANDING_CLUSTER_MIN = 10
/** Rendered seat pitch: every hall is scaled so its median row gap lands here. */
const TARGET_SEAT_GAP = 28
/** Fallback source gap for halls with no measurable row (all-standing halls). */
const FALLBACK_SOURCE_GAP = 16
/** Free space kept around the content on every side of the canvas. */
const CANVAS_PADDING = 40
/** Standing areas have no size in the source; they are drawn at this size. */
const AREA_WIDTH = 260
const AREA_HEIGHT = 160
/** Gap left between de-overlapped area boxes. */
const AREA_GAP = 24
/** Two seats belong to the same block within this multiple of the seat gap. */
const BLOCK_NEIGHBOUR_FACTOR = 1.8
/** Band tolerance when reading rows off geometry, as a multiple of the gap. */
const ROW_BAND_FACTOR = 0.6
/** PostgREST batch size for seat writes. */
const SEAT_BATCH = 1000

/** Column limits from the `seats` table / the editor's validator. */
const MAX_SECTOR_LEN = 60
const MAX_ROW_LEN = 20
const MAX_SEAT_NO_LEN = 20

/** Halls whose name marks them as a template or a scratch layout. */
const TEST_HALL_PATTERN = /maxiticket|nepouž|nepouz|test|vzor/i

/**
 * Source element type -> layout object kind. Only the stage is imported.
 *
 * The export also carries walls (W), doors (D), free text (T), icons (I) and
 * plain shapes (C) — 2210 of them across 307 halls. They are dropped ON PURPOSE.
 * The app's MapObjectKind is 'stage' | 'area' and migrateLayout() folds anything
 * else into 'area', so importing them would put 2210 indigo standing-area
 * rectangles onto maps that are otherwise clean — worse than not having them.
 *
 * TO ADD THEM LATER: when the renderer can draw walls/doors/captions, extend
 * this map (W->'wall', D->'door', T->'text', I->'icon', C->'shape') and re-run
 * the import over the same export. Re-import is idempotent and rewrites the
 * layout in place, so nothing else has to be redone. Note that R (row-number
 * captions) stays out even then — the editor draws row labels from row_label
 * and would print every number twice.
 */
const ELEMENT_KIND: Record<string, MapObjectKind | undefined> = {
  E: 'stage',
}

/** Decoration types the export carries that we knowingly leave behind. */
const SKIPPED_ELEMENT_TYPES = new Set(['W', 'D', 'T', 'I', 'C'])

// ---------------------------------------------------------------------------
// Source shapes (only the fields we rely on; the export carries more)
// ---------------------------------------------------------------------------

interface SourceSeat {
  ts: number
  x: number
  y: number
  c?: number | null
  n: number
  l1: number
  l2: number
  /** Present and false only when the seat is hidden; absent means visible. */
  visible?: boolean | string | number | null
  visible_online?: boolean | string | number | null
}

interface SourceElement {
  t: string
  x: number
  y: number
  w: number
  h: number
  ang?: number | null
  text?: string | null
}

/**
 * Every field is optional on purpose: this describes a JSON file from another
 * system, so the types say what we hope to find, not what is guaranteed. The
 * transform reads defensively throughout and a hall that is missing something
 * essential is reported rather than imported half-formed.
 */
interface SourceHall {
  id_hall_desc?: number | null
  id_hall?: number | null
  hall?: {
    name?: string | null
    hall_Name?: string | null
    street?: string | null
    zip?: string | null
    city?: string | null
    country?: string | null
  } | null
  layout?: {
    name?: string | null
    seat_count?: number | null
    default_seat_width?: number | null
    default_seat_height?: number | null
  } | null
  categories?: Record<string, { name?: string | null } | null> | null
  loc1?: Record<string, { name?: string | null } | null> | null
  seats?: SourceSeat[] | null
  elements?: (SourceElement | null)[] | null
}

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

interface ImportSeat {
  level: string
  level_order: number
  sector: string
  row_label: string
  seat_number: string
  x: number
  y: number
  seat_type: 'standard'
  external_ref: string
}

interface ImportHall {
  sourceId: string
  idHall: number
  venueName: string
  address: string | null
  mapName: string
  venueRef: string
  mapRef: string
  layout: SeatMapLayout
  seats: ImportSeat[]
  /** Diagnostics for the dry-run report. */
  stats: {
    rawSeats: number
    hiddenSeats: number
    standingSeats: number
    areas: number
    standingCapacity: number
    sectors: number
    suffixedSectors: number
    renumberedSeats: number
    stages: number
    /** Decorations left in the source, by element type — see ELEMENT_KIND. */
    skippedDecor: Record<string, number>
    scale: number
    sourceGap: number
    canvas: { width: number; height: number }
  }
  warnings: string[]
  isTestHall: boolean
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Options {
  dir: string
  commit: boolean
  only: Set<string> | null
  includeTestHalls: boolean
  verbose: boolean
}

function parseArgs(argv: string[]): Options {
  let dir = ''
  let commit = false
  let only: Set<string> | null = null
  let includeTestHalls = false
  let verbose = false
  for (const arg of argv) {
    if (arg === '--commit') commit = true
    else if (arg === '--dry-run') commit = false
    else if (arg === '--include-test-halls') includeTestHalls = true
    else if (arg === '--verbose' || arg === '-v') verbose = true
    else if (arg.startsWith('--only=')) {
      only = new Set(
        arg
          .slice('--only='.length)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
    } else if (arg.startsWith('--dir=')) dir = arg.slice('--dir='.length)
    else if (arg.startsWith('-')) {
      fail(`Neznámy prepínač: ${arg}`)
    } else if (!dir) dir = arg
    else fail(`Nadbytočný argument: ${arg}`)
  }
  if (!dir) {
    fail(
      'Chýba adresár s exportom.\n' +
        '  node scripts/import-halls.ts <adresár> [--commit] [--only=1,2] [--include-test-halls] [-v]',
    )
  }
  return { dir, commit, only, includeTestHalls, verbose }
}

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * The export writes a hidden seat as `false`, but older dumps of the same feed
 * use `'0'` / `0`. Anything else — including the field being absent, which is
 * the common case — means visible.
 */
function isHidden(v: unknown): boolean {
  return v === false || v === '0' || v === 0
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function clean(s: unknown): string {
  return typeof s === 'string' ? s.trim() : ''
}

/** Sector names may not start with '#': that prefix keys standing areas. */
function safeSector(name: string): string {
  return name.replace(/^#+/, '').slice(0, MAX_SECTOR_LEN)
}

// ---------------------------------------------------------------------------
// Union-find over a sector's seats
// ---------------------------------------------------------------------------

class DisjointSet {
  private parent: number[]

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i)
  }

  find(a: number): number {
    let root = a
    while (this.parent[root] !== root) root = this.parent[root]
    let cur = a
    while (this.parent[cur] !== root) {
      const next = this.parent[cur]
      this.parent[cur] = root
      cur = next
    }
    return root
  }

  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent[rb] = ra
  }
}

interface WorkSeat {
  ref: string
  sx: number // source centre x
  sy: number // source centre y
  row: string
  seat: string
  /** True when the source gave no number and geometry has to supply one. */
  unnumbered: boolean
  /** Which piece of its row the seat sits in; drives the block suffix. */
  piece: number
}

/**
 * Split a sector's seats into 2D-contiguous blocks. Two seats are neighbours
 * when they are within `BLOCK_NEIGHBOUR_FACTOR` gaps of each other on BOTH
 * axes — the diagonal-only case (corner touching across an aisle) does not
 * connect. Seats are bucketed into a grid first so this stays linear instead of
 * quadratic; the biggest hall in the export has 36k of them.
 */
function findBlocks(seats: WorkSeat[], gap: number): WorkSeat[][] {
  const threshold = gap * BLOCK_NEIGHBOUR_FACTOR
  const dsu = new DisjointSet(seats.length)
  const cells = new Map<string, number[]>()
  const cellOf = (v: number) => Math.floor(v / threshold)

  seats.forEach((s, i) => {
    const key = `${cellOf(s.sx)}:${cellOf(s.sy)}`
    const bucket = cells.get(key)
    if (bucket) bucket.push(i)
    else cells.set(key, [i])
  })

  seats.forEach((s, i) => {
    const cx = cellOf(s.sx)
    const cy = cellOf(s.sy)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of cells.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (j <= i) continue
          const other = seats[j]
          if (
            Math.abs(other.sx - s.sx) <= threshold &&
            Math.abs(other.sy - s.sy) <= threshold
          ) {
            dsu.union(i, j)
          }
        }
      }
    }
  })

  const groups = new Map<number, WorkSeat[]>()
  seats.forEach((s, i) => {
    const root = dsu.find(i)
    const g = groups.get(root)
    if (g) g.push(s)
    else groups.set(root, [s])
  })
  return [...groups.values()]
}

/**
 * Give an unnumbered block row labels and seat numbers from its geometry.
 * Rows are read across the block's short axis (a tall, narrow block is a
 * vertical row of seats, so it bands along x instead of y) and seats are
 * counted along the long one, left to right or top to bottom.
 */
function renumberBlock(block: WorkSeat[], gap: number): void {
  const xs = block.map((s) => s.sx)
  const ys = block.map((s) => s.sy)
  const spanX = Math.max(...xs) - Math.min(...xs)
  const spanY = Math.max(...ys) - Math.min(...ys)
  // Rows run left to right. A block being deeper than it is wide does not
  // change that — an amphitheatre 45 seats across and 100 rows deep is 100 rows
  // of 45, not 45 rows of 100 — so the only case that bands the other way is a
  // block barely wider than a seat: a single column down the side of a gallery.
  const horizontal = !(spanX <= 2 * gap && spanY > spanX)
  const bandOf = (s: WorkSeat) => (horizontal ? s.sy : s.sx)
  const alongOf = (s: WorkSeat) => (horizontal ? s.sx : s.sy)

  const sorted = [...block].sort(
    (a, b) => bandOf(a) - bandOf(b) || alongOf(a) - alongOf(b),
  )
  const tolerance = gap * ROW_BAND_FACTOR
  const bands: WorkSeat[][] = []
  let current: WorkSeat[] = []
  let bandStart = Number.NaN
  for (const s of sorted) {
    if (current.length === 0 || bandOf(s) - bandStart <= tolerance) {
      if (current.length === 0) bandStart = bandOf(s)
      current.push(s)
    } else {
      bands.push(current)
      current = [s]
      bandStart = bandOf(s)
    }
  }
  if (current.length > 0) bands.push(current)

  bands.forEach((band, r) => {
    band
      .sort((a, b) => alongOf(a) - alongOf(b))
      .forEach((s, i) => {
        s.row = String(r + 1)
        s.seat = String(i + 1)
      })
  })
}

/** Centre of mass of a set of seats, used to order and name block suffixes. */
function centreOf(seats: WorkSeat[]): { x: number; y: number } {
  let sx = 0
  let sy = 0
  for (const s of seats) {
    sx += s.sx
    sy += s.sy
  }
  return { x: sx / seats.length, y: sy / seats.length }
}

/**
 * Cut one source row into its physically distinct pieces.
 *
 * A source row — the seats sharing an (l1, l2) — is not always one run of
 * seats, and the two ways it can be more than one are both invisible to the
 * block-level union-find:
 *
 *  - It covers two physical rows. Hall 305 (Amfiteáter Nitra) puts two rows
 *    22 units apart under the same l2, both numbered from 1, and the rows sit
 *    close enough to be one connected block.
 *  - It is numbered from both ends inwards — 1…18 left to right, then 18…1
 *    back out to the right edge — which is how most of these theatres number a
 *    parterre. There is no aisle at the turning point: the seat pitch across it
 *    is the ordinary one, so no geometric rule can find the seam. The numbering
 *    is the only witness.
 *
 * So: band across the row's short axis first (a jump there is a second physical
 * row), then walk each band along its long axis and cut wherever a real gap
 * opens up OR the seat numbers stop running the way they started.
 */
function splitRowPieces(rowSeats: WorkSeat[], gap: number): WorkSeat[][] {
  if (rowSeats.length < 2) return [rowSeats]
  const xs = rowSeats.map((s) => s.sx)
  const ys = rowSeats.map((s) => s.sy)
  const horizontal =
    Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys)
  const along = (s: WorkSeat) => (horizontal ? s.sx : s.sy)
  const perp = (s: WorkSeat) => (horizontal ? s.sy : s.sx)

  // Bands: a smoothly raked or curved row drifts a little between neighbours
  // and stays one band; a second row parallel to the first opens a step.
  const byPerp = [...rowSeats].sort((a, b) => perp(a) - perp(b))
  const bandTolerance = gap * ROW_BAND_FACTOR
  const bands: WorkSeat[][] = []
  let band: WorkSeat[] = []
  let last = Number.NaN
  for (const s of byPerp) {
    if (band.length > 0 && perp(s) - last > bandTolerance) {
      bands.push(band)
      band = []
    }
    band.push(s)
    last = perp(s)
  }
  if (band.length > 0) bands.push(band)

  const gapLimit = gap * BLOCK_NEIGHBOUR_FACTOR
  const pieces: WorkSeat[][] = []
  for (const b of bands) {
    const ordered = [...b].sort((p, q) => along(p) - along(q))
    let piece: WorkSeat[] = []
    // Direction of the numbering in the current piece: +1 rising, -1 falling,
    // 0 until two comparable numbers have been seen.
    let dir = 0
    let prevNum = Number.NaN
    for (const s of ordered) {
      const num = Number(s.seat)
      const numeric = Number.isFinite(num)
      let cut = false
      if (piece.length > 0) {
        if (along(s) - along(piece[piece.length - 1]) > gapLimit) cut = true
        else if (numeric && Number.isFinite(prevNum)) {
          if (dir === 0) cut = num === prevNum
          else cut = dir > 0 ? num <= prevNum : num >= prevNum
        }
      }
      if (cut) {
        pieces.push(piece)
        piece = []
        dir = 0
        prevNum = Number.NaN
      }
      if (
        piece.length > 0 &&
        numeric &&
        Number.isFinite(prevNum) &&
        dir === 0
      ) {
        dir = Math.sign(num - prevNum)
      }
      piece.push(s)
      prevNum = numeric ? num : Number.NaN
    }
    if (piece.length > 0) pieces.push(piece)
  }
  return pieces
}

/**
 * Labels for the distinct row pieces of one colliding sector, keyed by
 * `blockRank:pieceIndex` and returned in that order.
 *
 * Two pieces side by side are the common theatre case and read best as ľavý /
 * pravý; anything else (two stacked, or three and more) gets plain letters. The
 * sector name itself is never touched — it is the pricing key.
 */
function suffixesFor(
  units: { key: string; centre: { x: number; y: number } }[],
): Map<string, string> {
  const out = new Map<string, string>()
  if (units.length === 2) {
    const [a, b] = units
    if (
      Math.abs(a.centre.x - b.centre.x) >= Math.abs(a.centre.y - b.centre.y)
    ) {
      const left = a.centre.x <= b.centre.x ? a : b
      const right = left === a ? b : a
      out.set(left.key, '-L')
      out.set(right.key, '-P')
      return out
    }
  }
  units.forEach((u, i) => out.set(u.key, `-${alphaLabel(i)}`))
  return out
}

// ---------------------------------------------------------------------------
// Transform one hall
// ---------------------------------------------------------------------------

class HallError extends Error {}

function transformHall(sourceId: string, raw: SourceHall): ImportHall {
  const warnings: string[] = []
  const hall = raw.hall ?? {}
  const layoutMeta = raw.layout ?? {}

  // `name` over `hall_Name`: it carries the town ("Kino B Žilina" vs "Kino B"),
  // and the library holds nine halls called nothing but "Dom kultúry".
  const venueName =
    clean(hall.name) || clean(hall.hall_Name) || `Hala ${sourceId}`
  const addressParts = [
    clean(hall.street),
    [clean(hall.zip), clean(hall.city)].filter(Boolean).join(' '),
    clean(hall.country),
  ].filter(Boolean)
  const address = addressParts.length > 0 ? addressParts.join(', ') : null

  const isTestHall = TEST_HALL_PATTERN.test(
    `${clean(hall.name)} ${clean(hall.hall_Name)}`,
  )

  // --- sector names -------------------------------------------------------
  // Two loc1 entries in the export occasionally carry the same name. They are
  // distinct physical sectors, and the sector name is the pricing key, so they
  // are kept apart rather than silently merged into one price bucket.
  const sectorNames = new Map<number, string>()
  const takenSectorNames = new Set<string>()
  for (const [id, entry] of Object.entries(raw.loc1 ?? {})) {
    const base = safeSector(clean(entry?.name)) || `Sektor ${id}`
    let name = base
    for (let i = 2; takenSectorNames.has(name); i++) {
      name = `${base.slice(0, MAX_SECTOR_LEN - 4)} (${i})`
    }
    if (name !== base) {
      warnings.push(
        `Duplicitný názov sektora „${base}" premenovaný na „${name}".`,
      )
    }
    takenSectorNames.add(name)
    sectorNames.set(Number(id), name)
  }
  const sectorNameOf = (l1: number) => sectorNames.get(l1) ?? `Sektor ${l1}`

  const categoryNames = new Map<number, string>()
  for (const [id, entry] of Object.entries(raw.categories ?? {})) {
    categoryNames.set(Number(id), clean(entry?.name))
  }

  // --- visible seats ------------------------------------------------------
  const allSeats = raw.seats ?? []
  const visible = allSeats.filter(
    (s) => !isHidden(s.visible) && !isHidden(s.visible_online),
  )
  const hiddenCount = allSeats.length - visible.length

  // Seats are stored by their centre; the source gives the top-left corner.
  const halfW = (Number(layoutMeta.default_seat_width) || 0) / 2
  const halfH = (Number(layoutMeta.default_seat_height) || 0) / 2

  // --- standing areas -----------------------------------------------------
  // A standing area is a stack of seats on one exact coordinate. Anything
  // shorter than STANDING_CLUSTER_MIN is a handful of overlapping seats and
  // stays seated.
  const stacks = new Map<string, SourceSeat[]>()
  for (const s of visible) {
    const key = `${s.x}|${s.y}|${s.l1}|${s.c ?? ''}`
    const stack = stacks.get(key)
    if (stack) stack.push(s)
    else stacks.set(key, [s])
  }
  interface StandingCluster {
    sx: number
    sy: number
    l1: number
    c: number | null
    count: number
  }
  const clusters: StandingCluster[] = []
  const seatedSeats: SourceSeat[] = []
  for (const stack of stacks.values()) {
    if (stack.length >= STANDING_CLUSTER_MIN) {
      const first = stack[0]
      clusters.push({
        sx: first.x + halfW,
        sy: first.y + halfH,
        l1: first.l1,
        c: first.c ?? null,
        count: stack.length,
      })
    } else {
      seatedSeats.push(...stack)
    }
  }
  // Deterministic ids across re-imports: the pricing key of an area is its
  // object id, so the order must not depend on Map iteration luck.
  clusters.sort(
    (a, b) =>
      a.l1 - b.l1 || (a.c ?? 0) - (b.c ?? 0) || a.sy - b.sy || a.sx - b.sx,
  )

  // --- exact duplicate records -------------------------------------------
  // A handful of halls carry the very same seat twice: same coordinate, same
  // sector, same category, same row and number. That is one physical seat
  // written down twice, not two seats, and it can only ever break the unique
  // constraint — so the copies go. (Stacks of 10+ never reach here; they were
  // taken out above as standing areas.)
  const seenSeatKeys = new Set<string>()
  const dedupedSeats: SourceSeat[] = []
  let exactDuplicates = 0
  for (const s of seatedSeats) {
    const key = `${s.x}|${s.y}|${s.l1}|${s.c ?? ''}|${s.l2}|${s.n}`
    if (seenSeatKeys.has(key)) {
      exactDuplicates++
      continue
    }
    seenSeatKeys.add(key)
    dedupedSeats.push(s)
  }
  if (exactDuplicates > 0) {
    warnings.push(
      `${exactDuplicates}× rovnaké sedadlo v zdroji (rovnaká súradnica aj číslo) — kópie zahodené.`,
    )
  }

  // --- scale --------------------------------------------------------------
  // The median gap between neighbouring seats of a source row. Rows are taken
  // as they come from the source (l1 + l2) purely as a grouping — l2 may well
  // be a table number, which still groups seats that sit next to each other.
  const rowGroups = new Map<string, SourceSeat[]>()
  for (const s of dedupedSeats) {
    const key = `${s.l1}|${s.l2}`
    const g = rowGroups.get(key)
    if (g) g.push(s)
    else rowGroups.set(key, [s])
  }
  const gaps: number[] = []
  for (const group of rowGroups.values()) {
    if (group.length < 2) continue
    const xs = group.map((s) => s.x)
    const ys = group.map((s) => s.y)
    const along =
      Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys)
        ? xs
        : ys
    along.sort((a, b) => a - b)
    for (let i = 1; i < along.length; i++) {
      const d = along[i] - along[i - 1]
      if (d > 0) gaps.push(d)
    }
  }
  const sourceGap = median(gaps) ?? FALLBACK_SOURCE_GAP
  const scale = TARGET_SEAT_GAP / sourceGap

  // --- blocks, renumbering, suffixes -------------------------------------
  const bySector = new Map<number, WorkSeat[]>()
  for (const s of dedupedSeats) {
    const work: WorkSeat = {
      ref: String(s.ts),
      sx: s.x + halfW,
      sy: s.y + halfH,
      row: String(s.l2),
      seat: String(s.n),
      unnumbered: s.n === 0,
      piece: 0,
    }
    const g = bySector.get(s.l1)
    if (g) g.push(work)
    else bySector.set(s.l1, [work])
  }

  let renumberedSeats = 0
  let suffixedSectors = 0
  const seatsOut: ImportSeat[] = []
  const sectorBounds = new Map<
    string,
    { minX: number; minY: number; maxX: number; maxY: number }
  >()

  for (const [l1, sectorSeats] of bySector) {
    const sector = sectorNameOf(l1)
    const blocks = findBlocks(sectorSeats, sourceGap)

    // Renumber only blocks the source left entirely unnumbered. A block that
    // has real numbers with a few n = 0 strays keeps them — throwing away a
    // hall's actual seat numbers to fix a handful of seats would be worse than
    // the collision it prevents, and the block suffix usually resolves those.
    for (const block of blocks) {
      if (block.every((s) => s.unnumbered)) {
        renumberBlock(block, sourceGap)
        renumberedSeats += block.length
      }
    }

    // Suffix the row labels only where the sector actually collides with
    // itself. Untouched sectors keep the hall's own row labels, which is what
    // staff read off the printed ticket.
    const pairs = new Set<string>()
    let collides = false
    for (const s of sectorSeats) {
      const key = `${s.row}\u0000${s.seat}`
      if (pairs.has(key)) {
        collides = true
        break
      }
      pairs.add(key)
    }
    if (collides) {
      // Blocks in reading order, so the suffix letters run the way a person
      // would point at them.
      const band = sourceGap * 6
      const ranked = blocks
        .map((block) => ({ block, centre: centreOf(block) }))
        .sort(
          (p, q) =>
            Math.floor(p.centre.y / band) - Math.floor(q.centre.y / band) ||
            p.centre.x - q.centre.x,
        )
      // A seat's unit is its block plus which piece of its row it landed in.
      const unitSeats = new Map<string, WorkSeat[]>()
      ranked.forEach(({ block }, blockRank) => {
        const rows = new Map<string, WorkSeat[]>()
        for (const s of block) {
          const g = rows.get(s.row)
          if (g) g.push(s)
          else rows.set(s.row, [s])
        }
        for (const rowSeats of rows.values()) {
          splitRowPieces(rowSeats, sourceGap).forEach((piece, index) => {
            for (const s of piece) s.piece = index
          })
        }
        for (const s of block) {
          const key = `${blockRank}:${s.piece}`
          const g = unitSeats.get(key)
          if (g) g.push(s)
          else unitSeats.set(key, [s])
        }
      })
      const units = [...unitSeats.entries()]
        .sort(([a], [b]) => {
          const [ab, ap] = a.split(':').map(Number)
          const [bb, bp] = b.split(':').map(Number)
          return ab - bb || ap - bp
        })
        .map(([key, seats]) => ({ key, centre: centreOf(seats) }))
      if (units.length > 1) {
        const suffixes = suffixesFor(units)
        for (const [key, seats] of unitSeats) {
          const suffix = suffixes.get(key) ?? ''
          for (const s of seats) s.row = `${s.row}${suffix}`
        }
        suffixedSectors++
      }
    }

    for (const s of sectorSeats) {
      const row = s.row.slice(0, MAX_ROW_LEN)
      const seatNo = s.seat.slice(0, MAX_SEAT_NO_LEN)
      seatsOut.push({
        level: 'main',
        level_order: 0,
        sector,
        row_label: row,
        seat_number: seatNo,
        x: s.sx, // scaled and translated below, once the extent is known
        y: s.sy,
        seat_type: 'standard',
        external_ref: s.ref,
      })
      const b = sectorBounds.get(sector)
      if (b) {
        b.minX = Math.min(b.minX, s.sx)
        b.minY = Math.min(b.minY, s.sy)
        b.maxX = Math.max(b.maxX, s.sx)
        b.maxY = Math.max(b.maxY, s.sy)
      } else {
        sectorBounds.set(sector, {
          minX: s.sx,
          minY: s.sy,
          maxX: s.sx,
          maxY: s.sy,
        })
      }
    }
  }

  // --- uniqueness ---------------------------------------------------------
  // The unique constraint is (seat_map_id, level, sector, row_label,
  // seat_number). A hall that still breaks it after blocking is a hall we do
  // not understand, so it is refused rather than half-imported.
  const seen = new Set<string>()
  const duplicates: string[] = []
  for (const s of seatsOut) {
    const key = `${s.sector}\u0000${s.row_label}\u0000${s.seat_number}`
    if (seen.has(key)) {
      if (duplicates.length < 5) {
        duplicates.push(
          `${s.sector} / rad ${s.row_label} / miesto ${s.seat_number}`,
        )
      }
    } else seen.add(key)
  }
  if (duplicates.length > 0) {
    throw new HallError(
      `duplicitné sedadlá (sektor/rad/miesto): ${duplicates.join('; ')}${
        duplicates.length === 5 ? ' …' : ''
      }`,
    )
  }

  // --- stage objects ------------------------------------------------------
  // Only t = E. See ELEMENT_KIND for why the rest of elements[] is left behind
  // and what has to happen before it can come in.
  const stages = (raw.elements ?? []).flatMap((e) => {
    if (e === null) return []
    const kind = ELEMENT_KIND[e.t]
    return kind ? [{ element: e, kind }] : []
  })
  const skippedDecor = (raw.elements ?? []).reduce<Record<string, number>>(
    (acc, e) => {
      if (e && SKIPPED_ELEMENT_TYPES.has(e.t)) acc[e.t] = (acc[e.t] ?? 0) + 1
      return acc
    },
    {},
  )

  // --- extent -------------------------------------------------------------
  // Measured from the content, never from the export's own bbox, which is
  // cropped. Areas are centred on the stack they replace, so their boxes
  // stretch the extent by half a box on each side.
  const pointsX: number[] = []
  const pointsY: number[] = []
  for (const s of seatsOut) {
    pointsX.push(s.x)
    pointsY.push(s.y)
  }
  const halfAreaW = AREA_WIDTH / 2 / scale
  const halfAreaH = AREA_HEIGHT / 2 / scale
  for (const c of clusters) {
    pointsX.push(c.sx - halfAreaW, c.sx + halfAreaW)
    pointsY.push(c.sy - halfAreaH, c.sy + halfAreaH)
  }
  for (const { element: e } of stages) {
    pointsX.push(e.x, e.x + (Number(e.w) || 0))
    pointsY.push(e.y, e.y + (Number(e.h) || 0))
  }
  if (pointsX.length === 0) {
    throw new HallError('hala nemá ani sedadlá, ani státie, ani pódium')
  }
  const minX = Math.min(...pointsX)
  const minY = Math.min(...pointsY)
  const toX = (v: number) => round2((v - minX) * scale + CANVAS_PADDING)
  const toY = (v: number) => round2((v - minY) * scale + CANVAS_PADDING)

  for (const s of seatsOut) {
    s.x = toX(s.x)
    s.y = toY(s.y)
  }

  // --- layout objects -----------------------------------------------------
  // Standing areas are numbered FIRST and decorations after, because an area's
  // id is its pricing key in event_sector_pricing ('#o1'). Numbering the decor
  // first would renumber every area the day the source hall gains a wall, and
  // silently repoint a sold category at a different patch of floor.
  let objectSeq = 0
  const nextId = () => `o${++objectSeq}`

  const areaObjects: MapObject[] = clusters.map((c) => ({
    id: nextId(),
    kind: 'area',
    label:
      sectorNames.get(c.l1) ||
      (c.c !== null ? categoryNames.get(c.c) : '') ||
      'Státie',
    x: round2(toX(c.sx) - AREA_WIDTH / 2),
    y: round2(toY(c.sy) - AREA_HEIGHT / 2),
    width: AREA_WIDTH,
    height: AREA_HEIGHT,
    rotation: 0,
    capacity: c.count,
  }))
  deoverlapAreas(areaObjects)

  const stageObjects: MapObject[] = stages.map(({ element: e, kind }) => ({
    id: nextId(),
    kind,
    // A wall or an icon usually carries no text; only the stage gets a default,
    // since an unlabelled dark slab reads as a mistake.
    label: clean(e.text).replace(/\s+/g, ' ') || (e.t === 'E' ? 'Pódium' : ''),
    x: toX(e.x),
    y: toY(e.y),
    width: round2(Math.max(1, Number(e.w) || 0) * scale),
    height: round2(Math.max(1, Number(e.h) || 0) * scale),
    rotation: (((Number(e.ang) || 0) % 360) + 360) % 360,
    capacity: null,
  }))

  const objects: MapObject[] = [...areaObjects, ...stageObjects]

  // --- sector shapes ------------------------------------------------------
  const halfSeat = TARGET_SEAT_GAP / 2
  const shapes: SectorShape[] = [...sectorBounds.entries()]
    .map(([sector, b]) => ({
      sector,
      label: sector,
      kind: 'rect' as const,
      x: round2(toX(b.minX) - halfSeat),
      y: round2(toY(b.minY) - halfSeat),
      width: round2((b.maxX - b.minX) * scale + TARGET_SEAT_GAP),
      height: round2((b.maxY - b.minY) * scale + TARGET_SEAT_GAP),
    }))
    .sort((a, b) => a.sector.localeCompare(b.sector, 'sk'))

  // --- canvas -------------------------------------------------------------
  // Grows with the hall: the editor and the buyer picker both zoom to fit, so a
  // 36k-seat arena is allowed to be a very large canvas.
  let maxX = 0
  let maxY = 0
  for (const s of seatsOut) {
    maxX = Math.max(maxX, s.x + halfSeat)
    maxY = Math.max(maxY, s.y + halfSeat)
  }
  for (const o of objects) {
    maxX = Math.max(maxX, o.x + o.width)
    maxY = Math.max(maxY, o.y + o.height)
  }
  const canvas = {
    width: Math.ceil(maxX + CANVAS_PADDING),
    height: Math.ceil(maxY + CANVAS_PADDING),
  }

  const level: MapLevel = {
    key: 'main',
    name: 'Hlavná úroveň',
    order: 0,
    canvas,
    shapes,
    objects,
  }
  const layout: SeatMapLayout = { version: LAYOUT_VERSION, levels: [level] }

  // The map's external_ref pins it to this exact layout of the hall, so an
  // export without a layout id cannot be made idempotent and is refused.
  const idHall = Number(raw.id_hall)
  if (!Number.isFinite(idHall)) {
    throw new HallError(
      'chýba layout.id_hall — mapu nemožno jednoznačne označiť',
    )
  }
  const mapName = clean(layoutMeta.name) || venueName || `Rozloženie ${idHall}`

  const standingCapacity = clusters.reduce((n, c) => n + c.count, 0)
  if (seatsOut.length === 0 && clusters.length === 0) {
    throw new HallError('hala nemá žiadne použiteľné sedadlá')
  }
  if (gaps.length === 0 && seatsOut.length > 0) {
    warnings.push(
      `Nedá sa zmerať rozostup sedadiel — použitý predvolený ${FALLBACK_SOURCE_GAP}.`,
    )
  }

  return {
    sourceId,
    idHall,
    venueName: venueName.slice(0, 200),
    address: address ? address.slice(0, 500) : null,
    mapName: mapName.slice(0, 200),
    venueRef: `mt:${sourceId}`,
    mapRef: `mt:${sourceId}:${idHall}`,
    layout,
    seats: seatsOut,
    stats: {
      rawSeats: allSeats.length,
      hiddenSeats: hiddenCount,
      standingSeats: standingCapacity,
      areas: clusters.length,
      standingCapacity,
      sectors: sectorBounds.size,
      suffixedSectors,
      renumberedSeats,
      stages: stages.length,
      skippedDecor,
      scale,
      sourceGap,
      canvas,
    },
    warnings,
    isTestHall,
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/**
 * Standing areas inherit the position of the stack they replace, and a stack is
 * a single point — in an all-standing hall three of them can sit 40 source
 * units apart and their 260×160 boxes would then cover each other completely.
 * Push the later ones down until they are clear, keeping the source's ordering.
 */
function deoverlapAreas(areas: MapObject[]): void {
  const placed: MapObject[] = []
  const ordered = [...areas].sort((a, b) => a.y - b.y || a.x - b.x)
  for (const area of ordered) {
    for (;;) {
      const hit = placed.find(
        (p) =>
          area.x < p.x + p.width &&
          area.x + area.width > p.x &&
          area.y < p.y + p.height &&
          area.y + area.height > p.y,
      )
      if (!hit) break
      area.y = round2(hit.y + hit.height + AREA_GAP)
    }
    placed.push(area)
  }
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

/**
 * The untyped client, exactly as the app uses it (src/lib/supabase/server.ts).
 * Inferring the type from createClient instead would narrow every payload to
 * `never`, because this repo has no generated Database types.
 */
type Db = SupabaseClient

function connect(): Db {
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    fail(
      'Chýba SUPABASE_URL alebo SUPABASE_SERVICE_ROLE_KEY.\n' +
        '  node --env-file=~/ticketio-secrets.env scripts/import-halls.ts <adresár> --commit',
    )
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * venues_external_ref_public and seat_maps_external_ref are PARTIAL unique
 * indexes, and PostgREST cannot infer an ON CONFLICT target from one — Postgres
 * answers 42P10 ("no unique or exclusion constraint matching the ON CONFLICT
 * specification"). So the venue and the map are resolved by hand: select, then
 * insert or update. Only `seats` is upserted, on its full table constraint,
 * which infers fine.
 */
async function upsertVenue(db: Db, hall: ImportHall): Promise<string> {
  const { data: existing, error: selErr } = await db
    .from('venues')
    .select('id')
    .eq('external_ref', hall.venueRef)
    .is('organizer_id', null)
    .maybeSingle<{ id: string }>()
  if (selErr) throw new HallError(`čítanie venue zlyhalo: ${selErr.message}`)

  if (existing) {
    const { error } = await db
      .from('venues')
      .update({
        name: hall.venueName,
        address: hall.address,
        is_public: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
    if (error) throw new HallError(`update venue zlyhal: ${error.message}`)
    return existing.id
  }

  const { data: created, error } = await db
    .from('venues')
    .insert({
      organizer_id: null,
      name: hall.venueName,
      address: hall.address,
      external_ref: hall.venueRef,
      is_public: true,
    })
    .select('id')
    .maybeSingle<{ id: string }>()
  if (error || !created) {
    throw new HallError(`insert venue zlyhal: ${error?.message ?? 'bez id'}`)
  }
  return created.id
}

async function upsertSeatMap(
  db: Db,
  venueId: string,
  hall: ImportHall,
): Promise<{ id: string; existed: boolean }> {
  const { data: existing, error: selErr } = await db
    .from('seat_maps')
    .select('id')
    .eq('venue_id', venueId)
    .eq('external_ref', hall.mapRef)
    .maybeSingle<{ id: string }>()
  if (selErr) throw new HallError(`čítanie mapy zlyhalo: ${selErr.message}`)

  if (existing) {
    // A map already bound to an event owns live event_seats; rewriting its
    // seats would cascade them away, taking sold tickets with them.
    const { count } = await db
      .from('event_seat_maps')
      .select('*', { count: 'exact', head: true })
      .eq('seat_map_id', existing.id)
    if ((count ?? 0) > 0) {
      throw new HallError(
        'mapa sa už používa v podujatí — preskočené, aby sa nezmazali predané sedadlá',
      )
    }
    const { error } = await db
      .from('seat_maps')
      .update({
        name: hall.mapName,
        layout: hall.layout,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
    if (error) throw new HallError(`update mapy zlyhal: ${error.message}`)
    return { id: existing.id, existed: true }
  }

  const { data: created, error } = await db
    .from('seat_maps')
    .insert({
      venue_id: venueId,
      name: hall.mapName,
      layout: hall.layout,
      external_ref: hall.mapRef,
    })
    .select('id')
    .maybeSingle<{ id: string }>()
  if (error || !created) {
    throw new HallError(`insert mapy zlyhal: ${error?.message ?? 'bez id'}`)
  }
  return { id: created.id, existed: false }
}

async function writeSeats(
  db: Db,
  seatMapId: string,
  hall: ImportHall,
  mapExisted: boolean,
): Promise<void> {
  // Re-importing a hall whose source shrank must not leave orphans behind, and
  // the map is known not to be in use at this point, so the old set goes first.
  if (mapExisted) {
    const { error } = await db
      .from('seats')
      .delete()
      .eq('seat_map_id', seatMapId)
    if (error) {
      throw new HallError(`mazanie starých sedadiel zlyhalo: ${error.message}`)
    }
  }
  for (let i = 0; i < hall.seats.length; i += SEAT_BATCH) {
    const batch = hall.seats
      .slice(i, i + SEAT_BATCH)
      .map((s) => ({ ...s, seat_map_id: seatMapId }))
    const { error } = await db.from('seats').upsert(batch, {
      onConflict: 'seat_map_id,level,sector,row_label,seat_number',
    })
    if (error) {
      throw new HallError(
        `zápis sedadiel (${i}–${i + batch.length}) zlyhal: ${error.message}`,
      )
    }
  }
}

async function importHall(db: Db, hall: ImportHall): Promise<string> {
  const venueId = await upsertVenue(db, hall)
  const map = await upsertSeatMap(db, venueId, hall)
  await writeSeats(db, map.id, hall, map.existed)
  return map.existed ? 'aktualizovaná' : 'vytvorená'
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function listHallDirs(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    fail(`Adresár sa nedá čítať: ${dir}`)
  }
  const dirs = entries.filter((name) => {
    const path = join(dir, name)
    try {
      return (
        statSync(path).isDirectory() &&
        statSync(join(path, 'hall.json')).isFile()
      )
    } catch {
      return false
    }
  })
  // Numeric ids sort numerically, so the log reads in hall order.
  return dirs.sort((a, b) => {
    const na = Number(a)
    const nb = Number(b)
    return Number.isFinite(na) && Number.isFinite(nb)
      ? na - nb
      : a.localeCompare(b)
  })
}

/** Decorations this hall carries that the import does not write. */
function skippedCount(hall: ImportHall): number {
  return Object.values(hall.stats.skippedDecor).reduce((n, v) => n + v, 0)
}

/** e.g. "10 (T2 W8)" — how many were left behind, and of which source types. */
function skippedSummary(hall: ImportHall): string {
  const parts = Object.entries(hall.stats.skippedDecor)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([t, n]) => `${t}${n}`)
  return `${skippedCount(hall)} (${parts.join(' ')})`
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  const ids = listHallDirs(opts.dir).filter(
    (id) => !opts.only || opts.only.has(id),
  )
  if (ids.length === 0) fail(`V ${opts.dir} sa nenašla žiadna hala.`)
  if (opts.only) {
    for (const wanted of opts.only) {
      if (!ids.includes(wanted)) console.warn(`! hala ${wanted} sa nenašla`)
    }
  }

  console.log(
    `${opts.commit ? 'ZÁPIS' : 'NAČISTO (dry-run)'} — ${ids.length} hál z ${opts.dir}\n`,
  )

  const db = opts.commit ? connect() : null
  const failures: { id: string; reason: string }[] = []
  const skippedTest: string[] = []
  const warned: { id: string; warnings: string[] }[] = []
  let imported = 0
  let seatTotal = 0
  let areaTotal = 0
  let standingTotal = 0
  let stageTotal = 0
  const skippedTotal: Record<string, number> = {}

  for (const id of ids) {
    let hall: ImportHall
    try {
      const raw = JSON.parse(
        readFileSync(join(opts.dir, id, 'hall.json'), 'utf8'),
      ) as SourceHall
      hall = transformHall(id, raw)
    } catch (e) {
      failures.push({
        id,
        reason: e instanceof Error ? e.message : String(e),
      })
      continue
    }

    if (hall.isTestHall && !opts.includeTestHalls) {
      skippedTest.push(`${id} — ${hall.venueName}`)
      continue
    }
    if (hall.warnings.length > 0) warned.push({ id, warnings: hall.warnings })

    if (opts.verbose || opts.only) {
      console.log(
        `${id.padStart(5)}  ${hall.venueName.slice(0, 38).padEnd(38)} ` +
          `sedadlá ${String(hall.seats.length).padStart(6)}  ` +
          `plochy ${String(hall.stats.areas).padStart(2)} (${String(
            hall.stats.standingCapacity,
          ).padStart(6)})  ` +
          `sektory ${String(hall.stats.sectors).padStart(3)}  ` +
          `mierka ${hall.stats.scale.toFixed(2).padStart(5)}  ` +
          `plátno ${hall.stats.canvas.width}×${hall.stats.canvas.height}` +
          (hall.stats.stages ? `  pódiá ${hall.stats.stages}` : '') +
          (skippedCount(hall) ? `  dekor bokom ${skippedSummary(hall)}` : '') +
          (hall.stats.suffixedSectors
            ? `  [+suffix ${hall.stats.suffixedSectors}]`
            : '') +
          (hall.stats.renumberedSeats
            ? `  [prečíslované ${hall.stats.renumberedSeats}]`
            : ''),
      )
    }

    if (db) {
      try {
        const what = await importHall(db, hall)
        if (opts.verbose || opts.only) console.log(`       → mapa ${what}`)
      } catch (e) {
        failures.push({
          id,
          reason: e instanceof Error ? e.message : String(e),
        })
        continue
      }
    }

    imported++
    stageTotal += hall.stats.stages
    for (const [t, n] of Object.entries(hall.stats.skippedDecor)) {
      skippedTotal[t] = (skippedTotal[t] ?? 0) + n
    }
    seatTotal += hall.seats.length
    areaTotal += hall.stats.areas
    standingTotal += hall.stats.standingCapacity
  }

  console.log(
    `\n── Zhrnutie ─────────────────────────────────────────────────────`,
  )
  console.log(
    `${opts.commit ? 'Naimportovaných' : 'Pripravených'} hál: ${imported}`,
  )
  console.log(`Sedadiel: ${seatTotal.toLocaleString('sk-SK')}`)
  console.log(
    `Plôch na státie: ${areaTotal} (kapacita ${standingTotal.toLocaleString('sk-SK')})`,
  )
  console.log(`Pódií: ${stageTotal}`)
  const skippedSum = Object.values(skippedTotal).reduce((n, v) => n + v, 0)
  if (skippedSum > 0) {
    console.log(
      `Dekorácií ponechaných v zdroji: ${skippedSum} (` +
        Object.entries(skippedTotal)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([t, n]) => `${t}=${n}`)
          .join(' ') +
        ') — doplnia sa re-importom, keď ich bude renderer vedieť vykresliť',
    )
  }
  if (skippedTest.length > 0) {
    console.log(
      `\nPreskočené testovacie/vzorové haly (${skippedTest.length}) — pridaj --include-test-halls:`,
    )
    for (const s of skippedTest) console.log(`  · ${s}`)
  }
  if (warned.length > 0) {
    console.log(`\nUpozornenia (${warned.length} hál):`)
    for (const w of warned) {
      for (const msg of w.warnings) console.log(`  ! ${w.id}: ${msg}`)
    }
  }
  if (failures.length > 0) {
    console.log(`\nPreskočené pre chybu (${failures.length}):`)
    for (const f of failures) console.log(`  ✗ ${f.id}: ${f.reason}`)
  }
  if (!opts.commit) {
    console.log(`\nNič sa nezapísalo. Spusti s --commit na skutočný import.`)
  }
  process.exit(failures.length > 0 ? 1 : 0)
}

await main()
