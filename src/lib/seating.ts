/**
 * Seating domain — pure types + seat generation, shared by the map editor
 * (Block 3), the Maxiticket import, and the buyer seat picker. No DB/server
 * imports, so it is unit-testable and safe on both sides.
 */

export type SeatType = 'standard' | 'wheelchair' | 'blocked'

/** A generated/normalized seat (matches the `seats` table columns). */
export interface GeneratedSeat {
  level: string
  sector: string
  row_label: string
  seat_number: string
  x: number
  y: number
  seat_type: SeatType
}

/** One level (floor) of a map: parter / balkón / galéria, shown separately. */
export interface MapLevel {
  key: string
  name: string
  order: number
  canvas: { width: number; height: number }
  shapes: SectorShape[]
  /** Stage + standing areas. Absent in v1 layouts; migrateLayout fills it in. */
  objects: MapObject[]
}

/** A sector outline drawn on a level's canvas (editor + buyer render). */
export interface SectorShape {
  sector: string
  label?: string
  kind: 'rect' | 'arc'
  x: number
  y: number
  width: number
  height: number
}

/**
 * A non-seated box on the canvas.
 *
 *   stage   the stage / podium
 *   area    a standing area (parket, bar). With a capacity it sells as a
 *           quantity category — no individual seats, so the buyer picks a
 *           count, not a spot.
 *   wall | door | text | icon | shape
 *           decoration: it orients the buyer and nothing more. Never sellable
 *           (capacityAreas takes `area` only), never clicked. These come from
 *           the MaxiTicket halls, which draw a hall's walls, doors, captions
 *           and props alongside its seats.
 *
 * Adding a kind here is what lets it survive a save: saveSeatMapFn stores
 * migrateLayout's output, so a kind this list does not name is folded into
 * `area` on the way through — which would turn a wall into sellable floor.
 */
export type MapObjectKind =
  | 'stage'
  | 'area'
  | 'wall'
  | 'door'
  | 'text'
  | 'icon'
  | 'shape'

const MAP_OBJECT_KINDS = new Set<string>([
  'stage',
  'area',
  'wall',
  'door',
  'text',
  'icon',
  'shape',
] satisfies MapObjectKind[])

/** Default names, so a freshly added object is never a blank box. */
const DEFAULT_OBJECT_LABEL: Record<MapObjectKind, string> = {
  stage: 'Pódium',
  area: 'Plocha',
  // A decoration with no text is drawn without a caption, which is exactly
  // right: naming a wall „Plocha" would both mislabel it and read as sellable.
  wall: '',
  door: '',
  text: '',
  icon: '',
  shape: '',
}

export interface MapObject {
  id: string
  kind: MapObjectKind
  label: string
  /** Top-left of the *unrotated* rectangle; `rotation` spins it about its centre. */
  x: number
  y: number
  width: number
  height: number
  /** Degrees, clockwise. */
  rotation: number
  /** Standing capacity for `area`; null when the object does not sell tickets. */
  capacity: number | null
}

/**
 * Layout schema version. v1 had no `version` and no `objects`; migrateLayout
 * reads both and always hands the app a v2 value, so old maps keep opening.
 */
export const LAYOUT_VERSION = 2

export interface SeatMapLayout {
  version?: number
  levels: MapLevel[]
}

export interface SeatGenConfig {
  level?: string
  sector: string
  rows: number
  seatsPerRow: number
  rowLabelStyle?: 'alpha' | 'numeric' // 'A','B',… or '1','2',…
  rowLabelStart?: string // e.g. 'A' or '5'
  seatNumberStart?: number // default 1
  seatNumberDir?: 'ltr' | 'rtl' // seat #1 on the left (ltr) or right (rtl)
  originX?: number
  originY?: number
  seatGapX?: number
  rowGapY?: number
  seatType?: SeatType
  /** Sagitta of the first row's arc, in canvas units. 0 = straight rows. */
  curveDepth?: number
}

