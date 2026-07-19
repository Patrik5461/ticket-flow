import { useMemo, useRef, useState } from 'react'
import type { EventSeatMap, BuyerSeat } from '../server/seat-map'
import { formatEur } from '../lib/money'

/**
 * Buyer seat picker: interactive SVG map (zoom/pan/pinch), colour by price
 * category + availability, tap/click to select. Screen-reader users get an
 * equivalent grouped checkbox list. Fully controlled via `selected`/`onChange`.
 */

const PALETTE = [
  '#6366f1',
  '#0ea5e9',
  '#22c55e',
  '#f59e0b',
  '#ec4899',
  '#14b8a6',
]

export function SeatPicker({
  map,
  selected,
  onChange,
  maxSeats = 20,
}: {
  map: EventSeatMap
  selected: string[]
  onChange: (ids: string[]) => void
  maxSeats?: number
}) {
  const [levelKey, setLevelKey] = useState(map.levels[0]?.key ?? 'main')
  const selectedSet = useMemo(() => new Set(selected), [selected])

  // Stable colour per ticket type (price category).
  const colorOf = useMemo(() => {
    const m = new Map<string, string>()
    map.ticketTypes.forEach((t, i) => m.set(t.id, PALETTE[i % PALETTE.length]))
    return m
  }, [map.ticketTypes])

  const levelSeats = map.seats.filter((s) => s.level === levelKey)
  const seatById = useMemo(
    () => new Map(map.seats.map((s) => [s.seatId, s])),
    [map.seats],
  )

  const toggle = (seat: BuyerSeat) => {
    if (seat.availability !== 'available') return
    if (selectedSet.has(seat.seatId)) {
      onChange(selected.filter((id) => id !== seat.seatId))
    } else {
      if (selected.length >= maxSeats) return
      onChange([...selected, seat.seatId])
    }
  }

  return (
    <div className="space-y-3">
      {map.levels.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {map.levels.map((lv) => (
            <button
              key={lv.key}
              onClick={() => setLevelKey(lv.key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                lv.key === levelKey
                  ? 'bg-accent text-white'
                  : 'border border-ink-700 text-ink-300 hover:bg-ink-800'
              }`}
            >
              {lv.name}
            </button>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-ink-300">
        {map.ticketTypes.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ background: colorOf.get(t.id) }}
            />
            {t.name} · {formatEur(t.priceCents)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full bg-ink-600" />
          obsadené
        </span>
      </div>

      <ZoomableMap
        key={levelKey}
        seats={levelSeats}
        colorOf={colorOf}
        selectedSet={selectedSet}
        onToggle={toggle}
      />

      {/* Screen-reader / no-pointer fallback: grouped checkbox list */}
      <details className="rounded-lg border border-ink-700">
        <summary className="cursor-pointer px-3 py-2 text-sm text-ink-200">
          Výber zo zoznamu (bez mapy)
        </summary>
        <div className="max-h-72 overflow-auto px-3 py-2">
          <SeatList
            seats={levelSeats}
            selectedSet={selectedSet}
            onToggle={toggle}
          />
        </div>
      </details>

      {/* Selected summary */}
      {selected.length > 0 && (
        <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-3 text-sm">
          <div className="mb-1 font-medium text-ink-100">
            Vybrané sedadlá ({selected.length})
          </div>
          <ul className="space-y-0.5 text-ink-300">
            {selected.map((id) => {
              const s = seatById.get(id)
              if (!s) return null
              return (
                <li key={id} className="flex justify-between">
                  <span>
                    {s.sector} · rad {s.rowLabel} · miesto {s.seatNumber}
                  </span>
                  <span>{formatEur(s.priceCents)}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

function ZoomableMap({
  seats,
  colorOf,
  selectedSet,
  onToggle,
}: {
  seats: BuyerSeat[]
  colorOf: Map<string, string>
  selectedSet: Set<string>
  onToggle: (s: BuyerSeat) => void
}) {
  const base = useMemo(() => {
    if (seats.length === 0) return { x: 0, y: 0, w: 400, h: 200 }
    const xs = seats.map((s) => s.x)
    const ys = seats.map((s) => s.y)
    const x = Math.min(...xs) - 20
    const y = Math.min(...ys) - 20
    return { x, y, w: Math.max(...xs) - x + 20, h: Math.max(...ys) - y + 20 }
  }, [seats])

  const [vb, setVb] = useState(base)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchDist = useRef(0)

  const clampZoom = (w: number) => {
    const minW = base.w * 0.2
    const maxW = base.w * 2
    if (w < minW) return (base.w * 0.2) / w
    if (w > maxW) return (base.w * 2) / w
    return 1
  }

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault()
    const factor = e.deltaY > 0 ? 1.1 : 0.9
    const rect = e.currentTarget.getBoundingClientRect()
    const px = vb.x + ((e.clientX - rect.left) / rect.width) * vb.w
    const py = vb.y + ((e.clientY - rect.top) / rect.height) * vb.h
    let nw = vb.w * factor
    let nh = vb.h * factor
    const c = clampZoom(nw)
    nw *= c
    nh *= c
    setVb({
      x: px - ((px - vb.x) * nw) / vb.w,
      y: py - ((py - vb.y) * nh) / vb.h,
      w: nw,
      h: nh,
    })
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId)
    pinchDist.current = 0
  }
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    const prev = pointers.current.get(e.pointerId)!
    const rect = e.currentTarget.getBoundingClientRect()
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]
    if (pts.length === 2) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      if (pinchDist.current) {
        const factor = pinchDist.current / d
        let nw = vb.w * factor
        let nh = vb.h * factor
        const c = clampZoom(nw)
        nw *= c
        nh *= c
        const cx = vb.x + vb.w / 2
        const cy = vb.y + vb.h / 2
        setVb({ x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh })
      }
      pinchDist.current = d
    } else if (pts.length === 1) {
      const dx = ((e.clientX - prev.x) / rect.width) * vb.w
      const dy = ((e.clientY - prev.y) / rect.height) * vb.h
      setVb((v) => ({ ...v, x: v.x - dx, y: v.y - dy }))
    }
  }

  const color = (s: BuyerSeat) => {
    if (selectedSet.has(s.seatId)) return '#22c55e'
    if (s.availability === 'available')
      return colorOf.get(s.ticketTypeId) ?? '#6366f1'
    return '#4b5563'
  }

  return (
    <div className="relative overflow-hidden rounded-lg border border-ink-700 bg-ink-950">
      <button
        onClick={() => setVb(base)}
        className="absolute right-2 top-2 z-10 rounded-md border border-ink-700 bg-ink-900/80 px-2 py-1 text-xs text-ink-200"
      >
        Reset
      </button>
      <svg
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        className="h-[24rem] w-full touch-none select-none"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerMove={onPointerMove}
      >
        {seats.map((s) => (
          <circle
            key={s.seatId}
            cx={s.x}
            cy={s.y}
            r={9}
            fill={color(s)}
            stroke={selectedSet.has(s.seatId) ? '#fff' : 'none'}
            strokeWidth={selectedSet.has(s.seatId) ? 1.5 : 0}
            style={{
              cursor:
                s.availability === 'available' ? 'pointer' : 'not-allowed',
            }}
            onClick={() => onToggle(s)}
          >
            <title>{`${s.sector} rad ${s.rowLabel} miesto ${s.seatNumber} — ${
              s.availability === 'available'
                ? formatEur(s.priceCents)
                : 'obsadené'
            }`}</title>
          </circle>
        ))}
      </svg>
    </div>
  )
}

function SeatList({
  seats,
  selectedSet,
  onToggle,
}: {
  seats: BuyerSeat[]
  selectedSet: Set<string>
  onToggle: (s: BuyerSeat) => void
}) {
  // Group by sector → row for readable navigation.
  const bySector = new Map<string, Map<string, BuyerSeat[]>>()
  for (const s of seats) {
    const rows = bySector.get(s.sector) ?? new Map<string, BuyerSeat[]>()
    const arr = rows.get(s.rowLabel) ?? []
    arr.push(s)
    rows.set(s.rowLabel, arr)
    bySector.set(s.sector, rows)
  }
  return (
    <div className="space-y-3">
      {[...bySector.entries()].sort().map(([sector, rows]) => (
        <fieldset key={sector}>
          <legend className="text-xs font-semibold text-ink-200">
            Sektor {sector}
          </legend>
          {[...rows.entries()].sort().map(([row, arr]) => (
            <div key={row} className="mt-1">
              <div className="text-xs text-ink-400">Rad {row}</div>
              <div className="flex flex-wrap gap-1.5">
                {arr
                  .sort((a, b) => Number(a.seatNumber) - Number(b.seatNumber))
                  .map((s) => {
                    const on = selectedSet.has(s.seatId)
                    const dis = s.availability !== 'available'
                    return (
                      <label
                        key={s.seatId}
                        className={`rounded border px-2 py-1 text-xs ${
                          dis
                            ? 'cursor-not-allowed border-ink-800 text-ink-600'
                            : on
                              ? 'border-accent bg-accent/20 text-ink-100'
                              : 'border-ink-700 text-ink-200'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={on}
                          disabled={dis}
                          onChange={() => onToggle(s)}
                        />
                        {s.seatNumber}
                      </label>
                    )
                  })}
              </div>
            </div>
          ))}
        </fieldset>
      ))}
    </div>
  )
}
