import { describe, it, expect } from 'vitest'
import {
  LAYOUT_VERSION,
  MAX_VIEW_W,
  MIN_OBJECT_SIZE,
  MIN_VIEW_W,
  alphaLabel,
  areaIdFromPricingKey,
  areaPricingKey,
  capacityAreas,
  centroid,
  contentBounds,
  fitViewport,
  generateSeats,
  migrateLayout,
  moveObject,
  respaceSector,
  nextCopyName,
  nextObjectId,
  normalizeAngle,
  objectBounds,
  objectCorners,
  resizeObject,
  rotatePoint,
  rotatePoints,
  MAX_HIT_R,
  seatHitRadius,
  sectorsOf,
  snap,
  SEAT_R,
  zoomPercentOf,
  zoomViewport,
} from './seating'
import type { MapObject, Viewport } from './seating'

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

describe('layout migration', () => {
  it('reads a v1 layout and fills in the object list', () => {
    const v1 = {
      levels: [
        {
          key: 'parter',
          name: 'parter',
          order: 0,
          canvas: { width: 500, height: 300 },
          shapes: [
            { sector: 'A', kind: 'rect', x: 0, y: 0, width: 100, height: 50 },
          ],
        },
      ],
    }
    const out = migrateLayout(v1)
    expect(out.version).toBe(LAYOUT_VERSION)
    expect(out.levels).toHaveLength(1)
    expect(out.levels[0].shapes).toHaveLength(1)
    expect(out.levels[0].objects).toEqual([])
  })

  it('keeps v2 objects and defaults their missing fields', () => {
    const out = migrateLayout({
      version: 2,
      levels: [
        {
          key: 'parter',
          shapes: [],
          objects: [
            { id: 'o1', kind: 'stage', label: 'Pódium', x: 10, y: 20 },
            { kind: 'area', label: 'Parket', capacity: 250 },
          ],
        },
      ],
    })
    const [stage, area] = out.levels[0].objects
    expect(stage).toMatchObject({ id: 'o1', kind: 'stage', x: 10, y: 20 })
    expect(stage.rotation).toBe(0)
    expect(stage.capacity).toBeNull()
    // A missing id still has to be unique within the level.
    expect(area.id).toBe('o2')
    expect(area.capacity).toBe(250)
    expect(area.width).toBeGreaterThanOrEqual(MIN_OBJECT_SIZE)
  })

  it('drops a stage capacity — only areas sell standing tickets', () => {
    const out = migrateLayout({
      levels: [
        {
          key: 'p',
          objects: [{ id: 'o1', kind: 'stage', capacity: 100 }],
        },
      ],
    })
    expect(out.levels[0].objects[0].capacity).toBeNull()
  })

  it('survives junk instead of throwing', () => {
    expect(migrateLayout(null).levels).toEqual([])
    expect(migrateLayout({}).levels).toEqual([])
    expect(migrateLayout({ levels: 'nope' }).levels).toEqual([])
    expect(
      migrateLayout({ levels: [null, { name: 'no key' }] }).levels,
    ).toEqual([])
  })
})

