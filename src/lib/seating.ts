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

export interface SeatMapLayout {
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
}

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
 * Generate a rectangular block of seats for one sector. Row labels run A,B,C…
 * (or 1,2,3…); seat numbers run from `seatNumberStart` across each row, left→
 * right or right→left. Coordinates are laid out on a grid for the canvas.
 */
export function generateSeats(cfg: SeatGenConfig): GeneratedSeat[] {
  const level = cfg.level ?? 'main'
  const seatType = cfg.seatType ?? 'standard'
  const gapX = cfg.seatGapX ?? 28
  const gapY = cfg.rowGapY ?? 32
  const ox = cfg.originX ?? 0
  const oy = cfg.originY ?? 0
  const numStart = cfg.seatNumberStart ?? 1
  const style = cfg.rowLabelStyle ?? 'alpha'
  const rowOffset = rowLabelOffset(style, cfg.rowLabelStart)
  const rows = Math.max(0, Math.floor(cfg.rows))
  const cols = Math.max(0, Math.floor(cfg.seatsPerRow))

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
        x: ox + posCol * gapX,
        y: oy + r * gapY,
        seat_type: seatType,
      })
    }
  }
  return out
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
