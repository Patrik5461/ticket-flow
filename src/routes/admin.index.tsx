import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import {
  getAdminOverviewFn,
  getPlatformStatsFn,
} from '../server/admin-overview'
import type { PlatformStats, MonthlyPoint } from '../server/admin-overview'
import { generateSettlementsNowFn } from '../server/settlements'
import { formatEur } from '../lib/money'
import { SalesChart } from '../components/SalesChart'

export const Route = createFileRoute('/admin/')({
  loader: async () => {
    const [overview, platform] = await Promise.all([
      getAdminOverviewFn(),
      getPlatformStatsFn(),
    ])
    if ('error' in overview) throw new Error(overview.error)
    return { overview, platform: 'error' in platform ? null : platform }
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

function AdminOverview() {
  const { overview: o, platform } = Route.useLoaderData()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Prehľad platformy</h1>

      {platform && <RevenueBreakdown b={platform.breakdown} />}

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

      <SalesChart daily={o.daily} title="Predaj za posledných 30 dní" />

      {platform && (
        <>
          <MonthlyFeeChart monthly={platform.monthly} />
          <div className="grid gap-4 md:grid-cols-2">
            <TopOrganizers rows={platform.topOrganizers} />
            <TopEvents rows={platform.topEvents} />
          </div>
        </>
      )}

      <GenerateSettlements />
    </div>
  )
}

function RevenueBreakdown({ b }: { b: PlatformStats['breakdown'] }) {
  const cell = (label: string, s: { grossCents: number; feeCents: number }) => (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">
        {formatEur(s.grossCents)}
      </div>
      <div className="mt-0.5 text-xs text-gray-400">
        provízia {formatEur(s.feeCents)}
      </div>
    </div>
  )
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {cell('Dnes', b.today)}
      {cell('Tento mesiac', b.month)}
      {cell('Celkovo', b.all)}
    </div>
  )
}

function MonthlyFeeChart({ monthly }: { monthly: MonthlyPoint[] }) {
  const max = Math.max(1, ...monthly.map((m) => m.feeCents))
  const last = monthly[monthly.length - 1]
  const prev = monthly[monthly.length - 2]
  const delta =
    prev.feeCents > 0
      ? Math.round(((last.feeCents - prev.feeCents) / prev.feeCents) * 100)
      : null
  const label = (key: string) => {
    const [, m] = key.split('-')
    return `${Number(m)}/${key.slice(2, 4)}`
  }
  return (
    <section className="rounded-lg border bg-white p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Provízia platformy — mesačne</h2>
        {delta !== null && (
          <span
            className={`text-xs font-medium ${
              delta >= 0 ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)} % medzimesačne
          </span>
        )}
      </div>
      <div className="flex h-40 items-end gap-3">
        {monthly.map((m) => (
          <div
            key={m.month}
            className="flex flex-1 flex-col items-center gap-1"
          >
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t bg-indigo-500/80"
                style={{
                  height: `${Math.max(2, Math.round((m.feeCents / max) * 100))}%`,
                }}
                title={`${label(m.month)} — provízia ${formatEur(m.feeCents)}`}
              />
            </div>
            <span className="text-[10px] text-gray-400">{label(m.month)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function TopOrganizers({ rows }: { rows: PlatformStats['topOrganizers'] }) {
  return (
    <section className="rounded-lg border bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold">
        Top organizátori podľa tržby
      </h2>
      <ul className="space-y-2 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3">
            <Link
              to="/admin/organizers/$organizerId"
              params={{ organizerId: r.id }}
              className="truncate text-indigo-600 hover:underline"
            >
              {r.name}
            </Link>
            <span className="tabular-nums">{formatEur(r.grossCents)}</span>
          </li>
        ))}
        {rows.length === 0 && <li className="text-gray-400">Žiadne dáta.</li>}
      </ul>
    </section>
  )
}

function TopEvents({ rows }: { rows: PlatformStats['topEvents'] }) {
  return (
    <section className="rounded-lg border bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold">Top podujatia podľa tržby</h2>
      <ul className="space-y-2 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block truncate">{r.title}</span>
              <span className="block truncate text-xs text-gray-400">
                {r.organizerName} · {r.orderCount} obj.
              </span>
            </span>
            <span className="tabular-nums">{formatEur(r.grossCents)}</span>
          </li>
        ))}
        {rows.length === 0 && <li className="text-gray-400">Žiadne dáta.</li>}
      </ul>
    </section>
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