describe('geometry', () => {
  const obj = (over: Partial<MapObject> = {}): MapObject => ({
    id: 'o1',
    kind: 'area',
    label: 'Parket',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    rotation: 0,
    capacity: null,
    ...over,
  })

  it('snaps to the grid, and leaves values alone without one', () => {
    expect(snap(23, 10)).toBe(20)
    expect(snap(26, 10)).toBe(30)
    expect(snap(-23, 10)).toBe(-20)
    expect(snap(23.4, 0)).toBe(23.4)
  })

  it('rotates a point clockwise about a centre', () => {
    const p = rotatePoint({ x: 10, y: 0 }, 90, { x: 0, y: 0 })
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(10) // SVG y grows downwards
  })

  it('rotating a sector keeps its centroid and its shape', () => {
    const seats = [
      { x: 0, y: 0, cid: 'a' },
      { x: 100, y: 0, cid: 'b' },
      { x: 100, y: 40, cid: 'c' },
      { x: 0, y: 40, cid: 'd' },
    ]
    const c = centroid(seats)
    const turned = rotatePoints(seats, 90, c)
    expect(centroid(turned).x).toBeCloseTo(c.x)
    expect(centroid(turned).y).toBeCloseTo(c.y)
    // distances from the pivot are preserved, and the extra fields ride along
    seats.forEach((s, i) => {
      expect(Math.hypot(turned[i].x - c.x, turned[i].y - c.y)).toBeCloseTo(
        Math.hypot(s.x - c.x, s.y - c.y),
      )
      expect(turned[i].cid).toBe(s.cid)
    })
  })

  it('four 90° turns return a sector to where it started', () => {
    const seats = [
      { x: 3, y: 7 },
      { x: 55, y: 12 },
    ]
    const c = centroid(seats)
    let out = seats
    for (let i = 0; i < 4; i++) out = rotatePoints(out, 90, c)
    out.forEach((p, i) => {
      expect(p.x).toBeCloseTo(seats[i].x)
      expect(p.y).toBeCloseTo(seats[i].y)
    })
  })

  it('objectBounds covers a rotated object', () => {
    const b = objectBounds(obj({ rotation: 45 }))
    const plain = objectBounds(obj())
    // A rotated rectangle needs a wider axis-aligned box than a flat one.
    expect(b.maxY - b.minY).toBeGreaterThan(plain.maxY - plain.minY)
    // …and it stays centred on the object.
    expect((b.minX + b.maxX) / 2).toBeCloseTo(200)
    expect((b.minY + b.maxY) / 2).toBeCloseTo(150)
  })

  it('resize keeps the opposite corner nailed in place', () => {
    const o = obj()
    const fixed = objectCorners(o)[0] // nw stays put while se is dragged
    const out = resizeObject(o, 'se', { x: 400, y: 260 })
    expect(out.width).toBeCloseTo(300)
    expect(out.height).toBeCloseTo(160)
    const after = objectCorners(out)[0]
    expect(after.x).toBeCloseTo(fixed.x)
    expect(after.y).toBeCloseTo(fixed.y)
  })

  it('resize of a rotated object still pins the opposite corner', () => {
    const o = obj({ rotation: 30 })
    const fixed = objectCorners(o)[3] // dragging ne pins sw
    const out = resizeObject(o, 'ne', { x: 500, y: -50 })
    const after = objectCorners(out)[3]
    expect(after.x).toBeCloseTo(fixed.x)
    expect(after.y).toBeCloseTo(fixed.y)
    expect(out.rotation).toBe(30)
  })

  it('resize snaps to the grid and refuses to collapse the object', () => {
    const snapped = resizeObject(obj(), 'se', { x: 403, y: 258 }, 10)
    expect(snapped.width).toBeCloseTo(300)
    expect(snapped.height).toBeCloseTo(160)
    // Dragging the handle onto the fixed corner keeps a grabbable minimum.
    const tiny = resizeObject(obj(), 'se', { x: 100, y: 100 })
    expect(tiny.width).toBe(MIN_OBJECT_SIZE)
    expect(tiny.height).toBe(MIN_OBJECT_SIZE)
  })

  it('moveObject snaps the corner only when a grid is given', () => {
    expect(moveObject(obj(), 3, 4, 10)).toMatchObject({ x: 100, y: 100 })
    expect(moveObject(obj(), 7, 8, 10)).toMatchObject({ x: 110, y: 110 })
    expect(moveObject(obj(), 3.5, 4.5, 0)).toMatchObject({ x: 103.5, y: 104.5 })
  })

  it('normalizeAngle folds into [0, 360)', () => {
    expect(normalizeAngle(-90)).toBe(270)
    expect(normalizeAngle(360)).toBe(0)
    expect(normalizeAngle(725)).toBe(5)
  })
})

