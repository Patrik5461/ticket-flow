import { useEffect, useMemo, useState } from 'react'
import type { EventSeatMap, BuyerSeat } from '../server/seat-map'
import {
  SEAT_R,
  objectPoints,
  seatHitRadius,
  zoomPercentOf,
} from '../lib/seating'
import type { MapObject } from '../lib/seating'
import {
  AreaHatchPattern,
  MapObjectShape,
  isStandingArea,
} from './MapObjectShape'
import { useCanvasViewport } from '../lib/use-canvas-viewport'
import { formatEur } from '../lib/money'

/**
 * A wheelchair place, marked by shape (square + glyph) because colour already
 * codes availability and price category.
 */
function WheelchairGlyph({
  x,
  y,
  r,
}: {
  x: number
  y: number
  r: number
}) {
  const s = r * 1.15
  return (
    <g
      transform={`translate(${x - s / 2} ${y - s / 2}) scale(${s / 24})`}
      style={{ pointerEvents: 'none' }}
    >
      <g
        fill="none"
        stroke="#fff"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx={11} cy={3.5} r={2.2} />
        <path d="M10 8v6h6l3 6" />
        <path d="M16 14a5.5 5.5 0 1 1-6-4" />
      </g>
    </g>
  )
}


/**
 * Buyer seat picker. The map is the primary control: it pans, zooms on the
 * cursor (wheel / pinch) and fits to screen, sharing `useCanvasViewport` with
 * the organizer's editor so there is one implementation of that maths.
 *
 * Seats keep a finger-sized hit area at any zoom via a transparent stroke, so
 * the drawn dot stays small while the target stays hittable. Dragging off a seat
 * pans instead of selecting; only a press that stays put counts as a tap.
 *
 * On phones the inline map is replaced by a button that opens a fullscreen
 * overlay, since a map squeezed into a 390 px column cannot be aimed at.
 * Screen-reader users get the equivalent grouped checkbox list either way.
 */

const PALETTE = [
  '#6366f1',
  '#0ea5e9',
  '#22c55e',
  '#f59e0b',
  '#ec4899',
  '#14b8a6',
]

const TAKEN_COLOR = '#4b5563'

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
  const [overlay, setOverlay] = useState(false)
  const selectedSet = useMemo(() => new Set(selected), [selected])

  // Stable colour per ticket type (price category).
  const colorOf = useMemo(() => {
    const m = new Map<string, string>()
    map.ticketTypes.forEach((t, i) => m.set(t.id, PALETTE[i % PALETTE.length]))
    return m
  }, [map.ticketTypes])

  const nameOf = useMemo(
    () => new Map(map.ticketTypes.map((t) => [t.id, t.name])),
    [map.ticketTypes],
  )

  const levelSeats = useMemo(
    () => map.seats.filter((s) => s.level === levelKey),
    [map.seats, levelKey],
  )
  // Stage and standing areas are part of the room, drawn under the seats.
  const levelObjects = useMemo(
    () => map.layout.levels.find((l) => l.key === levelKey)?.objects ?? [],
    [map.layout.levels, levelKey],
  )
  const seatById = useMemo(
    () => new Map(map.seats.map((s) => [s.seatId, s])),
    [map.seats],
  )

  const [limitHit, setLimitHit] = useState(false)
  const toggle = (seat: BuyerSeat) => {
    if (seat.availability !== 'available') return
    if (selectedSet.has(seat.seatId)) {
      setLimitHit(false)
      onChange(selected.filter((id) => id !== seat.seatId))
      return
    }
    if (selected.length >= maxSeats) return setLimitHit(true)
    setLimitHit(false)
    onChange([...selected, seat.seatId])
  }

  const selectedTotal = selected.reduce(
    (sum, id) => sum + (seatById.get(id)?.priceCents ?? 0),
    0,
  )

  const surface = (heightClass: string, wrapperClass?: string) => (
    <SeatMapSurface
      seats={levelSeats}
      objects={levelObjects}
      colorOf={colorOf}
      nameOf={nameOf}
      selectedSet={selectedSet}
      onToggle={toggle}
      fitKey={levelKey}
      heightClass={heightClass}
      wrapperClass={wrapperClass}
    />
  )

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

      <Legend
        ticketTypes={map.ticketTypes}
        colorOf={colorOf}
        hasWheelchair={levelSeats.some((s) => s.seatType === 'wheelchair')}
        hasArea={levelObjects.some(isStandingArea)}
      />


      {/* Desktop: the map is the main event. */}
      <div className="hidden md:block">
        {surface('h-[60vh] min-h-[420px] w-full')}
        <p className="mt-2 text-xs text-ink-500">
          Koliesko alebo <kbd>+</kbd>/<kbd>−</kbd> priblíži, ťahaním posuniete
          mapu, <span aria-hidden>⤢</span> zobrazí celú halu.
        </p>
      </div>

      {/* Phones: a button, because a map in a 390 px column cannot be aimed at. */}
      <div className="md:hidden">
        <button
          onClick={() => setOverlay(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-ink-700 bg-ink-900/60 px-4 py-3 text-sm font-semibold text-ink-100"
        >
          <span aria-hidden>🗺️</span>
          {selected.length > 0 ? 'Upraviť výber na mape' : 'Zobraziť mapu'}
        </button>
      </div>

      {limitHit && (
        <p className="text-xs text-amber-400">
          Naraz môžete kúpiť najviac {maxSeats} sedadiel.
        </p>
      )}

      <SelectedSeats
        ids={selected}
        seatById={seatById}
        nameOf={nameOf}
        total={selectedTotal}
        onRemove={(id) => onChange(selected.filter((x) => x !== id))}
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

      {overlay && (
        <MapOverlay
          onClose={() => setOverlay(false)}
          count={selected.length}
          total={selectedTotal}
        >
          <Legend
            ticketTypes={map.ticketTypes}
            colorOf={colorOf}
            compact
            hasWheelchair={levelSeats.some((s) => s.seatType === 'wheelchair')}
            hasArea={levelObjects.some(isStandingArea)}
          />

          {surface('h-full w-full', 'min-h-0 flex-1')}
        </MapOverlay>
      )}
    </div>
  )
}

