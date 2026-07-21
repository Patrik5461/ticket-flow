import { formatEur } from '../lib/money'
import type { DailyPoint } from '../lib/daily-series'

/** Bar chart of daily gross sales. Shared by the admin overview + organizer detail. */
export function SalesChart({
  daily,
  title = 'Predaj v čase',
}: {
  daily: DailyPoint[]
  title?: string
}) {
  const max = Math.max(1, ...daily.map((d) => d.grossCents))
  const totalOrders = daily.reduce((s, d) => s + d.orders, 0)
  const fmtDay = (key: string) => {
    const [, m, d] = key.split('-')
    return `${Number(d)}.${Number(m)}.`
  }

  return (
    <section className="rounded-lg border bg-white p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-gray-400">{totalOrders} objednávok</span>
      </div>
      <div className="flex h-40 items-end gap-1">
        {daily.map((d) => (
          <div
            key={d.date}
            className="group relative h-full flex-1"
            title={`${fmtDay(d.date)} — ${formatEur(d.grossCents)} · ${d.orders} obj.`}
          >
            <div
              className="absolute bottom-0 left-0 w-full rounded-t bg-green-600/80 transition-colors group-hover:bg-green-600"
              style={{
                height: `${Math.max(2, Math.round((d.grossCents / max) * 100))}%`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-gray-400">
        <span>{fmtDay(daily[0]?.date ?? '')}</span>
        <span>{fmtDay(daily[daily.length - 1]?.date ?? '')}</span>
      </div>
    </section>
  )
}