/** Default seat pitch across a row, in canvas units. */
export const DEFAULT_SEAT_GAP_X = 28
/** Default row pitch, in canvas units. */
export const DEFAULT_ROW_GAP_Y = 32

/** Spreadsheet-style column letters: 0→A, 25→Z, 26→AA, 27→AB … */
export function alphaLabel(index0: number): string {
  let n = index0
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

/** Zero-based offset of the first row label. */
function rowLabelOffset(style: 'alpha' | 'numeric', start?: string): number {
  if (!start) return 0
  if (style === 'alpha') {
    const c = start.trim().toUpperCase().charCodeAt(0)
    return c >= 65 && c <= 90 ? c - 65 : 0
  }
  const n = parseInt(start, 10)
  return Number.isFinite(n) && n > 0 ? n - 1 : 0
}

/**
 * Where a seat sits within its sector, for both fresh generation and respacing.
 *
 * With `curveDepth` 0 this is a plain grid. Above 0 the rows bend around a
 * common centre of curvature placed in front of the block — the way a theatre
 * wraps its rows around the stage — so a row's ends rise toward the stage while
 * every seat in it stays the same distance from it. `curveDepth` is the sagitta
 * of the first row: how far its ends rise above its middle, in canvas units.
 * Rows further back sit on wider circles, which keeps the seat gap constant
 * instead of fanning the block out.
 */
export interface SeatGrid {
  gapX: number
  gapY: number
  originX: number
  originY: number
  /** Widest row in the block — fixes the arc's half-width for every row. */
  cols: number
  curveDepth: number
}

/**
 * Radius whose arc of half-length `halfArc` rises exactly `depth` at its ends.
 *
 * Solves depth = R(1 − cos(halfArc/R)) by Newton. The textbook sagitta formula
 * is the chord version; measuring along the arc keeps the seat gap constant as
 * rows widen, so it is the one that matches how the seats are actually placed.
 * A few iterations converge well inside a pixel.
 */
export function arcRadius(halfArc: number, depth: number): number {
  if (halfArc <= 0 || depth <= 0) return 0
  // Past a quarter turn the row folds back on itself; clamp to something a hall
  // could plausibly look like.
  const d = Math.min(depth, halfArc)
  let r = (d * d + halfArc * halfArc) / (2 * d) // chord estimate: a good seed
  for (let i = 0; i < 8; i++) {
    const u = halfArc / r
    const f = r * (1 - Math.cos(u)) - d
    const df = 1 - Math.cos(u) - u * Math.sin(u)
    if (Math.abs(df) < 1e-12) break
    const next = r - f / df
    if (!Number.isFinite(next) || next <= halfArc / Math.PI) break
    r = next
    if (Math.abs(f) < 1e-9) break
  }
  return r
}

function seatPosition(
  grid: SeatGrid,
  row: number,
  col: number,
): { x: number; y: number } {
  const halfWidth = ((grid.cols - 1) * grid.gapX) / 2
  const curve = Math.max(0, grid.curveDepth)
  const radius0 = arcRadius(halfWidth, curve)
  if (radius0 <= 0) {
    return {
      x: grid.originX + col * grid.gapX,
      y: grid.originY + row * grid.gapY,
    }
  }
  const centerX = grid.originX + halfWidth
  const centerY = grid.originY - radius0
  const radius = radius0 + row * grid.gapY
  // Hold the arc length per row, so seats keep their spacing as rows widen.
  const theta = ((grid.cols - 1) * grid.gapX) / radius
  const step = grid.cols > 1 ? theta / (grid.cols - 1) : 0
  const angle = -theta / 2 + col * step
  return {
    x: centerX + radius * Math.sin(angle),
    y: centerY + radius * Math.cos(angle),
  }
}

/**
 * Generate a block of seats for one sector. Row labels run A,B,C… (or 1,2,3…);
 * seat numbers run from `seatNumberStart` across each row, left→right or
 * right→left. Straight by default, curved when `curveDepth` is set.
 */
export function generateSeats(cfg: SeatGenConfig): GeneratedSeat[] {
  const level = cfg.level ?? 'main'
  const seatType = cfg.seatType ?? 'standard'
  const gapX = cfg.seatGapX ?? DEFAULT_SEAT_GAP_X
  const gapY = cfg.rowGapY ?? DEFAULT_ROW_GAP_Y
  const ox = cfg.originX ?? 0
  const oy = cfg.originY ?? 0
  const numStart = cfg.seatNumberStart ?? 1
  const style = cfg.rowLabelStyle ?? 'alpha'
  const rowOffset = rowLabelOffset(style, cfg.rowLabelStart)
  const rows = Math.max(0, Math.floor(cfg.rows))
  const cols = Math.max(0, Math.floor(cfg.seatsPerRow))
  const grid: SeatGrid = {
    gapX,
    gapY,
    originX: ox,
    originY: oy,
    cols,
    curveDepth: cfg.curveDepth ?? 0,
  }

  const out: GeneratedSeat[] = []
  for (let r = 0; r < rows; r++) {
    const row_label =
      style === 'alpha' ? alphaLabel(rowOffset + r) : String(rowOffset + r + 1)
    for (let c = 0; c < cols; c++) {
      const seatNo = numStart + c
      const posCol = cfg.seatNumberDir === 'rtl' ? cols - 1 - c : c
      out.push({
        level,
        sector: cfg.sector,
        row_label,
        seat_number: String(seatNo),
        ...seatPosition(grid, r, posCol),
        seat_type: seatType,
      })
    }
  }
  return out
}

export interface RespaceOptions {
  seatGapX: number
  rowGapY: number
  curveDepth: number
}

/**
 * Re-lay an existing sector at new spacing/curvature, keeping its identity: row
 * labels and seat numbers are untouched, only coordinates move. Rows are read
 * off the current positions (top to bottom, then left to right within a row),
 * so a sector that was dragged or rotated still respaces sensibly, and the
 * block stays anchored at its current top-left corner.
 *
 * Returns a new array in the input order; seats outside the sector pass
 * through unchanged.
 */
export function respaceSector<T extends GeneratedSeat>(
  seats: T[],
  sector: string,
  opts: RespaceOptions,
): T[] {
  const target = seats.filter((s) => s.sector === sector)
  if (target.length === 0) return seats

  // Group into rows by label, ordered by where the rows currently sit.
  const rows = new Map<string, T[]>()
  for (const s of target) {
    const arr = rows.get(s.row_label) ?? []
    arr.push(s)
    rows.set(s.row_label, arr)
  }
  const ordered = [...rows.entries()]
    .map(([label, rowSeats]) => ({
      label,
      seats: [...rowSeats].sort((a, b) => a.x - b.x),
      top: Math.min(...rowSeats.map((s) => s.y)),
    }))
    .sort((a, b) => a.top - b.top || a.label.localeCompare(b.label))

  const grid: SeatGrid = {
    gapX: opts.seatGapX,
    gapY: opts.rowGapY,
    originX: Math.min(...target.map((s) => s.x)),
    originY: Math.min(...target.map((s) => s.y)),
    cols: Math.max(...ordered.map((r) => r.seats.length)),
    curveDepth: opts.curveDepth,
  }

  const moved = new Map<T, { x: number; y: number }>()
  ordered.forEach((row, r) =>
    row.seats.forEach((s, c) => moved.set(s, seatPosition(grid, r, c))),
  )
  // Curving pulls the block off its origin (the ends rise, the width narrows to
  // the chord), so re-anchor on the corner it started from — respacing must not
  // walk the sector across the canvas.
  const placed = [...moved.values()]
  const dx = grid.originX - Math.min(...placed.map((p) => p.x))
  const dy = grid.originY - Math.min(...placed.map((p) => p.y))
  return seats.map((s) => {
    const p = moved.get(s)
    return p ? { ...s, x: p.x + dx, y: p.y + dy } : s
  })
}

/** Distinct sectors present in a set of seats (for sector→price mapping). */
export function sectorsOf(seats: { sector: string }[]): string[] {
  return [...new Set(seats.map((s) => s.sector))].sort()
}

// ---------------------------------------------------------------------------
// Editor viewport
//
// The seat-map editor pans and zooms by moving the SVG viewBox rather than by
// CSS-transforming the rendered image, so the map stays vector-sharp at every
// zoom level. Every helper here preserves the viewport's aspect ratio, which is
// what makes zoomViewport's anchor formula exact.
// ---------------------------------------------------------------------------

export interface Viewport {
  x: number
  y: number
  w: number
  h: number
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** viewBox width limits — a smaller width means a deeper zoom. */
export const MIN_VIEW_W = 40
export const MAX_VIEW_W = 40_000

/** Padded extent of the given points, with a sane frame when there are none. */
export function contentBounds(
  points: { x: number; y: number }[],
  pad = 40,
): Bounds {
  if (points.length === 0)
    return { minX: -200, minY: -120, maxX: 200, maxY: 120 }
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return {
    minX: Math.min(...xs) - pad,
    minY: Math.min(...ys) - pad,
    maxX: Math.max(...xs) + pad,
    maxY: Math.max(...ys) + pad,
  }
}

/**
 * Frame `bounds` in a viewport of the given aspect (width/height). The result
 * is grown — never cropped — on the short axis, so the whole map stays visible
 * and nothing letterboxes.
 */
export function fitViewport(bounds: Bounds, aspect: number): Viewport {
  let w = Math.max(bounds.maxX - bounds.minX, MIN_VIEW_W)
  let h = Math.max(bounds.maxY - bounds.minY, 1)
  if (Number.isFinite(aspect) && aspect > 0) {
    if (w / h < aspect) w = h * aspect
    else h = w / aspect
  }
  return {
    x: (bounds.minX + bounds.maxX) / 2 - w / 2,
    y: (bounds.minY + bounds.maxY) / 2 - h / 2,
    w,
    h,
  }
}

/**
 * Scale the viewport by `factor` (>1 zooms out) while keeping `anchor` — a
 * point in SVG user units, typically under the cursor — pinned to the same
 * spot on screen. Defaults to the viewport centre. Clamped to the zoom limits.
 */
export function zoomViewport(
  view: Viewport,
  factor: number,
  anchor?: { x: number; y: number },
): Viewport {
  const w = Math.min(MAX_VIEW_W, Math.max(MIN_VIEW_W, view.w * factor))
  const k = w / view.w
  if (k === 1) return view
  const px = anchor ? anchor.x : view.x + view.w / 2
  const py = anchor ? anchor.y : view.y + view.h / 2
  return {
    x: px - (px - view.x) * k,
    y: py - (py - view.y) * k,
    w,
    h: view.h * k,
  }
}

// ---------------------------------------------------------------------------
// Layout migration
//
// The layout jsonb is written by the editor and read by the editor, the buyer
// picker and the event↔map bridge. Maps saved before stage/area objects existed
// carry no `version` and no `objects`, so every reader funnels the raw jsonb
// through migrateLayout and then works with one shape only.
// ---------------------------------------------------------------------------

const EMPTY_LAYOUT: SeatMapLayout = { version: LAYOUT_VERSION, levels: [] }

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function migrateObject(raw: unknown, index: number): MapObject | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  // A named kind is kept as it is, so a decoration survives the round trip
  // through the editor. Anything unknown still falls back to 'area' — an
  // unreadable object is better shown as a plain box than dropped.
  const kind: MapObjectKind = MAP_OBJECT_KINDS.has(o.kind as string)
    ? (o.kind as MapObjectKind)
    : 'area'
  const capacity =
    kind === 'area' && typeof o.capacity === 'number' && o.capacity > 0
      ? Math.floor(o.capacity)
      : null
  return {
    id: str(o.id) || `o${index + 1}`,
    kind,
    label: str(o.label, DEFAULT_OBJECT_LABEL[kind]),
    x: num(o.x),
    y: num(o.y),
    width: Math.max(MIN_OBJECT_SIZE, num(o.width, 200)),
    height: Math.max(MIN_OBJECT_SIZE, num(o.height, 60)),
    rotation: num(o.rotation),
    capacity,
  }
}

function migrateShape(raw: unknown): SectorShape | null {
  if (typeof raw !== 'object' || raw === null) return null
  const s = raw as Record<string, unknown>
  const sector = str(s.sector)
  if (!sector) return null
  return {
    sector,
    ...(typeof s.label === 'string' ? { label: s.label } : {}),
    kind: s.kind === 'arc' ? 'arc' : 'rect',
    x: num(s.x),
    y: num(s.y),
    width: num(s.width),
    height: num(s.height),
  }
}

/**
 * Normalize any stored layout (v1, v2, `{}`, null, or junk) into a v2 layout.
 * Never throws — a map that fails to parse opens as an empty canvas rather than
 * blocking the editor.
 */
export function migrateLayout(raw: unknown): SeatMapLayout {
  if (typeof raw !== 'object' || raw === null) return EMPTY_LAYOUT
  const levelsRaw = (raw as { levels?: unknown }).levels
  if (!Array.isArray(levelsRaw)) return EMPTY_LAYOUT
  const levels: MapLevel[] = []
  levelsRaw.forEach((lv, i) => {
    if (typeof lv !== 'object' || lv === null) return
    const l = lv as Record<string, unknown>
    const key = str(l.key)
    if (!key) return
    const canvas = (
      typeof l.canvas === 'object' && l.canvas !== null ? l.canvas : {}
    ) as Record<string, unknown>
    levels.push({
      key,
      name: str(l.name) || key,
      order: num(l.order, i),
      canvas: {
        width: num(canvas.width, 800),
        height: num(canvas.height, 600),
      },
      shapes: Array.isArray(l.shapes)
        ? l.shapes.map(migrateShape).filter((s): s is SectorShape => s !== null)
        : [],
      objects: Array.isArray(l.objects)
        ? l.objects.map(migrateObject).filter((o): o is MapObject => o !== null)
        : [],
    })
  })
  return { version: LAYOUT_VERSION, levels }
}

// ---------------------------------------------------------------------------
// Editor geometry
//
// Sectors are stored as plain seat coordinates, so rotating a sector rotates its
// seats — nothing downstream (buyer picker, event_seats) needs to know about
// angles. Objects carry their own rotation because they are drawn as one rect.
// ---------------------------------------------------------------------------

/** Grid step in SVG units for snap-to-grid. */
export const GRID_SIZE = 10
/** Objects never shrink below this, so a handle can always be grabbed back. */
export const MIN_OBJECT_SIZE = 20

export interface Point {
  x: number
  y: number
}

/** Round to the nearest grid step; `grid <= 0` leaves the value untouched. */
export function snap(value: number, grid = GRID_SIZE): number {
  return grid > 0 ? Math.round(value / grid) * grid : value
}

const rad = (deg: number) => (deg * Math.PI) / 180

/** Rotate `p` clockwise by `angle` degrees about `center` (SVG y grows down). */
export function rotatePoint(p: Point, angle: number, center: Point): Point {
  if (angle === 0) return { x: p.x, y: p.y }
  const a = rad(angle)
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const dx = p.x - center.x
  const dy = p.y - center.y
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  }
}

