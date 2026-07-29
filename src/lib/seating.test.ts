import { describe, it, expect } from 'vitest'
import {
  MAX_VIEW_W,
  MIN_VIEW_W,
  alphaLabel,
  contentBounds,
  fitViewport,
  generateSeats,
  sectorsOf,
  zoomViewport,
} from './seating'
import type { Viewport } from './seating'

describe('alphaLabel', () => {
  it('produces spreadsheet-style letters', () => {
    expect(alphaLabel(0)).toBe('A')
    expect(alphaLabel(25)).toBe('Z')
    expect(alphaLabel(26)).toBe('AA')
    expect(alphaLabel(27)).toBe('AB')
  })
})

describe('generateSeats', () => {
  it('generates rows × seats with alpha rows and left→right numbering', () => {
    const seats = generateSeats({ sector: 'P', rows: 2, seatsPerRow: 3 })
    expect(seats).toHaveLength(6)
    expect(seats[0]).toMatchObject({
      sector: 'P',
      level: 'main',
      row_label: 'A',
      seat_number: '1',
      seat_type: 'standard',
    })
    expect(seats.map((s) => s.row_label)).toEqual([
      'A',
      'A',
      'A',
      'B',
      'B',
      'B',
    ])
    expect(seats.slice(0, 3).map((s) => s.seat_number)).toEqual(['1', '2', '3'])
    // x increases across a row, y increases across rows
    expect(seats[1].x).toBeGreaterThan(seats[0].x)
    expect(seats[3].y).toBeGreaterThan(seats[0].y)
  })

  it('honours numeric row labels and custom starts', () => {
    const seats = generateSeats({
      sector: 'B',
      rows: 2,
      seatsPerRow: 2,
      rowLabelStyle: 'numeric',
      rowLabelStart: '5',
      seatNumberStart: 10,
    })
    expect(seats.map((s) => s.row_label)).toEqual(['5', '5', '6', '6'])
    expect(seats.slice(0, 2).map((s) => s.seat_number)).toEqual(['10', '11'])
  })

  it('rtl direction puts seat #1 on the right (largest x)', () => {
    const seats = generateSeats({
      sector: 'B',
      rows: 1,
      seatsPerRow: 3,
      seatNumberDir: 'rtl',
    })
    const seat1 = seats.find((s) => s.seat_number === '1')!
    const seat3 = seats.find((s) => s.seat_number === '3')!
    expect(seat1.x).toBeGreaterThan(seat3.x)
  })

  it('alpha rows wrap past Z to AA', () => {
    const seats = generateSeats({ sector: 'X', rows: 27, seatsPerRow: 1 })
    expect(seats[25].row_label).toBe('Z')
    expect(seats[26].row_label).toBe('AA')
  })

  it('sectorsOf lists distinct sectors sorted', () => {
    expect(
      sectorsOf([{ sector: 'B' }, { sector: 'A' }, { sector: 'A' }]),
    ).toEqual(['A', 'B'])
  })
})

describe('editor viewport', () => {
  const view: Viewport = { x: 0, y: 0, w: 800, h: 400 }

  /** Where an SVG point lands on screen, given a viewport rendered at `scale`. */
  const project = (v: Viewport, p: { x: number; y: number }) => ({
    x: (p.x - v.x) / v.w,
    y: (p.y - v.y) / v.h,
  })

  it('contentBounds pads the extent of the points', () => {
    expect(
      contentBounds(
        [
          { x: 0, y: 0 },
          { x: 100, y: 50 },
        ],
        10,
      ),
    ).toEqual({
      minX: -10,
      minY: -10,
      maxX: 110,
      maxY: 60,
    })
  })

  it('contentBounds falls back to a frame when there is nothing to show', () => {
    const b = contentBounds([])
    expect(b.maxX).toBeGreaterThan(b.minX)
    expect(b.maxY).toBeGreaterThan(b.minY)
  })

  it('fitViewport grows the short axis instead of cropping', () => {
    // Content is 400x400; a 2:1 container must widen, never shrink the height.
    const v = fitViewport({ minX: 0, minY: 0, maxX: 400, maxY: 400 }, 2)
    expect(v.w / v.h).toBeCloseTo(2)
    expect(v.h).toBeGreaterThanOrEqual(400)
    expect(v.w).toBeGreaterThanOrEqual(400)
    // and it stays centred on the content
    expect(v.x + v.w / 2).toBeCloseTo(200)
    expect(v.y + v.h / 2).toBeCloseTo(200)
  })

  it('fitViewport keeps the whole content inside the frame', () => {
    const b = { minX: -50, minY: 10, maxX: 950, maxY: 110 }
    const v = fitViewport(b, 1)
    expect(v.x).toBeLessThanOrEqual(b.minX)
    expect(v.y).toBeLessThanOrEqual(b.minY)
    expect(v.x + v.w).toBeGreaterThanOrEqual(b.maxX)
    expect(v.y + v.h).toBeGreaterThanOrEqual(b.maxY)
  })

  it('zoomViewport pins the anchor to the same screen position', () => {
    const anchor = { x: 600, y: 300 }
    const before = project(view, anchor)
    const zoomed = zoomViewport(view, 0.5, anchor)
    expect(project(zoomed, anchor)).toEqual(before)
  })

  it('zoomViewport keeps the anchor pinned across a zoom in/out round trip', () => {
    const anchor = { x: 123, y: 45 }
    const out = zoomViewport(view, 2, anchor)
    const back = zoomViewport(out, 0.5, anchor)
    expect(back.x).toBeCloseTo(view.x)
    expect(back.y).toBeCloseTo(view.y)
    expect(back.w).toBeCloseTo(view.w)
    expect(back.h).toBeCloseTo(view.h)
  })

  it('zoomViewport preserves the aspect ratio', () => {
    const zoomed = zoomViewport(view, 0.37, { x: 10, y: 20 })
    expect(zoomed.w / zoomed.h).toBeCloseTo(view.w / view.h)
  })

  it('zoomViewport defaults to the centre when no anchor is given', () => {
    const zoomed = zoomViewport(view, 0.5)
    expect(zoomed.x + zoomed.w / 2).toBeCloseTo(view.x + view.w / 2)
    expect(zoomed.y + zoomed.h / 2).toBeCloseTo(view.y + view.h / 2)
  })

  it('zoomViewport clamps at both zoom limits', () => {
    expect(zoomViewport(view, 1e-9).w).toBe(MIN_VIEW_W)
    expect(zoomViewport(view, 1e9).w).toBe(MAX_VIEW_W)
  })

  it('zoomViewport is a no-op once clamped', () => {
    const deep = zoomViewport(view, 1e-9)
    expect(zoomViewport(deep, 0.5)).toBe(deep)
  })
})