describe('naming and area keys', () => {
  it('nextObjectId skips ids already in the map', () => {
    expect(nextObjectId([])).toBe('o1')
    expect(nextObjectId(['o1', 'o4', 'weird'])).toBe('o5')
  })

  it('nextCopyName never collides and does not stack suffixes', () => {
    expect(nextCopyName(['A'], 'A')).toBe('A (kópia)')
    expect(nextCopyName(['A', 'A (kópia)'], 'A')).toBe('A (kópia 2)')
    // Duplicating a copy stays "A (kópia N)", not "A (kópia) (kópia)".
    expect(nextCopyName(['A', 'A (kópia)'], 'A (kópia)')).toBe('A (kópia 2)')
  })

  it('area pricing keys round-trip and stay out of the sector namespace', () => {
    const key = areaPricingKey('o7')
    expect(areaIdFromPricingKey(key)).toBe('o7')
    expect(areaIdFromPricingKey('A')).toBeNull()
  })

  it('capacityAreas lists only areas that actually sell', () => {
    const layout = migrateLayout({
      levels: [
        {
          key: 'parter',
          objects: [
            { id: 'o1', kind: 'stage', label: 'Pódium' },
            { id: 'o2', kind: 'area', label: 'Parket', capacity: 300 },
            { id: 'o3', kind: 'area', label: 'Bar' }, // no capacity → not sold
          ],
        },
      ],
    })
    expect(capacityAreas(layout)).toEqual([
      { id: 'o2', label: 'Parket', capacity: 300, level: 'parter' },
    ])
  })
})

describe('curved rows', () => {
  it('curveDepth 0 keeps the plain grid', () => {
    const straight = generateSeats({ sector: 'A', rows: 2, seatsPerRow: 5 })
    const zero = generateSeats({
      sector: 'A',
      rows: 2,
      seatsPerRow: 5,
      curveDepth: 0,
    })
    expect(zero).toEqual(straight)
  })

  it('bends a row so its ends rise toward the stage', () => {
    const seats = generateSeats({
      sector: 'A',
      rows: 1,
      seatsPerRow: 5,
      curveDepth: 20,
    })
    const ys = seats.map((s) => s.y)
    const middle = ys[2]
    // Stage is up-canvas, so the ends wrap toward it: smaller y than the middle.
    expect(ys[0]).toBeLessThan(middle)
    expect(ys[4]).toBeLessThan(middle)
    // symmetric about the centre seat
    expect(ys[0]).toBeCloseTo(ys[4])
    expect(ys[1]).toBeCloseTo(ys[3])
  })

  it('the first row rises by exactly curveDepth', () => {
    const seats = generateSeats({
      sector: 'A',
      rows: 1,
      seatsPerRow: 9,
      curveDepth: 25,
    })
    const ys = seats.map((s) => s.y)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(25)
  })

  it('keeps the seat gap constant as rows widen', () => {
    const seats = generateSeats({
      sector: 'A',
      rows: 4,
      seatsPerRow: 8,
      seatGapX: 30,
      curveDepth: 30,
    })
    const gapIn = (row: string) => {
      const r = seats.filter((s) => s.row_label === row)
      return Math.hypot(r[1].x - r[0].x, r[1].y - r[0].y)
    }
    expect(gapIn('D')).toBeCloseTo(gapIn('A'), 1)
  })

  it('rows still march away from the stage', () => {
    const seats = generateSeats({
      sector: 'A',
      rows: 3,
      seatsPerRow: 7,
      rowGapY: 32,
      curveDepth: 20,
    })
    const mid = (row: string) =>
      seats.filter((s) => s.row_label === row).map((s) => s.y)[3]
    expect(mid('B') - mid('A')).toBeCloseTo(32)
    expect(mid('C') - mid('B')).toBeCloseTo(32)
  })

  it('survives a single-seat row', () => {
    const seats = generateSeats({
      sector: 'A',
      rows: 2,
      seatsPerRow: 1,
      curveDepth: 20,
    })
    expect(seats).toHaveLength(2)
    expect(
      seats.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y)),
    ).toBe(true)
  })
})