export function rotatePoints<T extends Point>(
  points: T[],
  angle: number,
  center: Point,
): T[] {
  return points.map((p) => ({ ...p, ...rotatePoint(p, angle, center) }))
}

/** Mean of the points — the pivot a sector rotates about. */
export function centroid(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  let sx = 0
  let sy = 0
  for (const p of points) {
    sx += p.x
    sy += p.y
  }
  return { x: sx / points.length, y: sy / points.length }
}

export function objectCenter(o: MapObject): Point {
  return { x: o.x + o.width / 2, y: o.y + o.height / 2 }
}

/** The object's four corners in world units, rotation applied: nw, ne, se, sw. */
export function objectCorners(o: MapObject): Point[] {
  const c = objectCenter(o)
  return [
    { x: o.x, y: o.y },
    { x: o.x + o.width, y: o.y },
    { x: o.x + o.width, y: o.y + o.height },
    { x: o.x, y: o.y + o.height },
  ].map((p) => rotatePoint(p, o.rotation, c))
}

/** Axis-aligned extent of a rotated object — what fit-to-screen must cover. */
export function objectBounds(o: MapObject): Bounds {
  const pts = objectCorners(o)
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
}

/** Corner points of every object, so contentBounds can frame them with seats. */
export function objectPoints(objects: MapObject[]): Point[] {
  return objects.flatMap(objectCorners)
}

