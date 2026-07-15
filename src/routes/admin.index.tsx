import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { getAdminOverviewFn } from '../server/admin-overview'
import type { DailyPoint } from '../server/admin-overview'
import { generateSettlementsNowFn } from '../server/settlements'
import { formatEur } from '../lib/money'

export const Route = createFileRoute('/admin/')({
  loader: async () => {
    const res = await getAdminOverviewFn()
    if ('error' in res) throw new Error(res.error)
    return res
  },
  component: AdminOverview,
})

function Stat({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-gray-400">{sub}</div>}
    </div>
  )
}

function SalesChart({ daily }: { daily: DailyPoint[] }) {
  const max = Math.max(1, ...daily.map((d) => d.grossCents))
  const totalOrders = daily.reduce((s, d) => s + d.orders, 0)
  const fmtDay = (key: string) => {
    const [, m, d] = key.split('-')
    return `${Number(d)}.${Number(m)}.`
  }

  return (
    <section className="rounded-lg border bg-white p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Predaj za posledných 30 dní</h2>
        <span className="text-xs text-gray-400">{totalOrders} objednávok</span>
      </div>
      <div className="flex h-40 items-end gap-1">
        {daily.map((d) => (
          <div
            key={d.date}
            className="group relative flex-1"
            title={`${fmtDay(d.date)} — ${formatEur(d.grossCents)} · ${d.orders} obj.`}
          >
            <div
              className="w-full rounded-t bg-indigo-500/80 transition-colors group-hover:bg-indigo-600"
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

function AdminOverview() {
  const o = Route.useLoaderData()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Prehľad platformy</h1>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat
          label="Hrubé tržby"
          value={formatEur(o.grossCents)}
          sub="všetky zaplatené objednávky"
        />
        <Stat label="Provízie platformy" value={formatEur(o.feeCents)} />
        <Stat label="Netto pre organizátorov" value={formatEur(o.netCents)} />
        <Stat label="Organizátori" value={String(o.organizerCount)} />
        <Stat label="Podujatia" value={String(o.eventCount)} />
        <Stat
          label="Objednávky"
          value={String(o.orderCount)}
          sub={`z toho ${o.paidOrderCount} zaplatených`}
        />
      </div>

      <SalesChart daily={o.daily} />
      <GenerateSettlements />
    </div>
  )
}

function prevMonthValue(): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function GenerateSettlements() {
  const [month, setMonth] = useState(prevMonthValue())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setMsg(null)
    const res = await generateSettlementsNowFn({ data: { periodMonth: month } })
    setBusy(false)
    setMsg(
      'error' in res
        ? res.error
        : `Vygenerované vyúčtovania: ${res.count} organizátorov.`,
    )
  }

  return (
    <section className="rounded-lg border bg-white p-5">
      <h2 className="mb-1 text-sm font-semibold">Vyúčtovania</h2>
      <p className="mb-3 text-xs text-gray-500">
        Mesačné vyúčtovania beží automaticky 1. deň v mesiaci. Tu ich vieš
        vygenerovať (alebo pregenerovať) manuálne.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
        />
        <button
          onClick={run}
          disabled={busy}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50"
        >
          {busy ? 'Generujem…' : 'Generovať'}
        </button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>
    </section>
  )
}
