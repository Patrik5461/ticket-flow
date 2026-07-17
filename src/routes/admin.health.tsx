import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getSystemHealthFn } from '../server/health'
import type {
  SystemHealth,
  HealthStatus,
  ServiceCheck,
  QueueStat,
} from '../server/health'

export const Route = createFileRoute('/admin/health')({
  loader: async (): Promise<SystemHealth | null> => {
    const res = await getSystemHealthFn()
    return 'error' in res ? null : res
  },
  component: HealthPage,
})

const SERVICE_SK: Record<string, string> = {
  database: 'Databáza',
  storage: 'Úložisko',
  gopay: 'GoPay',
  resend: 'E-mail (Resend)',
  faktero: 'Faktúry (Faktero)',
}
const QUEUE_SK: Record<string, string> = {
  refund: 'Refundácie',
  email: 'E-maily',
  invoice: 'Faktúry',
  waitlist: 'Waitlist',
  webhook: 'Webhooky',
}

const STATUS_META: Record<
  HealthStatus,
  { label: string; dot: string; text: string }
> = {
  ok: { label: 'OK', dot: '#22c55e', text: '#4ade80' },
  degraded: { label: 'Zhoršené', dot: '#f59e0b', text: '#fbbf24' },
  down: { label: 'Nedostupné', dot: '#ef4444', text: '#f87171' },
  not_configured: {
    label: 'Nenakonfigurované',
    dot: '#6b7280',
    text: '#9ca3af',
  },
}

function fmtTime(iso: string) {
  return new Intl.DateTimeFormat('sk-SK', {
    timeStyle: 'medium',
    timeZone: 'Europe/Bratislava',
  }).format(new Date(iso))
}

function fmtUptime(sec: number) {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return [d && `${d}d`, (d || h) && `${h}h`, `${m}m`].filter(Boolean).join(' ')
}

function StatusDot({ status }: { status: HealthStatus }) {
  const m = STATUS_META[status]
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={{ background: m.dot, boxShadow: `0 0 8px ${m.dot}` }}
      />
      <span style={{ color: m.text }} className="text-sm font-medium">
        {m.label}
      </span>
    </span>
  )
}

function ServiceRow({ s }: { s: ServiceCheck }) {
  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-3 font-medium">{SERVICE_SK[s.name] ?? s.name}</td>
      <td className="px-4 py-3">
        <StatusDot status={s.status} />
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-gray-500">
        {s.latencyMs != null ? `${s.latencyMs} ms` : '—'}
      </td>
      <td className="px-4 py-3 text-xs text-gray-400">{s.detail ?? ''}</td>
    </tr>
  )
}

function QueueRow({ q }: { q: QueueStat }) {
  const alarm = q.stuck > 0 || q.failed > 0
  return (
    <tr className={`border-b last:border-0 ${alarm ? 'bg-red-50' : ''}`}>
      <td className="px-4 py-3 font-medium">{QUEUE_SK[q.name] ?? q.name}</td>
      <td className="px-4 py-3 text-right tabular-nums">{q.pending}</td>
      <td
        className={`px-4 py-3 text-right tabular-nums ${
          q.failed > 0 ? 'font-semibold text-red-600' : 'text-gray-500'
        }`}
      >
        {q.failed}
      </td>
      <td
        className={`px-4 py-3 text-right tabular-nums ${
          q.stuck > 0 ? 'font-semibold text-red-600' : 'text-gray-500'
        }`}
      >
        {q.stuck}
      </td>
      <td className="px-4 py-3 text-xs text-gray-400">
        {q.lastActivity ? fmtTime(q.lastActivity) : '—'}
      </td>
    </tr>
  )
}

function HealthPage() {
  const initial = Route.useLoaderData()
  const [data, setData] = useState<SystemHealth | null>(initial)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const refresh = async () => {
    setBusy(true)
    try {
      const res = await getSystemHealthFn()
      if ('error' in res) setFailed(true)
      else {
        setData(res)
        setFailed(false)
      }
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Systémový status</h1>
          {data && (
            <p className="mt-1 text-sm text-gray-500">
              Posledná kontrola {fmtTime(data.checkedAt)} · auto-refresh 30 s
            </p>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={busy}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {busy ? 'Kontrolujem…' : 'Obnoviť'}
        </button>
      </div>

      {failed && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Kontrolu sa nepodarilo načítať.
        </div>
      )}

      {data && (
        <>
          {/* Služby */}
          <section className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-gray-500">
                  <th className="px-4 py-3">Služba</th>
                  <th className="px-4 py-3">Stav</th>
                  <th className="px-4 py-3 text-right">Odozva</th>
                  <th className="px-4 py-3">Detail</th>
                </tr>
              </thead>
              <tbody>
                {data.services.map((s) => (
                  <ServiceRow key={s.name} s={s} />
                ))}
              </tbody>
            </table>
          </section>

          {/* Fronty úloh */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-gray-600">
              Fronty úloh
            </h2>
            <div className="overflow-x-auto rounded-lg border bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-gray-500">
                    <th className="px-4 py-3">Fronta</th>
                    <th className="px-4 py-3 text-right">Čaká</th>
                    <th className="px-4 py-3 text-right">Zlyhané</th>
                    <th className="px-4 py-3 text-right">Zaseknuté</th>
                    <th className="px-4 py-3">Posledná aktivita</th>
                  </tr>
                </thead>
                <tbody>
                  {data.queues.map((q) => (
                    <QueueRow key={q.name} q={q} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-gray-400">
              „Zaseknuté" = čakajúce úlohy staršie ako 10 minút (worker
              nepostupuje).
            </p>
          </section>

          {/* Systém */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-gray-600">Systém</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <SysStat label="Verzia" value={data.system.version} />
              <SysStat
                label="Uptime"
                value={fmtUptime(data.system.uptimeSeconds)}
              />
              <SysStat
                label="Organizátori"
                value={String(data.system.organizers)}
              />
              <SysStat label="Podujatia" value={String(data.system.events)} />
              <SysStat label="Objednávky" value={String(data.system.orders)} />
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function SysStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-lg font-bold">{value}</div>
    </div>
  )
}
