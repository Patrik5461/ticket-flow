import {
  createFileRoute,
  Link,
  notFound,
  useRouter,
} from '@tanstack/react-router'
import { useState } from 'react'
import {
  getOrganizerAdminFn,
  getOrganizerStatsFn,
  updateOrganizerFeeFn,
  setOrganizerStatusFn,
  updateOrganizerNotesFn,
} from '../server/admin-organizers'
import type {
  OrganizerAdminDetail,
  AuditEntryView,
  OrganizerStatsDetail,
} from '../server/admin-organizers'
import { formatEur } from '../lib/money'
import { SalesChart } from '../components/SalesChart'

export const Route = createFileRoute('/admin/organizers/$organizerId')({
  loader: async ({ params }) => {
    const [detail, stats] = await Promise.all([
      getOrganizerAdminFn({ data: { organizerId: params.organizerId } }),
      getOrganizerStatsFn({
        data: { organizerId: params.organizerId, period: '30d' },
      }),
    ])
    if ('error' in detail) throw notFound()
    return { detail, stats: 'error' in stats ? null : stats }
  },
  component: OrganizerDetail,
})

type Period = '30d' | '90d' | 'all'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
    </div>
  )
}

function OrganizerDetail() {
  const { detail, stats } = Route.useLoaderData()
  const { organizer, stats: quickStats, audit } = detail
  const router = useRouter()
  const reload = () => router.invalidate()

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          to="/admin/organizers"
          className="text-sm text-indigo-600 hover:underline"
        >
          ← Späť na organizátorov
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-bold">{organizer.name}</h1>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              organizer.status === 'active'
                ? 'bg-green-100 text-green-700'
                : 'bg-red-100 text-red-700'
            }`}
          >
            {organizer.status === 'active' ? 'Aktívny' : 'Pozastavený'}
          </span>
        </div>
        <div className="mt-1 text-sm text-gray-400">/{organizer.slug}</div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Podujatia" value={String(quickStats.eventCount)} />
        <Stat label="Zaplatené obj." value={String(quickStats.paidOrders)} />
        <Stat label="Hrubé tržby" value={formatEur(quickStats.grossCents)} />
        <Stat
          label="Provízia platformy"
          value={formatEur(quickStats.feeCents)}
        />
      </div>

      {stats && <StatsSection organizerId={organizer.id} initial={stats} />}

      <FeeForm organizer={organizer} onSaved={reload} />
      <StatusSection organizer={organizer} onChanged={reload} />
      <NotesForm organizer={organizer} onSaved={reload} />
      <AuditSection audit={audit} tz="Europe/Bratislava" />
    </div>
  )
}

function StatsSection({
  organizerId,
  initial,
}: {
  organizerId: string
  initial: OrganizerStatsDetail
}) {
  const [period, setPeriod] = useState<Period>('30d')
  const [data, setData] = useState<OrganizerStatsDetail>(initial)
  const [busy, setBusy] = useState(false)

  const switchPeriod = async (p: Period) => {
    if (p === period) return
    setPeriod(p)
    setBusy(true)
    try {
      const res = await getOrganizerStatsFn({
        data: { organizerId, period: p },
      })
      if (!('error' in res)) setData(res)
    } finally {
      setBusy(false)
    }
  }

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat('sk-SK', {
      dateStyle: 'short',
      timeZone: 'Europe/Bratislava',
    }).format(new Date(iso))

  const upcoming = data.events.filter((e) => !e.isPast)
  const past = data.events.filter((e) => e.isPast)

  const EventTable = ({ rows }: { rows: OrganizerStatsDetail['events'] }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase text-gray-500">
            <th className="py-2 pr-3">Podujatie</th>
            <th className="py-2 pr-3">Termín</th>
            <th className="py-2 pr-3 text-right">Predané</th>
            <th className="py-2 pr-3 text-right">Tržby</th>
            <th className="py-2 pr-3 text-right">Provízia</th>
            <th className="py-2">Stav</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="border-b last:border-0">
              <td className="py-2 pr-3 font-medium">
                <Link
                  to="/admin/events"
                  className="text-indigo-600 hover:underline"
                >
                  {e.title}
                </Link>
              </td>
              <td className="py-2 pr-3 whitespace-nowrap text-gray-500">
                {fmtDate(e.starts_at)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-gray-600">
                {e.soldCount} / {e.capacity}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {formatEur(e.grossCents)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-gray-500">
                {formatEur(e.feeCents)}
              </td>
              <td className="py-2 text-gray-500">{e.status}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-center text-gray-400">
                Žiadne podujatia.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Štatistiky predaja</h2>
        <div className="inline-flex overflow-hidden rounded-md border text-xs">
          {(['30d', '90d', 'all'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => switchPeriod(p)}
              className={`px-3 py-1.5 ${
                period === p
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {p === '30d' ? '30 dní' : p === '90d' ? '90 dní' : 'Celkovo'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Celkové tržby" value={formatEur(data.totals.grossCents)} />
        <Stat label="Moja provízia" value={formatEur(data.totals.feeCents)} />
        <Stat label="Objednávky" value={String(data.totals.orderCount)} />
        <Stat
          label="Priem. objednávka"
          value={formatEur(data.totals.avgOrderCents)}
        />
      </div>

      <div className={busy ? 'opacity-60' : ''}>
        <SalesChart daily={data.daily} title="Predaj v čase" />
      </div>

      <section className="rounded-lg border bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold">
          Aktuálne a budúce podujatia
        </h3>
        <EventTable rows={upcoming} />
      </section>
      <section className="rounded-lg border bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold">Minulé podujatia</h3>
        <EventTable rows={past} />
      </section>
    </div>
  )
}