export type ResizeHandle = 'nw' | 'ne' | 'se' | 'sw'

const HANDLE_OPPOSITE: Record<ResizeHandle, ResizeHandle> = {
  nw: 'se',
  ne: 'sw',
  se: 'nw',
  sw: 'ne',
}

/** Corner of the *unrotated* rectangle (the frame resizing works in). */
function localCorner(o: MapObject, handle: ResizeHandle): Point {
  const right = handle === 'ne' || handle === 'se'
  const bottom = handle === 'se' || handle === 'sw'
  return {
    x: right ? o.x + o.width : o.x,
    y: bottom ? o.y + o.height : o.y,
  }
}

/**
 * Drag `handle` to `pointer` (world units), keeping the opposite corner nailed
 * in place. The maths runs in the object's own unrotated frame, so resizing a
 * rotated object still feels like dragging along its edges.
 */
export function resizeObject(
  o: MapObject,
  handle: ResizeHandle,
  pointer: Point,
  grid = 0,
): MapObject {
  const c = objectCenter(o)
  // Un-rotate the pointer, resize as if the object were axis-aligned, then put
  // the rotation back on the resulting centre.
  const local = rotatePoint(pointer, -o.rotation, c)
  const fixed = localCorner(o, HANDLE_OPPOSITE[handle])
  let px = snap(local.x, grid)
  let py = snap(local.y, grid)
  if (Math.abs(px - fixed.x) < MIN_OBJECT_SIZE) {
    px = fixed.x + (px < fixed.x ? -MIN_OBJECT_SIZE : MIN_OBJECT_SIZE)
  }
  if (Math.abs(py - fixed.y) < MIN_OBJECT_SIZE) {
    py = fixed.y + (py < fixed.y ? -MIN_OBJECT_SIZE : MIN_OBJECT_SIZE)
  }
  const width = Math.abs(px - fixed.x)
  const height = Math.abs(py - fixed.y)
  const centerWorld = rotatePoint(
    { x: (fixed.x + px) / 2, y: (fixed.y + py) / 2 },
    o.rotation,
    c,
  )
  return {
    ...o,
    x: centerWorld.x - width / 2,
    y: centerWorld.y - height / 2,
    width,
    height,
  }
}