describe('respaceSector', () => {
  const block = () =>
    generateSeats({ sector: 'A', rows: 3, seatsPerRow: 4, seatGapX: 20 })

  it('widens the seat gap without touching labels or numbers', () => {
    const before = block()
    const after = respaceSector(before, 'A', {
      seatGapX: 40,
      rowGapY: 32,
      curveDepth: 0,
    })
    expect(after.map((s) => `${s.row_label}${s.seat_number}`)).toEqual(
      before.map((s) => `${s.row_label}${s.seat_number}`),
    )
    const rowA = after.filter((s) => s.row_label === 'A')
    expect(rowA[1].x - rowA[0].x).toBeCloseTo(40)
  })

  it('leaves other sectors alone', () => {
    const mixed = [
      ...block(),
      ...generateSeats({ sector: 'B', rows: 1, seatsPerRow: 2, originY: 500 }),
    ]
    const after = respaceSector(mixed, 'A', {
      seatGapX: 50,
      rowGapY: 50,
      curveDepth: 0,
    })
    const b = after.filter((s) => s.sector === 'B')
    expect(b).toEqual(mixed.filter((s) => s.sector === 'B'))
  })

  it('keeps the block anchored at its current top-left', () => {
    const before = generateSeats({
      sector: 'A',
      rows: 2,
      seatsPerRow: 3,
      originX: 120,
      originY: 80,
    })
    const after = respaceSector(before, 'A', {
      seatGapX: 60,
      rowGapY: 60,
      curveDepth: 0,
    })
    expect(Math.min(...after.map((s) => s.x))).toBeCloseTo(120)
    expect(Math.min(...after.map((s) => s.y))).toBeCloseTo(80)
  })

  it('can curve a sector that was generated straight', () => {
    const after = respaceSector(block(), 'A', {
      seatGapX: 20,
      rowGapY: 32,
      curveDepth: 15,
    })
    const rowA = after.filter((s) => s.row_label === 'A')
    expect(rowA[0].y).toBeLessThan(rowA[1].y)
  })

  it('is a no-op for an unknown sector', () => {
    const before = block()
    expect(
      respaceSector(before, 'ZZZ', {
        seatGapX: 99,
        rowGapY: 99,
        curveDepth: 0,
      }),
    ).toBe(before)
  })
})

describe('rendered seat metrics', () => {
  it('keeps the hit target finger-sized as the map zooms out', () => {
    // Zoomed in: a seat is already far wider than the minimum, so leave it be.
    expect(seatHitRadius(400, 800)).toBe(SEAT_R)
    // 800 units across 400 px is 2 units/px, so 24 px asks for r=24 → capped.
    expect(seatHitRadius(800, 400)).toBe(MAX_HIT_R)
    // Never smaller than the drawn circle, and safe before the first measure.
    expect(seatHitRadius(4000, 0)).toBe(SEAT_R)
    expect(seatHitRadius(0, 400)).toBe(SEAT_R)
  })

  it('never lets the hit area reach the neighbouring seat', () => {
    // Default seat pitch is 28 units; a radius over 14 would overlap.
    expect(MAX_HIT_R).toBeLessThanOrEqual(14)
    // However far out the map is zoomed, the cap holds.
    for (const w of [1000, 10_000, 40_000])
      expect(seatHitRadius(w, 390)).toBeLessThanOrEqual(MAX_HIT_R)
  })

  it('the hit radius grows monotonically with the viewport width', () => {
    const widths = [200, 800, 1600, 6400]
    const radii = widths.map((w) => seatHitRadius(w, 500))
    for (let i = 1; i < radii.length; i++)
      expect(radii[i]).toBeGreaterThanOrEqual(radii[i - 1])
  })

  it('zoomPercentOf reads 100% at one unit per pixel', () => {
    expect(zoomPercentOf(800, 800)).toBe(100)
    expect(zoomPercentOf(400, 800)).toBe(200)
    expect(zoomPercentOf(1600, 800)).toBe(50)
    expect(zoomPercentOf(0, 800)).toBe(100)
  })
})
