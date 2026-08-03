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
import {
  alphaLabel,
  DEFAULT_ROW_GAP_Y,
  LAYOUT_VERSION,
  MIN_OBJECT_SIZE,
  objectBounds,
} from '../src/lib/seating.ts'
import type {
  MapLevel,
  MapObject,
  MapObjectKind,
  SeatMapLayout,
  SeatType,
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
/** One row's worth of canvas — the height an emptied band is squeezed down to. */
const ROW_HEIGHT = DEFAULT_ROW_GAP_Y
/** Empty vertical runs taller than this many rows get collapsed. */
const MAX_EMPTY_BAND_ROWS = 2
/** Objects never collapse below the editor's own floor. */
const MIN_OBJECT_HEIGHT = MIN_OBJECT_SIZE
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
// Wheelchair spaces
//
// The export has no accessibility flag; the only evidence is the name of the
// sector (loc1) or the price category. That evidence is ambiguous, because
// "ZŤP" appears in BOTH senses:
//
//   physically different space   "Vozíčkári", "Sektor I (Imobilní)", "ZŤP"
//   just a cheaper ticket        "Deti do 15 r., seniori, ZŤP"
//
// A seat in the second group is an ordinary seat sold at a discount and must
// stay 'standard' — marking it would tell a wheelchair user a normal seat is
// accessible. So the decision is made from explicit name lists, never from a
// regex on "ZŤP". Names are compared folded (no diacritics, lower case,
// collapsed spaces) so 'Vozíčkári' and 'vozickari' are the same entry.
//
// Anything else that merely LOOKS accessibility-related is neither marked nor
// ignored: it is reported by the dry run as an unknown name, so a new variant
// in a future export gets a decision instead of silently defaulting.
// ---------------------------------------------------------------------------

/** Names that denote a physically distinct wheelchair space. */
const WHEELCHAIR_NAMES = new Set(
  [
    'Vozíčkár',
    'Vozíčkar',
    'Vozíčkári',
    'Vozíčkari',
    'Vozíčkári AB',
    'Vozíčkári AD',
    'ZŤP - vozíčkari',
    'ZŤP vozíčkari',
    'ZŤP',
    'ZŤP a doprovod',
    'Imobilný návštevník',
    'IMOBILNÍ',
    'Sektor I (Imobilní)',
  ].map(foldName),
)

/** Names that mention a disability but describe a DISCOUNT on a normal seat. */
const WHEELCHAIR_EXCLUDED_NAMES = new Set(
  [
    'Deti do 15 r., seniori, ZŤP',
    'Deti do 6 r., ZŤP-S',
    'Piatok - dôchodcovia a ZŤP',
    'Sobota - dôchodcovia a ZŤP',
    'Nedeľa - dôchodcovia a ZŤP',
    'Piatok - ZŤP, dôchodcovia nad 65 r.',
    'Sobota - ZŤP, dôchodcovia nad 65 r.',
    'Permanentka - dôchodcovia a ZŤP',
  ].map(foldName),
)

/** Only decides whether an unrecognised name is worth reporting. */
const ACCESS_HINT = /vozick|ztp|imobil|invalid/

/** Diacritics-free, lower-case, single-spaced — the comparison key for names. */
function foldName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

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
  seat_type: SeatType
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
    /** Empty vertical bands squeezed out of the map. */
    collapsedBands: number
    /** Seats written as seat_type 'wheelchair'. */
    wheelchairSeats: number
    /** Seats that shared a coordinate and had to be laid out. */
    spreadSeats: number
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
  /** A physically distinct wheelchair space, not a discounted normal seat. */
  wheelchair: boolean
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

/**
 * Turn one coordinate's worth of seats into seats that actually have places.
 *
 * Some halls never laid a group out and left every seat of it on a single
 * point: a pair of extra chairs at the end of a row, or a whole wheelchair
 * zone (Hrad Beckov keeps 201 of them on one pixel). They are distinct seats —
 * every record carries its own `ts` — so they are spread around that point
 * instead of being merged away or sold as anonymous floor.
 *
 *   up to a handful   one row, side by side, numbered 1..N
 *   a whole zone      a near-square grid, rows 1..R numbered 1..C
 *
 * A group of one passes through untouched, which is the overwhelming majority.
 */
function layOutStack(
  stack: SourceSeat[],
  gap: number,
  halfW: number,
  halfH: number,
  isWheelchair: (s: SourceSeat) => boolean,
): WorkSeat[] {
  const make = (
    s: SourceSeat,
    sx: number,
    sy: number,
    row: string,
    seat: string,
  ): WorkSeat => ({
    ref: String(s.ts),
    sx,
    sy,
    row,
    seat,
    unnumbered: seat === '0',
    wheelchair: isWheelchair(s),
    piece: 0,
  })

  const first = stack[0]
  const cx = first.x + halfW
  const cy = first.y + halfH
  if (stack.length === 1) {
    return [make(first, cx, cy, String(first.l2), String(first.n))]
  }

  // Order by ts so a re-import lays the same seat in the same place.
  const ordered = [...stack].sort((a, b) => a.ts - b.ts)
  const grid = ordered.length >= STANDING_CLUSTER_MIN
  const cols = grid ? Math.ceil(Math.sqrt(ordered.length)) : ordered.length
  const rows = Math.ceil(ordered.length / cols)
  // Centre the block on the point the hall put it at, so it stays where the
  // plan said it was.
  const originX = cx - ((cols - 1) * gap) / 2
  const originY = cy - ((rows - 1) * gap) / 2

  return ordered.map((s, i) => {
    const r = Math.floor(i / cols)
    const c = i % cols
    return make(
      s,
      originX + c * gap,
      originY + r * gap,
      // A single row keeps the row the hall gave it; a grid has no meaningful
      // row in the source (these are all l2 = 22 / 209 / 203) and gets its own.
      grid ? String(r + 1) : String(s.l2),
      String(c + 1),
    )
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

  // --- wheelchair spaces --------------------------------------------------
  const wheelchairSectors = new Set<number>()
  const wheelchairCategories = new Set<number>()
  const unknownAccessNames = new Set<string>()
  const classifyAccess = (
    id: number,
    name: string,
    into: Set<number>,
  ): void => {
    const folded = foldName(name)
    if (WHEELCHAIR_NAMES.has(folded)) into.add(id)
    else if (
      !WHEELCHAIR_EXCLUDED_NAMES.has(folded) &&
      ACCESS_HINT.test(folded)
    ) {
      unknownAccessNames.add(name)
    }
  }
  for (const [id, entry] of Object.entries(raw.loc1 ?? {})) {
    classifyAccess(Number(id), clean(entry?.name), wheelchairSectors)
  }
  for (const [id, entry] of Object.entries(raw.categories ?? {})) {
    classifyAccess(Number(id), clean(entry?.name), wheelchairCategories)
  }
  for (const name of unknownAccessNames) {
    warnings.push(
      `Neznámy názov pripomínajúci bezbariérové miesto: „${name}" — ponechané ako standard, rozhodni a doplň do WHEELCHAIR_NAMES.`,
    )
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

  const isWheelchair = (s: SourceSeat): boolean =>
    wheelchairSectors.has(s.l1) ||
    (s.c != null && wheelchairCategories.has(s.c))

  // --- duplicate records --------------------------------------------------
  // `ts` is the source's own seat id and it is unique across the whole export
  // (887 845 records, 887 845 distinct ts), so two records sharing a coordinate
  // are two real seats the hall never bothered to lay out — not one seat
  // written twice. Only a repeated ts is a genuine duplicate.
  const seenTs = new Set<number>()
  const uniqueSeats: SourceSeat[] = []
  let duplicateTs = 0
  for (const s of visible) {
    if (seenTs.has(s.ts)) {
      duplicateTs++
      continue
    }
    seenTs.add(s.ts)
    uniqueSeats.push(s)
  }
  if (duplicateTs > 0) {
    warnings.push(`${duplicateTs}× zhodné ts v zdroji — kópie zahodené.`)
  }

  // --- standing areas -----------------------------------------------------
  // A standing area is a stack of seats on one exact coordinate. Two rules
  // bound it:
  //   - fewer than STANDING_CLUSTER_MIN and it is not an area at all, just a
  //     few seats the hall left piled up;
  //   - a wheelchair sector is NEVER an area, however tall the pile. A
  //     wheelchair space is a specific place a specific person books, not free
  //     floor sold by the head, and `area` has nowhere to record that it is
  //     accessible at all.
  // Everything that stays seated and shares a coordinate gets spread out below.
  const stacks = new Map<string, SourceSeat[]>()
  for (const s of uniqueSeats) {
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
  const seatedStacks: SourceSeat[][] = []
  for (const stack of stacks.values()) {
    if (stack.length >= STANDING_CLUSTER_MIN && !isWheelchair(stack[0])) {
      const first = stack[0]
      clusters.push({
        sx: first.x + halfW,
        sy: first.y + halfH,
        l1: first.l1,
        c: first.c ?? null,
        count: stack.length,
      })
    } else {
      seatedStacks.push(stack)
    }
  }
  // Deterministic ids across re-imports: the pricing key of an area is its
  // object id, so the order must not depend on Map iteration luck.
  clusters.sort(
    (a, b) =>
      a.l1 - b.l1 || (a.c ?? 0) - (b.c ?? 0) || a.sy - b.sy || a.sx - b.sx,
  )
  const seatedSeats = seatedStacks.flat()

  // --- scale --------------------------------------------------------------
  // The median gap between neighbouring seats of a source row. Rows are taken
  // as they come from the source (l1 + l2) purely as a grouping — l2 may well
  // be a table number, which still groups seats that sit next to each other.
  const rowGroups = new Map<string, SourceSeat[]>()
  for (const s of seatedSeats) {
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
  // Piles of seats sitting on one coordinate are laid out for real before
  // anything else looks at them, so the rest of the pipeline only ever sees
  // seats with distinct positions.
  let spreadSeats = 0
  const bySector = new Map<number, WorkSeat[]>()
  for (const stack of seatedStacks) {
    const laid = layOutStack(stack, sourceGap, halfW, halfH, isWheelchair)
    if (stack.length > 1) spreadSeats += stack.length
    for (const work of laid) {
      const g = bySector.get(stack[0].l1)
      if (g) g.push(work)
      else bySector.set(stack[0].l1, [work])
    }
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
        seat_type: s.wheelchair ? 'wheelchair' : 'standard',
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
    // An unlabelled dark slab reads as a mistake, so the stage gets a default.
    label: clean(e.text).replace(/\s+/g, ' ') || 'Pódium',
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

  // --- close the empty bands ----------------------------------------------
  // The source spaces a hall out around things we do not import, so a map can
  // come out with a tall strip of nothing in the middle of it — Kino B leaves
  // 370 px between the seating and the standing area, exactly where the cage
  // walls used to be. Runs of empty canvas taller than two rows are squeezed
  // down to one row. Only vertical, and only where NOTHING in the whole hall
  // occupies that band, so a cross-aisle in one sector survives as long as
  // another sector has seats beside it.
  const collapsedBands = collapseVerticalGaps(seatsOut, objects, shapes)

  // --- canvas -------------------------------------------------------------
  // Measured from what is actually written, edge to edge, and re-anchored so
  // the padding is the same on all four sides. Grows with the hall: the editor
  // and the buyer picker both zoom to fit, so a 36k-seat arena is allowed to be
  // a very large canvas.
  const canvas = normalizeCanvas(seatsOut, objects, shapes)

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
      collapsedBands,
      wheelchairSeats: seatsOut.filter((s) => s.seat_type === 'wheelchair')
        .length,
      spreadSeats,
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

/** Top and bottom edge of one drawn thing, in canvas units. */
interface VSpan {
  top: number
  bottom: number
}

function seatSpan(s: ImportSeat): VSpan {
  const half = TARGET_SEAT_GAP / 2
  return { top: s.y - half, bottom: s.y + half }
}

function objectSpan(o: MapObject): VSpan {
  const b = objectBounds(o)
  return { top: b.minY, bottom: b.maxY }
}

/**
 * Squeeze tall empty bands out of the map, vertically only.
 *
 * A band counts as empty when no seat and no object anywhere in the hall
 * overlaps it — a gap inside one sector does not qualify while another sector
 * still has seats across from it, so aisles and staggered blocks keep their
 * shape. Anything taller than `MAX_EMPTY_BAND_ROWS` rows is cut down to one row
 * and everything below it moves up by the difference.
 *
 * Horizontal geometry is never touched: x, widths and the order of seats within
 * a row come out exactly as they went in.
 *
 * Returns how many bands were closed.
 */
function collapseVerticalGaps(
  seats: ImportSeat[],
  objects: MapObject[],
  shapes: SectorShape[],
): number {
  const spans: VSpan[] = [
    ...seats.map(seatSpan),
    ...objects.map(objectSpan),
    ...shapes.map((s) => ({ top: s.y, bottom: s.y + s.height })),
  ]
  if (spans.length === 0) return 0

  spans.sort((a, b) => a.top - b.top)
  const merged: VSpan[] = [{ ...spans[0] }]
  for (const s of spans.slice(1)) {
    const last = merged[merged.length - 1]
    if (s.top <= last.bottom) last.bottom = Math.max(last.bottom, s.bottom)
    else merged.push({ ...s })
  }

  // Each cut records: from this y downwards, move up by this much.
  const limit = ROW_HEIGHT * MAX_EMPTY_BAND_ROWS
  const cuts: { from: number; shift: number }[] = []
  let total = 0
  for (let i = 1; i < merged.length; i++) {
    const gap = merged[i].top - merged[i - 1].bottom
    if (gap > limit) {
      total += gap - ROW_HEIGHT
      cuts.push({ from: merged[i].top, shift: total })
    }
  }
  if (cuts.length === 0) return 0

  const shiftAt = (y: number): number => {
    let shift = 0
    for (const c of cuts) {
      if (y < c.from) break
      shift = c.shift
    }
    return shift
  }

  for (const s of seats) s.y = round2(s.y - shiftAt(s.y))
  // A box can straddle a cut only if it was the thing filling that band, which
  // cannot happen — but map both edges anyway so the general case is right.
  // Rotated boxes are moved whole: their drawn height is not their `height`.
  for (const o of objects) {
    const top = o.y - shiftAt(o.y)
    if (o.rotation === 0) {
      const bottom = o.y + o.height - shiftAt(o.y + o.height)
      o.height = round2(Math.max(MIN_OBJECT_HEIGHT, bottom - top))
    }
    o.y = round2(top)
  }
  for (const sh of shapes) {
    const top = sh.y - shiftAt(sh.y)
    const bottom = sh.y + sh.height - shiftAt(sh.y + sh.height)
    sh.y = round2(top)
    sh.height = round2(Math.max(1, bottom - top))
  }
  return cuts.length
}

/**
 * Re-anchor the map so every side has the same padding, and size the canvas to
 * the content edges. Edges, not centres: a seat is drawn as a circle around its
 * coordinate, so measuring to the coordinate alone would leave the top of the
 * map half a seat tighter than the bottom.
 */
function normalizeCanvas(
  seats: ImportSeat[],
  objects: MapObject[],
  shapes: SectorShape[],
): { width: number; height: number } {
  const half = TARGET_SEAT_GAP / 2
  const xs: number[] = []
  const ys: number[] = []
  for (const s of seats) {
    xs.push(s.x - half, s.x + half)
    ys.push(s.y - half, s.y + half)
  }
  for (const o of objects) {
    const b = objectBounds(o)
    xs.push(b.minX, b.maxX)
    ys.push(b.minY, b.maxY)
  }
  for (const sh of shapes) {
    xs.push(sh.x, sh.x + sh.width)
    ys.push(sh.y, sh.y + sh.height)
  }
  if (xs.length === 0)
    return { width: 2 * CANVAS_PADDING, height: 2 * CANVAS_PADDING }

  const dx = CANVAS_PADDING - Math.min(...xs)
  const dy = CANVAS_PADDING - Math.min(...ys)
  for (const s of seats) {
    s.x = round2(s.x + dx)
    s.y = round2(s.y + dy)
  }
  for (const o of objects) {
    o.x = round2(o.x + dx)
    o.y = round2(o.y + dy)
  }
  for (const sh of shapes) {
    sh.x = round2(sh.x + dx)
    sh.y = round2(sh.y + dy)
  }
  return {
    width: Math.ceil(Math.max(...xs) + dx + CANVAS_PADDING),
    height: Math.ceil(Math.max(...ys) + dy + CANVAS_PADDING),
  }
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
  const wheelchairHalls: {
    id: string
    name: string
    seats: number
    spread: number
  }[] = []
  let spreadGrandTotal = 0

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
          (hall.stats.collapsedBands
            ? `  [stlačené medzery ${hall.stats.collapsedBands}]`
            : '') +
          (hall.stats.wheelchairSeats
            ? `  [vozíčkari ${hall.stats.wheelchairSeats}]`
            : '') +
          (hall.stats.spreadSeats
            ? `  [rozostrené ${hall.stats.spreadSeats}]`
            : '') +
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
    spreadGrandTotal += hall.stats.spreadSeats
    if (hall.stats.wheelchairSeats > 0) {
      wheelchairHalls.push({
        id,
        name: hall.venueName,
        seats: hall.stats.wheelchairSeats,
        spread: hall.stats.spreadSeats,
      })
    }
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
  console.log(`Rozostrených nastackovaných miest: ${spreadGrandTotal}`)
  const wheelchairTotal = wheelchairHalls.reduce((n, w) => n + w.seats, 0)
  console.log(
    `Bezbariérových miest: ${wheelchairTotal} v ${wheelchairHalls.length} halách`,
  )
  for (const w of wheelchairHalls) {
    console.log(
      `  ♿ ${w.id.padStart(5)}  ${w.name.slice(0, 42).padEnd(42)} ` +
        `${String(w.seats).padStart(4)} miest` +
        (w.spread ? `  (z toho ${w.spread} rozostrených)` : ''),
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