/** Move an object by a delta, snapping its top-left corner when the grid is on. */
export function moveObject(o: MapObject, dx: number, dy: number, grid = 0) {
  return { ...o, x: snap(o.x + dx, grid), y: snap(o.y + dy, grid) }
}

/** Angle of `pointer` seen from the object's centre, in the same units as rotation. */
export function angleFromCenter(o: MapObject, pointer: Point): number {
  const c = objectCenter(o)
  return (Math.atan2(pointer.y - c.y, pointer.x - c.x) * 180) / Math.PI
}

/** Fold any angle into [0, 360). */
export function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/** Next free `oN` id, so ids stay unique after a map is reopened. */
export function nextObjectId(existing: string[]): string {
  let max = 0
  for (const id of existing) {
    const m = /^o(\d+)$/.exec(id)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `o${max + 1}`
}

/** „A" → „A (kópia)" → „A (kópia 2)"… never colliding with an existing name. */
export function nextCopyName(existing: string[], base: string): string {
  const taken = new Set(existing)
  const root = base.replace(/ \(kópia( \d+)?\)$/, '')
  for (let i = 1; ; i++) {
    const name = i === 1 ? `${root} (kópia)` : `${root} (kópia ${i})`
    if (!taken.has(name)) return name.slice(0, 60)
  }
}

// ---------------------------------------------------------------------------
// Areas → sales
//
// A standing area sells as an ordinary quantity category, so the event↔map
// bridge stores its price mapping next to the sector mappings. Area keys are
// namespaced with '#', which sector names may not start with.
// ---------------------------------------------------------------------------

export const AREA_KEY_PREFIX = '#'

export function areaPricingKey(objectId: string): string {
  return `${AREA_KEY_PREFIX}${objectId}`
}

export function isAreaPricingKey(key: string): boolean {
  return key.startsWith(AREA_KEY_PREFIX)
}

export function areaIdFromPricingKey(key: string): string | null {
  return isAreaPricingKey(key) ? key.slice(AREA_KEY_PREFIX.length) : null
}

export interface CapacityArea {
  id: string
  label: string
  capacity: number
  level: string
}

/**
 * Every area that sells standing tickets, across all levels of a layout.
 *
 * `kind === 'area'` is the whole gate, and it is deliberately the only one: a
 * stage or a decoration can never sell, whatever a stored `capacity` claims.
 * migrateObject already drops capacity off every other kind, so this is the
 * second of two locks on the same door.
 */
export function capacityAreas(layout: SeatMapLayout): CapacityArea[] {
  const out: CapacityArea[] = []
  for (const lv of layout.levels) {
    for (const o of lv.objects) {
      if (o.kind === 'area' && o.capacity && o.capacity > 0) {
        out.push({
          id: o.id,
          label: o.label || 'Plocha',
          capacity: o.capacity,
          level: lv.key,
        })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Rendered seat metrics
//
// Both maps draw a seat as a small circle, but the *touchable* area has to stay
// finger-sized on screen no matter how far out the map is zoomed. These convert
// between screen pixels and canvas units for that.
// ---------------------------------------------------------------------------

/** Drawn seat radius in canvas units. */
export const SEAT_R = 9
/** Smallest comfortable tap target, in CSS pixels (Apple/Material guidance). */
export const MIN_HIT_PX = 24
/**
 * Hard ceiling on the hit radius, in canvas units: half the seat pitch. Any
 * larger and the target would reach into the neighbouring seat, so a tap would
 * land on the wrong one — worse than a small target. Dense maps are meant to be
 * zoomed into; this keeps the tap honest at every zoom.
 */
export const MAX_HIT_R = DEFAULT_SEAT_GAP_X / 2

/**
 * Radius (canvas units) that makes a seat about `MIN_HIT_PX` wide on screen,
 * growing as the viewport widens (i.e. as the map zooms out) but never past
 * `MAX_HIT_R`, so the target can't swallow the seat next to it.
 */
export function seatHitRadius(
  viewW: number,
  pxWidth: number,
  seatR = SEAT_R,
): number {
  if (!(viewW > 0) || !(pxWidth > 0)) return seatR
  const unitsPerPx = viewW / pxWidth
  return Math.min(MAX_HIT_R, Math.max(seatR, (MIN_HIT_PX / 2) * unitsPerPx))
}

/** Zoom readout: 100% is one canvas unit per CSS pixel. */
export function zoomPercentOf(viewW: number, pxWidth: number): number {
  if (!(viewW > 0) || !(pxWidth > 0)) return 100
  return Math.round((pxWidth / viewW) * 100)
}
