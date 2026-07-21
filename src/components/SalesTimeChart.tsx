import { useState } from 'react'
import { formatEur } from '../lib/money'
import type { SeriesPoint } from '../lib/daily-series'

/**
 * Sales over time for one event: the event day hour by hour, or the whole
 * pre-sale period day by day, showing either revenue or tickets sold.
 *
 * Bucketing happens on the server (lib/daily-series, event timezone, DST-safe);
 * this component only draws. The series arrives with the live snapshot, so the
 * chart moves together with the stat cards.
 */

type Range = 'day' | 'presale'
type Metric = 'revenue' | 'tickets'

const W = 720
const H = 180

export function SalesTimeChart({
  hourly,
  daily,
  eventDayLabel,
}: {
  hourly: SeriesPoint[]
  daily: SeriesPoint[]
  eventDayLabel: string
}) {
  const [range, setRange] = useState<Range>('presale')
  const [metric, setMetric] = useState<Metric>('revenue')

  const points = range === 'day' ? hourly : daily
  const valueOf = (p: SeriesPoint) =>
    metric === 'revenue' ? p.grossCents : p.tickets
  const fmt = (n: number) => (metric === 'revenue' ? formatEur(n) : String(n))

  const total = points.reduce((s, p) => s + valueOf(p), 0)
  const max = Math.max(1, ...points.map(valueOf))
  const stepX = points.length > 1 ? W / (points.length - 1) : W

  const coords = points.map((p, i) => {
    const x = points.length > 1 ? i * stepX : W / 2
    const y = H - (valueOf(p) / max) * (H - 12) - 6
    return { x, y, p }
  })
  const line = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(' ')
  const area = coords.length ? `${line} L ${W} ${H} L 0 ${H} Z` : ''
  // Guarded by the `points.length === 0` branch below, but typed as possibly
  // undefined for an empty array.
  const last = coords.at(-1)

  return (
    <section className="rounded-lg border bg-white p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Predaj v čase</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {range === 'day'
              ? `Deň podujatia · ${eventDayLabel}`
              : 'Predpredaj po dňoch'}{' '}
            · spolu {fmt(total)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Toggle
            options={[
              { id: 'presale', label: 'Predpredaj' },
              { id: 'day', label: 'Deň podujatia' },
            ]}
            value={range}
            onChange={(v) => setRange(v as Range)}
          />
          <Toggle
            options={[
              { id: 'revenue', label: 'Tržby' },
              { id: 'tickets', label: 'Predané' },
            ]}
            value={metric}
            onChange={(v) => setMetric(v as Metric)}
          />
        </div>
      </div>

      {points.length === 0 || total === 0 ? (
        <p className="py-10 text-center text-sm text-gray-400">
          {range === 'day'
            ? 'V deň podujatia zatiaľ žiadny predaj.'
            : 'Zatiaľ žiadny predaj.'}
        </p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-44 w-full"
            preserveAspectRatio="none"
            role="img"
            aria-label={`Graf: ${metric === 'revenue' ? 'tržby' : 'predané vstupenky'} v čase`}
          >
            <defs>
              <linearGradient id="salesArea" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#16a34a" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#16a34a" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0, 1, 2, 3].map((i) => (
              <line
                key={i}
                x1="0"
                x2={W}
                y1={(H / 3) * i}
                y2={(H / 3) * i}
                stroke="#e5e7eb"
                strokeDasharray="3 5"
                strokeWidth="1"
              />
            ))}
            <path d={area} fill="url(#salesArea)" />
            <path
              d={line}
              fill="none"
              stroke="#16a34a"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {last !== undefined && (
              <circle cx={last.x} cy={last.y} r="4" fill="#16a34a" />
            )}
            {/* Invisible hit areas so every bucket has a native tooltip. */}
            {coords.map((c) => (
              <rect
                key={c.p.key}
                x={c.x - stepX / 2}
                y={0}
                width={stepX}
                height={H}
                fill="transparent"
              >
                <title>{`${c.p.label} — ${formatEur(c.p.grossCents)} · ${c.p.tickets} vst. · ${c.p.orders} obj.`}</title>
              </rect>
            ))}
          </svg>
          <div className="mt-2 flex justify-between text-[10px] uppercase tracking-wider text-gray-400">
            <span>{points[0]?.label}</span>
            {points.length > 2 && (
              <span>{points[Math.floor(points.length / 2)]?.label}</span>
            )}
            <span>{points[points.length - 1]?.label}</span>
          </div>
        </>
      )}
    </section>
  )
}

function Toggle({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div className="inline-flex rounded-md border p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`rounded px-2.5 py-1 text-xs font-medium transition ${
            value === o.id
              ? 'bg-green-600 text-white'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