function FeeForm({
  organizer,
  onSaved,
}: {
  organizer: OrganizerAdminDetail['organizer']
  onSaved: () => void
}) {
  const [feePercent, setFeePercent] = useState(String(organizer.fee_percent))
  const [feeMinEur, setFeeMinEur] = useState(
    (organizer.fee_min_cents / 100).toFixed(2),
  )
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const res = await updateOrganizerFeeFn({
      data: {
        organizerId: organizer.id,
        feePercent: parseFloat(feePercent || '0'),
        feeMinCents: Math.round(parseFloat(feeMinEur || '0') * 100),
      },
    })
    setBusy(false)
    setMsg('error' in res ? res.error : 'Uložené.')
    if (!('error' in res)) onSaved()
  }

  return (
    <section className="rounded-lg border bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold">Provízia platformy</h2>
      <form onSubmit={save} className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="mb-1 block text-gray-600">Percento (%)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={feePercent}
            onChange={(e) => setFeePercent(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-600">Minimum (€)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={feeMinEur}
            onChange={(e) => setFeeMinEur(e.target.value)}
            className={inputCls}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? 'Ukladám…' : 'Uložiť províziu'}
        </button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </form>
    </section>
  )
}

function StatusSection({
  organizer,
  onChanged,
}: {
  organizer: OrganizerAdminDetail['organizer']
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const suspended = organizer.status === 'suspended'

  const toggle = async () => {
    const next = suspended ? 'active' : 'suspended'
    if (
      !suspended &&
      !confirm(
        'Pozastaviť organizátora? Nebude môcť zverejňovať podujatia ani predávať vstupenky.',
      )
    )
      return
    setBusy(true)
    setErr(null)
    const res = await setOrganizerStatusFn({
      data: { organizerId: organizer.id, status: next },
    })
    setBusy(false)
    if ('error' in res) setErr(res.error)
    else onChanged()
  }

  return (
    <section className="rounded-lg border bg-white p-6">
      <h2 className="mb-2 text-lg font-semibold">Stav účtu</h2>
      <p className="mb-4 text-sm text-gray-500">
        {suspended
          ? 'Organizátor je pozastavený — nemôže zverejňovať ani predávať.'
          : 'Organizátor je aktívny.'}
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          disabled={busy}
          className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
            suspended
              ? 'bg-green-600 hover:bg-green-700'
              : 'bg-red-600 hover:bg-red-700'
          }`}
        >
          {suspended ? 'Aktivovať' : 'Pozastaviť'}
        </button>
        {err && <span className="text-sm text-red-600">{err}</span>}
      </div>
    </section>
  )
}

function NotesForm({
  organizer,
  onSaved,
}: {
  organizer: OrganizerAdminDetail['organizer']
  onSaved: () => void
}) {
  const [notes, setNotes] = useState(organizer.admin_notes ?? '')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const res = await updateOrganizerNotesFn({
      data: { organizerId: organizer.id, notes: notes.trim() || null },
    })
    setBusy(false)
    setMsg('error' in res ? res.error : 'Uložené.')
    if (!('error' in res)) onSaved()
  }

  return (
    <section className="rounded-lg border bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold">Interné poznámky</h2>
      <form onSubmit={save} className="space-y-3">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Poznámky pre podporu / moderáciu (nevidí ich organizátor)."
          className={inputCls}
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? 'Ukladám…' : 'Uložiť poznámky'}
          </button>
          {msg && <span className="text-sm text-gray-600">{msg}</span>}
        </div>
      </form>
    </section>
  )
}

const ACTION_SK: Record<string, string> = {
  'organizer.update_fee': 'Zmena provízie',
  'organizer.suspend': 'Pozastavenie',
  'organizer.activate': 'Aktivácia',
  'organizer.update_notes': 'Zmena poznámok',
}

function AuditSection({ audit, tz }: { audit: AuditEntryView[]; tz: string }) {
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat('sk-SK', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: tz,
    }).format(new Date(iso))

  return (
    <section className="rounded-lg border bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold">História zmien (audit)</h2>
      {audit.length === 0 ? (
        <p className="text-sm text-gray-500">
          Zatiaľ žiadne zaznamenané akcie.
        </p>
      ) : (
        <ul className="space-y-3">
          {audit.map((a) => (
            <li
              key={a.id}
              className="border-b pb-3 text-sm last:border-0 last:pb-0"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {ACTION_SK[a.action] ?? a.action}
                </span>
                <span className="text-xs text-gray-400">
                  {fmt(a.created_at)}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-gray-500">
                {a.actorEmail ?? 'neznámy admin'}
              </div>
              <div className="mt-1 font-mono text-xs text-gray-500">
                {JSON.stringify(a.old_value)} → {JSON.stringify(a.new_value)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