function Legend({
  ticketTypes,
  colorOf,
  compact,
  hasWheelchair,
  hasArea,
}: {
  ticketTypes: { id: string; name: string; priceCents: number }[]
  colorOf: Map<string, string>
  compact?: boolean
  hasWheelchair?: boolean
  hasArea?: boolean
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-300 ${
        compact ? 'px-3 py-2' : ''
      }`}
    >
      {ticketTypes.map((t) => (
        <span key={t.id} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ background: colorOf.get(t.id) }}
          />
          {t.name} · {formatEur(t.priceCents)}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-full ring-2 ring-white ring-offset-1 ring-offset-ink-950" />
        vybrané
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block h-3 w-3 rounded-full"
          style={{ background: TAKEN_COLOR }}
        />
        obsadené
      </span>
      {hasWheelchair && (
        <span className="inline-flex items-center gap-1.5">
          <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden>
            <rect
              x={0.5}
              y={0.5}
              width={13}
              height={13}
              rx={1.5}
              fill={TAKEN_COLOR}
              opacity={0.35}
              stroke="currentColor"
            />
            <WheelchairGlyph x={7} y={7} r={6} />
          </svg>
          bezbariérové miesto
        </span>
      )}
      {hasArea && (
        <span className="inline-flex items-center gap-1.5">
          <svg width={16} height={12} viewBox="0 0 16 12" aria-hidden>
            <defs>
              <AreaHatchPattern />
            </defs>
            <rect
              x={0.75}
              y={0.75}
              width={14.5}
              height={10.5}
              rx={2}
              fill="rgba(99,102,241,0.15)"
              stroke="#818cf8"
              strokeDasharray="3 2"
            />
            <rect
              x={0.75}
              y={0.75}
              width={14.5}
              height={10.5}
              rx={2}
              fill="url(#areaHatch)"
            />
          </svg>
          plocha — počet zadáte v paneli
        </span>
      )}
    </div>

  )
}

function SeatMapSurface({
  seats,
  objects,
  colorOf,
  nameOf,
  selectedSet,
  onToggle,
  fitKey,
  heightClass,
  wrapperClass = '',
}: {
  seats: BuyerSeat[]
  objects: MapObject[]
  colorOf: Map<string, string>
  nameOf: Map<string, string>
  selectedSet: Set<string>
  onToggle: (s: BuyerSeat) => void
  fitKey: string
  heightClass: string
  wrapperClass?: string
}) {
  const seatById = useMemo(
    () => new Map(seats.map((s) => [s.seatId, s])),
    [seats],
  )
  const [tip, setTip] = useState<{
    seat: BuyerSeat
    x: number
    y: number
  } | null>(null)

  const points = useMemo(
    () => [...seats, ...objectPoints(objects)],
    [seats, objects],
  )
  const vp = useCanvasViewport({
    points,
    fitKey,
    onTap: (target) => {
      if (!target) return setTip(null)
      const s = seatById.get(target)
      if (s) onToggle(s)
    },
  })

  // Invisible stroke widens the target without redrawing the seat bigger.
  const hitR = seatHitRadius(vp.view.w, vp.pxWidth)
  const hitStroke = Math.max(0, hitR - SEAT_R) * 2
  const zoomPercent = zoomPercentOf(vp.view.w, vp.pxWidth)

  const color = (s: BuyerSeat) =>
    s.availability === 'available'
      ? (colorOf.get(s.ticketTypeId) ?? PALETTE[0])
      : TAKEN_COLOR

  const showTip = (s: BuyerSeat, clientX: number, clientY: number) => {
    const rect = vp.svgRef.current?.getBoundingClientRect()
    if (!rect) return
    setTip({ seat: s, x: clientX - rect.left, y: clientY - rect.top })
  }

  return (
    <div
      className={`relative overflow-hidden border-ink-700 bg-ink-950 ${
        wrapperClass || 'rounded-lg border'
      }`}
    >
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
        <span className="mr-1 rounded-md border border-ink-700 bg-ink-900/80 px-2 py-1 text-xs tabular-nums text-ink-300">
          {zoomPercent}%
        </span>
        <MapButton onClick={() => vp.zoomBy(1 / 1.3)} title="Priblížiť">
          +
        </MapButton>
        <MapButton onClick={() => vp.zoomBy(1.3)} title="Oddialiť">
          −
        </MapButton>
        <MapButton onClick={vp.fit} title="Zobraziť celú halu">
          ⤢
        </MapButton>
      </div>

      <svg
        ref={vp.svgRef}
        viewBox={vp.viewBox}
        className={`touch-none select-none ${heightClass}`}
        style={{ cursor: vp.panning ? 'grabbing' : 'default' }}
        {...vp.handlers}
        onPointerLeave={() => {
          vp.handlers.onPointerLeave()
          setTip(null)
        }}
      >
        <defs>
          <AreaHatchPattern />
        </defs>

        {/* Catches presses on empty space so panning works away from seats. */}
        <rect
          x={vp.view.x}
          y={vp.view.y}
          width={vp.view.w}
          height={vp.view.h}
          fill="transparent"
        />

        {objects.map((o) => {
          const stage = o.kind === 'stage'
          // A standing area sells by quantity from the panel, not by clicking a
          // spot on it. Hatching and a dashed edge say "this is not a seat", and
          // the caption says how to actually buy it.
          return (
            <MapObjectShape
              key={o.id}
              o={o}
              standing={isStandingArea(o)}
              fill={stage ? '#475569' : 'rgba(99,102,241,0.15)'}
              stroke={stage ? '#94a3b8' : '#818cf8'}
              textColor={stage ? '#f8fafc' : '#c7d2fe'}
            />
          )
        })}

        {seats.map((s) => {
          const sel = selectedSet.has(s.seatId)
          const free = s.availability === 'available'
          const wheelchair = s.seatType === 'wheelchair'
          const onDown = (e: React.PointerEvent) => {
            // Only a press that stays put selects; a drag pans the map.
            vp.tap(s.seatId)
            showTip(s, e.clientX, e.clientY)
          }
          const hitStyle = {
            pointerEvents: 'all',
            cursor: free ? 'pointer' : 'not-allowed',
          } as const
          return (
            <g key={s.seatId}>
              {/* Colour codes availability, so the shape has to carry
                  accessibility: a wheelchair place is a square with a glyph. */}
              {wheelchair ? (
                <>
                  <rect
                    x={s.x - SEAT_R}
                    y={s.y - SEAT_R}
                    width={SEAT_R * 2}
                    height={SEAT_R * 2}
                    rx={1.5}
                    fill={color(s)}
                    stroke="transparent"
                    strokeWidth={hitStroke}
                    style={hitStyle}
                    onPointerDown={onDown}
                    onPointerEnter={(e) => showTip(s, e.clientX, e.clientY)}
                  />
                  <WheelchairGlyph x={s.x} y={s.y} r={SEAT_R} />
                </>
              ) : (
                <circle
                  cx={s.x}
                  cy={s.y}
                  r={SEAT_R}
                  fill={color(s)}
                  stroke="transparent"
                  strokeWidth={hitStroke}
                  style={hitStyle}
                  onPointerDown={onDown}
                  onPointerEnter={(e) => showTip(s, e.clientX, e.clientY)}
                />
              )}
              {sel &&
                (wheelchair ? (
                  <rect
                    x={s.x - SEAT_R - 3}
                    y={s.y - SEAT_R - 3}
                    width={(SEAT_R + 3) * 2}
                    height={(SEAT_R + 3) * 2}
                    rx={2}
                    fill="none"
                    stroke="#fff"
                    strokeWidth={2.5}
                    style={{ pointerEvents: 'none' }}
                  />
                ) : (
                  <circle
                    cx={s.x}
                    cy={s.y}
                    r={SEAT_R + 3}
                    fill="none"
                    stroke="#fff"
                    strokeWidth={2.5}
                    style={{ pointerEvents: 'none' }}
                  />
                ))}
            </g>
          )
        })}

      </svg>

      {tip && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-md border border-ink-700 bg-ink-900/95 px-2 py-1 text-xs text-ink-100 shadow-lg"
          style={{ left: tip.x, top: tip.y - 10 }}
        >
          <div className="font-semibold">
            {tip.seat.sector} · rad {tip.seat.rowLabel} · miesto{' '}
            {tip.seat.seatNumber}
          </div>
          <div className="text-ink-300">
            {tip.seat.availability === 'available'
              ? `${nameOf.get(tip.seat.ticketTypeId) ?? 'Vstupenka'} · ${formatEur(
                  tip.seat.priceCents,
                )}`
              : 'obsadené'}
          </div>
        </div>
      )}
    </div>
  )
}

function MapButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="h-8 w-8 rounded-md border border-ink-700 bg-ink-900/80 text-sm leading-none text-ink-100 hover:bg-ink-800"
    >
      {children}
    </button>
  )
}

/** Fullscreen map for phones: the whole viewport, pinch-zoomable. */
function MapOverlay({
  children,
  onClose,
  count,
  total,
}: {
  children: React.ReactNode
  onClose: () => void
  count: number
  total: number
}) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-ink-950"
      role="dialog"
      aria-modal="true"
      aria-label="Mapa sedadiel"
    >
      <div className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
        <span className="text-sm font-semibold text-ink-100">
          Výber sedadiel
        </span>
        <button
          onClick={onClose}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white"
        >
          Hotovo
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
      <div className="flex items-center justify-between border-t border-ink-800 px-3 py-2 text-sm">
        <span className="text-ink-300">
          {count === 0 ? 'Žiadne sedadlo' : `Vybrané: ${count}`}
        </span>
        <span className="font-display font-bold text-ink-100">
          {formatEur(total)}
        </span>
      </div>
    </div>
  )
}

function SelectedSeats({
  ids,
  seatById,
  nameOf,
  total,
  onRemove,
}: {
  ids: string[]
  seatById: Map<string, BuyerSeat>
  nameOf: Map<string, string>
  total: number
  onRemove: (id: string) => void
}) {
  if (ids.length === 0) {
    return (
      <p className="text-sm text-ink-400">Vyberte sedadlá kliknutím na mapu.</p>
    )
  }
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-3 text-sm">
      <div className="mb-1.5 font-medium text-ink-100">
        Vybrané sedadlá ({ids.length})
      </div>
      <ul className="space-y-1">
        {ids.map((id) => {
          const s = seatById.get(id)
          if (!s) return null
          return (
            <li key={id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-ink-300">
                {s.sector} · rad {s.rowLabel} · miesto {s.seatNumber}
                <span className="ml-1 text-ink-500">
                  {nameOf.get(s.ticketTypeId) ?? ''}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="tabular-nums text-ink-200">
                  {formatEur(s.priceCents)}
                </span>
                <button
                  onClick={() => onRemove(id)}
                  aria-label={`Odobrať sedadlo ${s.sector} ${s.rowLabel}${s.seatNumber}`}
                  title="Odobrať"
                  className="h-6 w-6 rounded border border-ink-700 text-xs text-ink-300 hover:bg-ink-800 hover:text-ink-100"
                >
                  ×
                </button>
              </span>
            </li>
          )
        })}
      </ul>
      <div className="mt-2 flex justify-between border-t border-ink-700 pt-2 font-medium text-ink-100">
        <span>Sedadlá spolu</span>
        <span className="tabular-nums">{formatEur(total)}</span>
      </div>
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
