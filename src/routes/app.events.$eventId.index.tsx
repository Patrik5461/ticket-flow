import {
  createFileRoute,
  Link,
  useRouter,
  notFound,
} from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import {
  BarChart3,
  ScanLine,
  Users,
  ShoppingCart,
  Receipt,
  ExternalLink,
} from 'lucide-react'
import {
  getMyEventFn,
  updateEventFn,
  publishEventFn,
  unpublishEventFn,
  setEventReentryFn,
  createTicketTypeFn,
  updateTicketTypeFn,
  deleteTicketTypeFn,
  createCouponFn,
  updateCouponFn,
  deleteCouponFn,
  uploadEventCoverFn,
} from '../server/dashboard'
import type { EventDetail } from '../server/dashboard'
import { cancelEventFn } from '../server/cancel-event'
import { sendBulkMessageFn, listBulkMessagesFn } from '../server/bulk-messages'
import {
  listSupportRequestsFn,
  resolveSupportRequestFn,
} from '../server/support-admin'
import type { SupportRequestView } from '../server/support-admin'
import type { BulkMessageLog } from '../server/bulk-messages'
import {
  getEventSeatingFn,
  assignSeatMapToEventFn,
} from '../server/event-seating'
import type { EventSeatingView } from '../server/event-seating'
import { listVenuesFn, listSeatMapsFn, getSeatMapFn } from '../server/venues'
import { utcIsoToZonedLocal, formatSk } from '../lib/datetime'
import { formatEur } from '../lib/money'
import type { CouponRow, TicketTypeRow } from '../lib/db-types'
import type { CustomField } from '../lib/custom-fields'

export const Route = createFileRoute('/app/events/$eventId/')({
  loader: async ({ params }) => {
    const res = await getMyEventFn({ data: { eventId: params.eventId } })
    if ('error' in res) throw notFound()
    return res
  },
  component: ManageEvent,
})

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm'
const eurToCents = (s: string) => Math.round(parseFloat(s || '0') * 100)
const centsToEur = (c: number) => (c / 100).toFixed(2)

function PublishToggle({
  event,
  onToggle,
}: {
  event: EventDetail['event']
  onToggle: () => void
}) {
  const published = event.status === 'published'
  return (
    <div className="card-surface flex items-center gap-2 p-1.5">
      <span className="flex items-center gap-2 px-2 text-sm text-ink-200">
        <span
          className={`h-2 w-2 rounded-full ${
            published ? 'bg-accent' : 'bg-ink-500'
          }`}
        />
        {published ? 'Zverejnené' : 'Koncept'}
      </span>
      <button
        onClick={onToggle}
        className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
          published
            ? 'border border-ink-600 text-ink-100 hover:bg-ink-700'
            : 'bg-accent text-ink-950 hover:bg-accent-dim'
        }`}
      >
        {published ? 'Skryť (koncept)' : 'Zverejniť'}
      </button>
    </div>
  )
}

type ActionCardProps = {
  icon: React.ComponentType<{ className?: string }>
  title: string
  subtitle: string
  primary?: boolean
  ghost?: boolean
  to?: string
  params?: Record<string, string>
  href?: string
  external?: boolean
}

function ActionCard({
  icon: Icon,
  title,
  subtitle,
  primary,
  ghost,
  to,
  params,
  href,
  external,
}: ActionCardProps) {
  const base =
    'group relative flex min-h-[88px] flex-col justify-between rounded-[14px] border p-4 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50'
  const surface = ghost
    ? 'border-ink-700 bg-ink-900/60 hover:border-ink-500 hover:bg-ink-800'
    : primary
      ? 'border-accent/20 bg-gradient-to-br from-ink-800 to-ink-900 hover:border-accent/50 hover:shadow-[0_0_20px_-8px_rgba(74,222,128,0.35)]'
      : 'border-ink-700 bg-gradient-to-br from-ink-800 to-ink-900 hover:border-ink-500 hover:bg-ink-800'
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <Icon
          className={`h-6 w-6 transition-colors ${
            primary ? 'text-accent' : 'text-ink-300 group-hover:text-accent'
          }`}
        />
        {external && <ExternalLink className="h-3.5 w-3.5 text-ink-500" />}
      </div>
      <div>
        <div className="font-display text-sm font-semibold text-ink-100">
          {title}
        </div>
        <div className="mt-0.5 text-xs text-ink-400">{subtitle}</div>
      </div>
    </>
  )

  if (href) {
    return (
      <a
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noreferrer' : undefined}
        className={`${base} ${surface}`}
      >
        {content}
      </a>
    )
  }

  return (
    <Link to={to} params={params as never} className={`${base} ${surface}`}>
      {content}
    </Link>
  )
}

function ManageEvent() {
  const { event, ticketTypes, coupons } = Route.useLoaderData()
  const router = useRouter()
  const reload = () => router.invalidate()
  const tz = event.timezone

  const togglePublish = async () => {
    if (event.status === 'published') {
      await unpublishEventFn({ data: { eventId: event.id } })
    } else {
      await publishEventFn({ data: { eventId: event.id } })
    }
    reload()
  }

  return (
    <div className="max-w-5xl space-y-8">
      <section className="space-y-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <Link
              to="/app"
              className="inline-flex items-center gap-1 text-sm text-accent transition hover:text-accent-dim"
            >
              ← Späť na podujatia
            </Link>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">
              {event.title}
            </h1>
          </div>
          <PublishToggle event={event} onToggle={togglePublish} />
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <ActionCard
            to="/app/events/$eventId/sales"
            params={{ eventId: event.id }}
            icon={BarChart3}
            title="Predaj a tržby"
            subtitle="Prehľad a objednávky"
            primary
          />
          <ActionCard
            to="/app/events/$eventId/checkin"
            params={{ eventId: event.id }}
            icon={ScanLine}
            title="Check-in"
            subtitle="Skenovanie QR kódov"
            primary
          />
          <ActionCard
            to="/app/events/$eventId/guestlist"
            params={{ eventId: event.id }}
            icon={Users}
            title="Guestlist"
            subtitle="Zoznam účastníkov"
          />
          <ActionCard
            to="/app/events/$eventId/manual-order"
            params={{ eventId: event.id }}
            icon={ShoppingCart}
            title="Ručná objednávka"
            subtitle="Vytvoriť objednávku"
          />
          <ActionCard
            to="/app/events/$eventId/pos"
            params={{ eventId: event.id }}
            icon={Receipt}
            title="Pokladňa (POS)"
            subtitle="Rýchly predaj na mieste"
            primary
          />
          {event.status === 'published' && (
            <ActionCard
              href={`/e/${event.slug}`}
              external
              icon={ExternalLink}
              title="Verejná stránka"
              subtitle="Otvoriť stránku"
              ghost
            />
          )}
        </div>
      </section>

      <EventDetailsForm event={event} onSaved={reload} tz={tz} />
      <TicketTypesSection
        eventId={event.id}
        types={ticketTypes}
        onChanged={reload}
      />
      <CouponsSection
        eventId={event.id}
        coupons={coupons}
        tz={tz}
        onChanged={reload}
      />
      <SeatingSection eventId={event.id} ticketTypes={ticketTypes} />
      <ReentrySection event={event} />
      <SupportRequestsSection eventId={event.id} />
      <BulkMessageSection eventId={event.id} />
      <EmbedSnippetSection
        slug={event.slug}
        published={event.status === 'published'}
      />
      <CancelEventSection event={event} onChanged={reload} />
    </div>
  )
}

// --- Re-entry toggle ----------------------------------------------------------

function ReentrySection({ event }: { event: EventDetail['event'] }) {
  const [on, setOn] = useState(event.allow_reentry)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const toggle = async () => {
    if (busy) return
    setBusy(true)
    setErr(null)
    const next = !on
    const res = await setEventReentryFn({
      data: { eventId: event.id, allowReentry: next },
    })
    setBusy(false)
    if ('error' in res) {
      setErr(res.error)
      return
    }
    setOn(next)
  }

  return (
    <section className="rounded-lg border bg-white p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Opätovný vstup</h2>
          <p className="mt-1 max-w-prose text-sm text-gray-500">
            Ak je zapnuté, skener pustí už použitú vstupenku znova (zelená
            „Opätovný vstup") namiesto blokovania — vhodné, keď návštevníci
            odchádzajú a vracajú sa. Každý vstup sa zaznamená do histórie a počet
            odbavených sa opätovným vstupom nezvyšuje.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Povoliť opätovný vstup"
          onClick={toggle}
          disabled={busy}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
            on ? 'bg-green-500' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
              on ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </section>
  )
}

// --- Embed widget snippet -----------------------------------------------------

function EmbedSnippetSection({
  slug,
  published,
}: {
  slug: string
  published: boolean
}) {
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  if (!published) return null
  const snippet = `<script src="${origin}/widget.js" data-event="${slug}" async></script>`

  const copy = async () => {
    await navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="rounded-lg border bg-white p-6">
      <h2 className="mb-1 text-lg font-semibold">Predávaj na svojom webe</h2>
      <p className="mb-3 text-sm text-gray-500">
        Vložte tento kód na svoju stránku — zobrazí sa widget s predajom
        vstupeniek. Platba prebehne bezpečne na Ticketio.
      </p>
      <pre className="overflow-x-auto rounded-md bg-gray-900 p-3 text-xs text-gray-100">
        {snippet}
      </pre>
      <button
        onClick={copy}
        className="mt-3 rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
      >
        {copied ? 'Skopírované ✓' : 'Kopírovať kód'}
      </button>
    </section>
  )
}

// --- Message participants -----------------------------------------------------

function SeatingSection({
  eventId,
  ticketTypes,
}: {
  eventId: string
  ticketTypes: TicketTypeRow[]
}) {
  const [state, setState] = useState<EventSeatingView | null>(null)
  const [picking, setPicking] = useState(false)

  const load = async () => {
    const res = await getEventSeatingFn({ data: { eventId } })
    if (!('error' in res)) setState(res)
  }
  useEffect(() => {
    void load()
  }, [eventId])

  const ttName = (id: string | null) =>
    ticketTypes.find((t) => t.id === id)?.name ?? '—'

  const assigned = state?.seatMapId
  const c = state?.statusCounts

  return (
    <section className="rounded-lg border bg-white p-6">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Mapa sedadiel</h2>
        {assigned && !state.locked && !picking && (
          <button
            onClick={() => setPicking(true)}
            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-gray-50"
          >
            Zmeniť mapu
          </button>
        )}
      </div>
      <p className="mb-4 text-sm text-gray-500">
        Priraďte hale mapu a namapujte sektory na cenové kategórie. Po prvej
        rezervácii/predaji sa mapa uzamkne.
      </p>

      {assigned && !picking ? (
        <div className="space-y-3">
          <div className="text-sm">
            Mapa: <strong>{state.mapName}</strong>{' '}
            {state.locked && (
              <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                uzamknuté (predaj prebieha)
              </span>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2 text-center text-sm">
            <Cnt label="Voľné" n={c?.available ?? 0} />
            <Cnt label="Držané" n={c?.held ?? 0} />
            <Cnt label="Predané" n={c?.sold ?? 0} />
            <Cnt label="Blokované" n={c?.blocked ?? 0} />
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-500">
                <th className="py-1">Sektor</th>
                <th className="py-1">Sedadiel</th>
                <th className="py-1">Cenová kategória</th>
              </tr>
            </thead>
            <tbody>
              {state.sectors.map((s) => (
                <tr key={s.sector} className="border-t">
                  <td className="py-1 font-medium">{s.sector}</td>
                  <td className="py-1">{s.seatCount}</td>
                  <td className="py-1">{ttName(s.ticketTypeId)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <SeatMapPicker
          eventId={eventId}
          ticketTypes={ticketTypes}
          onCancel={assigned ? () => setPicking(false) : undefined}
          onAssigned={() => {
            setPicking(false)
            void load()
          }}
        />
      )}
    </section>
  )
}

function Cnt({ label, n }: { label: string; n: number }) {
  return (
    <div className="rounded-md border bg-gray-50 p-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-bold tabular-nums">{n}</div>
    </div>
  )
}

function SeatMapPicker({
  eventId,
  ticketTypes,
  onCancel,
  onAssigned,
}: {
  eventId: string
  ticketTypes: TicketTypeRow[]
  onCancel?: () => void
  onAssigned: () => void
}) {
  const [venues, setVenues] = useState<{ id: string; name: string }[]>([])
  const [venueId, setVenueId] = useState('')
  const [maps, setMaps] = useState<{ id: string; name: string }[]>([])
  const [mapId, setMapId] = useState('')
  const [sectors, setSectors] = useState<string[]>([])
  const [pricing, setPricing] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void listVenuesFn().then((r) => {
      if (!('error' in r)) setVenues(r.map((v) => ({ id: v.id, name: v.name })))
    })
  }, [])
  useEffect(() => {
    setMaps([])
    setMapId('')
    setSectors([])
    if (!venueId) return
    void listSeatMapsFn({ data: { venueId } }).then((r) => {
      if (!('error' in r)) setMaps(r.map((m) => ({ id: m.id, name: m.name })))
    })
  }, [venueId])
  useEffect(() => {
    setSectors([])
    setPricing({})
    if (!mapId) return
    void getSeatMapFn({ data: { seatMapId: mapId } }).then((r) => {
      if ('error' in r) return
      setSectors([...new Set(r.seats.map((s) => s.sector))].sort())
    })
  }, [mapId])

  const canAssign =
    mapId && sectors.length > 0 && sectors.every((s) => pricing[s])

  const assign = async () => {
    setBusy(true)
    const res = await assignSeatMapToEventFn({
      data: {
        eventId,
        seatMapId: mapId,
        sectorPricing: sectors.map((s) => ({
          sector: s,
          ticketTypeId: pricing[s],
        })),
      },
    })
    setBusy(false)
    if ('error' in res) return alert(res.error)
    onAssigned()
  }

  return (
    <div className="space-y-3">
      {venues.length === 0 ? (
        <p className="text-sm text-gray-500">
          Zatiaľ nemáte žiadne miesta konania. Vytvorte mapu v sekcii „Mapy
          sedadiel".
        </p>
      ) : (
        <div className="flex flex-wrap gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Miesto</span>
            <select
              value={venueId}
              onChange={(e) => setVenueId(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            >
              <option value="">— vyberte —</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Mapa</span>
            <select
              value={mapId}
              onChange={(e) => setMapId(e.target.value)}
              disabled={!venueId}
              className="rounded-md border px-3 py-2 text-sm disabled:bg-gray-100"
            >
              <option value="">— vyberte —</option>
              {maps.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {sectors.length > 0 && (
        <div>
          <div className="mb-1 text-sm font-medium">
            Sektory → cenové kategórie
          </div>
          <div className="space-y-2">
            {sectors.map((s) => (
              <div key={s} className="flex items-center gap-3 text-sm">
                <span className="w-24 font-medium">{s}</span>
                <select
                  value={pricing[s] ?? ''}
                  onChange={(e) =>
                    setPricing((p) => ({ ...p, [s]: e.target.value }))
                  }
                  className="rounded-md border px-3 py-1.5"
                >
                  <option value="">— cenová kategória —</option>
                  {ticketTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({formatEur(t.price_cents)})
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={assign}
          disabled={!canAssign || busy}
          className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          {busy ? 'Priraďujem…' : 'Priradiť mapu'}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="rounded-md border px-4 py-2 text-sm hover:bg-gray-50"
          >
            Zrušiť
          </button>
        )}
      </div>
    </div>
  )
}

function SupportRequestsSection({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<SupportRequestView[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = async () => {
    const res = await listSupportRequestsFn({ data: { eventId } })
    if (!('error' in res)) setRows(res)
  }
  useEffect(() => {
    void load()
  }, [eventId])

  const resolve = async (id: string, action: 'approve' | 'reject') => {
    if (
      action === 'approve' &&
      !confirm('Schváliť zmenu e-mailu a preposlať vstupenky na novú adresu?')
    )
      return
    setBusyId(id)
    const res = await resolveSupportRequestFn({ data: { id, action } })
    setBusyId(null)
    if ('error' in res) alert(res.error)
    else void load()
  }

  const pending = rows.filter((r) => r.status === 'pending')
  const fmt = (iso: string) => formatSk(iso, 'dateTime', 'Europe/Bratislava')

  return (
    <section className="rounded-lg border bg-white p-6">
      <h2 className="mb-1 text-lg font-semibold">Support požiadavky</h2>
      <p className="mb-4 text-sm text-gray-500">
        Žiadosti o zmenu e-mailu od kupujúcich. Po schválení sa vstupenky
        prepošlú na novú adresu.
      </p>
      {pending.length === 0 ? (
        <p className="text-sm text-gray-500">Žiadne čakajúce požiadavky.</p>
      ) : (
        <ul className="space-y-3">
          {pending.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium">
                  Objednávka {r.orderRef} · zmena e-mailu
                </div>
                <div className="mt-0.5 text-xs text-gray-500">
                  {r.requestedEmail} → <strong>{r.newEmail}</strong> ·{' '}
                  {fmt(r.createdAt)}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => resolve(r.id, 'approve')}
                  disabled={busyId === r.id}
                  className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  Schváliť + preposlať
                </button>
                <button
                  onClick={() => resolve(r.id, 'reject')}
                  disabled={busyId === r.id}
                  className="rounded-md border px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Zamietnuť
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function BulkMessageSection({ eventId }: { eventId: string }) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [log, setLog] = useState<BulkMessageLog[]>([])

  const loadLog = async () => {
    const res = await listBulkMessagesFn({ data: { eventId } })
    if (!('error' in res)) setLog(res)
  }
  useEffect(() => {
    void loadLog()
  }, [eventId])

  const send = async () => {
    if (!subject.trim() || !body.trim()) return
    if (
      !confirm('Odoslať správu všetkým účastníkom so zaplatenou objednávkou?')
    )
      return
    setBusy(true)
    setMsg(null)
    const res = await sendBulkMessageFn({
      data: { eventId, subject: subject.trim(), body: body.trim() },
    })
    setBusy(false)
    if ('error' in res) {
      setMsg(res.error)
      return
    }
    setMsg(`Zaradené do odosielania: ${res.recipientCount} príjemcov.`)
    setSubject('')
    setBody('')
    void loadLog()
  }

  const fmt = (iso: string) => formatSk(iso, 'dateTime', 'Europe/Bratislava')

  return (
    <section className="rounded-lg border bg-white p-6">
      <h2 className="mb-1 text-lg font-semibold">Napísať účastníkom</h2>
      <p className="mb-4 text-sm text-gray-500">
        Správa sa odošle všetkým kupujúcim so zaplatenou objednávkou.
        Odosielanie beží na pozadí (fronta).
      </p>
      <div className="space-y-3">
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Predmet"
          className={inputCls}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder="Text správy…"
          className={inputCls}
        />
        <div className="flex items-center gap-3">
          <button
            onClick={send}
            disabled={busy || !subject.trim() || !body.trim()}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? 'Odosielam…' : 'Odoslať účastníkom'}
          </button>
          {msg && <span className="text-sm text-gray-600">{msg}</span>}
        </div>
      </div>

      {log.length > 0 && (
        <div className="mt-6 border-t pt-4">
          <h3 className="mb-2 text-sm font-semibold">Odoslané správy</h3>
          <ul className="space-y-2 text-sm">
            {log.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap justify-between gap-2 border-t pt-2 first:border-t-0 first:pt-0"
              >
                <span>
                  <strong>{m.subject}</strong>
                  <span className="ml-2 text-xs text-gray-400">
                    {m.recipientCount} príjemcov · doručené {m.sent}
                    {m.failed > 0 ? ` · zlyhalo ${m.failed}` : ''}
                    {m.pending > 0 ? ` · čaká ${m.pending}` : ''}
                  </span>
                </span>
                <span className="text-xs text-gray-400">
                  {fmt(m.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

// --- Cancel event (danger zone) ----------------------------------------------

function CancelEventSection({
  event,
  onChanged,
}: {
  event: EventDetail['event']
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  if (event.status === 'cancelled') {
    return (
      <section className="rounded-lg border border-red-200 bg-red-50 p-6">
        <h2 className="text-lg font-semibold text-red-700">
          Podujatie je zrušené
        </h2>
        <p className="mt-1 text-sm text-red-600">
          Zaplatené objednávky sa refundujú kupujúcim.
        </p>
      </section>
    )
  }

  const submit = async () => {
    setBusy(true)
    setErr(null)
    const res = await cancelEventFn({
      data: { eventId: event.id, confirmTitle: title },
    })
    setBusy(false)
    if ('error' in res) {
      setErr(res.error)
      return
    }
    setDone(`Podujatie zrušené. Refundácií vo fronte: ${res.enqueued}.`)
    setOpen(false)
    onChanged()
  }

  return (
    <section className="rounded-lg border border-red-200 p-6">
      <h2 className="text-lg font-semibold text-red-700">Nebezpečná zóna</h2>
      <p className="mt-1 text-sm text-gray-600">
        Zrušenie podujatia ho stiahne z predaja a spustí refundáciu všetkých
        zaplatených objednávok. Túto akciu nie je možné vrátiť.
      </p>
      {done && <p className="mt-2 text-sm text-green-700">{done}</p>}
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="mt-4 rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
        >
          Zrušiť podujatie…
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          <label className="block text-sm text-gray-700">
            Pre potvrdenie napíšte presný názov podujatia:{' '}
            <strong>{event.title}</strong>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              placeholder={event.title}
            />
          </label>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={busy || title.trim() !== event.title.trim()}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? 'Rušim…' : 'Definitívne zrušiť'}
            </button>
            <button
              onClick={() => {
                setOpen(false)
                setTitle('')
              }}
              className="rounded-md border px-4 py-2 text-sm hover:bg-gray-50"
            >
              Späť
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

// --- Event details -----------------------------------------------------------

function EventDetailsForm({
  event,
  tz,
  onSaved,
}: {
  event: EventDetail['event']
  tz: string
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    title: event.title,
    description: event.description ?? '',
    venueName: event.venue_name ?? '',
    venueAddress: event.venue_address ?? '',
    startsAtLocal: utcIsoToZonedLocal(event.starts_at, tz),
    endsAtLocal: event.ends_at ? utcIsoToZonedLocal(event.ends_at, tz) : '',
    ga4: event.ga4_measurement_id ?? '',
    pixel: event.meta_pixel_id ?? '',
  })
  const [coverUrl, setCoverUrl] = useState<string | null>(
    event.cover_url ?? null,
  )
  const [coverBusy, setCoverBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const onCover = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setMsg('Podporované sú len JPG, PNG a WebP.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setMsg('Obrázok je príliš veľký (max 5 MB).')
      return
    }
    setCoverBusy(true)
    setMsg(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.onerror = () => reject(new Error('read failed'))
        r.readAsDataURL(file)
      })
      const res = await uploadEventCoverFn({ data: { dataUrl } })
      if ('error' in res) setMsg((res as { error: string }).error)
      else setCoverUrl(res.url)
    } catch (err) {
      setMsg((err as Error).message)
    } finally {
      setCoverBusy(false)
    }
  }
  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }))

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setMsg(null)
    const res = await updateEventFn({
      data: {
        eventId: event.id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        venueName: form.venueName.trim() || null,
        venueAddress: form.venueAddress.trim() || null,
        startsAtLocal: form.startsAtLocal,
        endsAtLocal: form.endsAtLocal || null,
        timezone: tz,
        ga4MeasurementId: form.ga4.trim() || null,
        metaPixelId: form.pixel.trim() || null,
        coverUrl,
      },
    })
    setSaving(false)
    setMsg('error' in res ? res.error : 'Uložené.')
    if (!('error' in res)) onSaved()
  }

  return (
    <section className="rounded-lg border bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold">Detaily podujatia</h2>
      <form onSubmit={save} className="space-y-4">
        <input
          value={form.title}
          onChange={set('title')}
          className={inputCls}
          placeholder="Názov"
          required
        />
        <textarea
          value={form.description}
          onChange={set('description')}
          rows={3}
          className={inputCls}
          placeholder="Popis"
        />
        <div>
          <span className="mb-1 block text-sm text-gray-600">
            Cover obrázok (16:9)
          </span>
          <div className="aspect-[16/9] w-full max-w-sm overflow-hidden rounded-md border bg-gray-50">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt="Cover"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-gray-400">
                Zatiaľ bez obrázka
              </div>
            )}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <label className="inline-block cursor-pointer rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-gray-50">
              {coverBusy
                ? 'Nahrávam…'
                : coverUrl
                  ? 'Nahradiť'
                  : 'Nahrať obrázok'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={onCover}
                disabled={coverBusy}
                className="hidden"
              />
            </label>
            {coverUrl && (
              <button
                type="button"
                onClick={() => setCoverUrl(null)}
                className="text-sm text-red-600 hover:underline"
              >
                Odstrániť
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <input
            value={form.venueName}
            onChange={set('venueName')}
            className={inputCls}
            placeholder="Miesto"
          />
          <input
            value={form.venueAddress}
            onChange={set('venueAddress')}
            className={inputCls}
            placeholder="Adresa"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Začiatok</span>
            <input
              type="datetime-local"
              value={form.startsAtLocal}
              onChange={set('startsAtLocal')}
              className={inputCls}
              required
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Koniec</span>
            <input
              type="datetime-local"
              value={form.endsAtLocal}
              onChange={set('endsAtLocal')}
              className={inputCls}
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-4 border-t pt-4">
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">GA4 Measurement ID</span>
            <input
              value={form.ga4}
              onChange={set('ga4')}
              className={inputCls}
              placeholder="G-XXXXXXX"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Meta Pixel ID</span>
            <input
              value={form.pixel}
              onChange={set('pixel')}
              className={inputCls}
              placeholder="123456789012345"
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Ukladám…' : 'Uložiť'}
          </button>
          {msg && <span className="text-sm text-gray-600">{msg}</span>}
        </div>
      </form>
    </section>
  )
}

// --- Ticket types ------------------------------------------------------------

function TicketTypesSection({
  eventId,
  types,
  onChanged,
}: {
  eventId: string
  types: TicketTypeRow[]
  onChanged: () => void
}) {
  return (
    <section className="rounded-lg border bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold">Typy vstupeniek</h2>
      <div className="space-y-3">
        {types.map((t) => (
          <TicketTypeForm
            key={t.id}
            eventId={eventId}
            type={t}
            onChanged={onChanged}
          />
        ))}
      </div>
      <div className="mt-4 border-t pt-4">
        <TicketTypeForm eventId={eventId} onChanged={onChanged} />
      </div>
    </section>
  )
}

function TicketTypeForm({
  eventId,
  type,
  onChanged,
}: {
  eventId: string
  type?: TicketTypeRow
  onChanged: () => void
}) {
  const editing = Boolean(type)
  const [form, setForm] = useState({
    name: type?.name ?? '',
    priceEur: type ? centsToEur(type.price_cents) : '',
    capacity: type ? String(type.capacity) : '',
    maxPerOrder: type ? String(type.max_per_order) : '10',
    hidden: type?.hidden ?? false,
  })
  const [fields, setFields] = useState<CustomField[]>(type?.custom_fields ?? [])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setErr(null)
    const payload = {
      name: form.name.trim(),
      description: null,
      priceCents: eurToCents(form.priceEur),
      capacity: parseInt(form.capacity || '0', 10),
      maxPerOrder: parseInt(form.maxPerOrder || '10', 10),
      sortOrder: type?.sort_order ?? 0,
      hidden: form.hidden,
      customFields: fields
        .filter((f) => f.key.trim() && f.label.trim())
        .map((f) => ({
          key: f.key.trim(),
          label: f.label.trim(),
          type: f.type,
          required: f.required,
          ...(f.type === 'select'
            ? { options: (f.options ?? []).filter((o) => o.trim()) }
            : {}),
        })),
    }
    const res = editing
      ? await updateTicketTypeFn({
          data: { ...payload, ticketTypeId: type!.id },
        })
      : await createTicketTypeFn({ data: { ...payload, eventId } })
    setBusy(false)
    if ('error' in res) {
      setErr(res.error)
      return
    }
    if (!editing) {
      setForm({
        name: '',
        priceEur: '',
        capacity: '',
        maxPerOrder: '10',
        hidden: false,
      })
      setFields([])
    }
    onChanged()
  }

  const remove = async () => {
    if (!type) return
    setBusy(true)
    const res = await deleteTicketTypeFn({ data: { ticketTypeId: type.id } })
    setBusy(false)
    if ('error' in res) setErr(res.error)
    else onChanged()
  }

  return (
    <div className="rounded-md border p-3">
      <div className="grid grid-cols-12 items-end gap-2">
        <label className="col-span-4 text-xs text-gray-500">
          Názov
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={inputCls}
          />
        </label>
        <label className="col-span-2 text-xs text-gray-500">
          Cena (€)
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.priceEur}
            onChange={(e) =>
              setForm((f) => ({ ...f, priceEur: e.target.value }))
            }
            className={inputCls}
          />
        </label>
        <label className="col-span-2 text-xs text-gray-500">
          Kapacita
          <input
            type="number"
            min="0"
            value={form.capacity}
            onChange={(e) =>
              setForm((f) => ({ ...f, capacity: e.target.value }))
            }
            className={inputCls}
          />
        </label>
        <label className="col-span-2 text-xs text-gray-500">
          Max/obj.
          <input
            type="number"
            min="1"
            value={form.maxPerOrder}
            onChange={(e) =>
              setForm((f) => ({ ...f, maxPerOrder: e.target.value }))
            }
            className={inputCls}
          />
        </label>
        <label className="col-span-2 flex items-center gap-1 pb-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={form.hidden}
            onChange={(e) =>
              setForm((f) => ({ ...f, hidden: e.target.checked }))
            }
          />
          Skryté
        </label>
      </div>

      {/* Custom fields */}
      <div className="mt-3 border-t pt-3">
        <div className="mb-2 text-xs font-semibold text-gray-500">
          Vlastné polia (vypĺňa kupujúci pri každej vstupenke)
        </div>
        <div className="space-y-2">
          {fields.map((f, i) => (
            <div key={i} className="grid grid-cols-12 items-center gap-2">
              <input
                value={f.label}
                onChange={(e) =>
                  setFields((fs) =>
                    fs.map((x, j) =>
                      j === i ? { ...x, label: e.target.value } : x,
                    ),
                  )
                }
                placeholder="Označenie"
                className={`${inputCls} col-span-4`}
              />
              <select
                value={f.type}
                onChange={(e) =>
                  setFields((fs) =>
                    fs.map((x, j) =>
                      j === i
                        ? { ...x, type: e.target.value as CustomField['type'] }
                        : x,
                    ),
                  )
                }
                className={`${inputCls} col-span-2`}
              >
                <option value="text">Text</option>
                <option value="select">Výber</option>
                <option value="checkbox">Súhlas</option>
              </select>
              <input
                value={f.type === 'select' ? (f.options ?? []).join(', ') : ''}
                onChange={(e) =>
                  setFields((fs) =>
                    fs.map((x, j) =>
                      j === i
                        ? {
                            ...x,
                            options: e.target.value
                              .split(',')
                              .map((o) => o.trim())
                              .filter(Boolean),
                          }
                        : x,
                    ),
                  )
                }
                disabled={f.type !== 'select'}
                placeholder="Možnosti (čiarkou)"
                className={`${inputCls} col-span-3 disabled:bg-gray-100`}
              />
              <label className="col-span-2 flex items-center gap-1 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={f.required}
                  onChange={(e) =>
                    setFields((fs) =>
                      fs.map((x, j) =>
                        j === i ? { ...x, required: e.target.checked } : x,
                      ),
                    )
                  }
                />
                Povinné
              </label>
              <button
                type="button"
                onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))}
                className="col-span-1 text-xs text-red-600"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() =>
            setFields((fs) => [
              ...fs,
              {
                key: `f${fs.length + 1}_${Date.now().toString(36)}`,
                label: '',
                type: 'text',
                required: false,
              },
            ])
          }
          className="mt-2 rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
        >
          + Pridať pole
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {editing ? 'Uložiť' : '+ Pridať typ'}
        </button>
        {editing && (
          <button
            onClick={remove}
            disabled={busy}
            className="rounded-md border px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
          >
            Zmazať
          </button>
        )}
        {type && (
          <span className="ml-auto text-xs text-gray-400">
            {type.sold_count} predaných · {formatEur(type.price_cents)}
          </span>
        )}
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
    </div>
  )
}

// --- Coupons -----------------------------------------------------------------

function CouponsSection({
  eventId,
  coupons,
  tz,
  onChanged,
}: {
  eventId: string
  coupons: CouponRow[]
  tz: string
  onChanged: () => void
}) {
  return (
    <section className="rounded-lg border bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold">Kupóny</h2>
      <div className="space-y-3">
        {coupons.map((c) => (
          <CouponForm
            key={c.id}
            eventId={eventId}
            coupon={c}
            tz={tz}
            onChanged={onChanged}
          />
        ))}
      </div>
      <div className="mt-4 border-t pt-4">
        <CouponForm eventId={eventId} tz={tz} onChanged={onChanged} />
      </div>
    </section>
  )
}

function CouponForm({
  eventId,
  coupon,
  tz,
  onChanged,
}: {
  eventId: string
  coupon?: CouponRow
  tz: string
  onChanged: () => void
}) {
  const editing = Boolean(coupon)
  const [form, setForm] = useState({
    code: coupon?.code ?? '',
    type: coupon?.type ?? 'percent',
    value: coupon ? String(coupon.value) : '',
    maxUses: coupon?.max_uses != null ? String(coupon.max_uses) : '',
  })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setErr(null)
    const payload = {
      code: form.code.trim(),
      type: form.type,
      value: parseInt(form.value || '0', 10),
      maxUses: form.maxUses ? parseInt(form.maxUses, 10) : null,
      validFromLocal: null,
      validUntilLocal: null,
      timezone: tz,
    }
    const res = editing
      ? await updateCouponFn({ data: { ...payload, couponId: coupon!.id } })
      : await createCouponFn({ data: { ...payload, eventId } })
    setBusy(false)
    if ('error' in res) {
      setErr(res.error)
      return
    }
    if (!editing) setForm({ code: '', type: 'percent', value: '', maxUses: '' })
    onChanged()
  }

  const remove = async () => {
    if (!coupon) return
    setBusy(true)
    const res = await deleteCouponFn({ data: { couponId: coupon.id } })
    setBusy(false)
    if ('error' in res) setErr(res.error)
    else onChanged()
  }

  return (
    <div className="rounded-md border p-3">
      <div className="grid grid-cols-12 items-end gap-2">
        <label className="col-span-3 text-xs text-gray-500">
          Kód
          <input
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            className={inputCls}
          />
        </label>
        <label className="col-span-3 text-xs text-gray-500">
          Typ
          <select
            value={form.type}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                type: e.target.value as 'percent' | 'fixed',
              }))
            }
            className={inputCls}
          >
            <option value="percent">Percentá (%)</option>
            <option value="fixed">Pevná (centy)</option>
          </select>
        </label>
        <label className="col-span-3 text-xs text-gray-500">
          Hodnota {form.type === 'percent' ? '(%)' : '(centy)'}
          <input
            type="number"
            min="0"
            value={form.value}
            onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
            className={inputCls}
          />
        </label>
        <label className="col-span-3 text-xs text-gray-500">
          Max použití
          <input
            type="number"
            min="1"
            value={form.maxUses}
            onChange={(e) =>
              setForm((f) => ({ ...f, maxUses: e.target.value }))
            }
            className={inputCls}
            placeholder="∞"
          />
        </label>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {editing ? 'Uložiť' : '+ Pridať kupón'}
        </button>
        {editing && (
          <button
            onClick={remove}
            disabled={busy}
            className="rounded-md border px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
          >
            Zmazať
          </button>
        )}
        {coupon && (
          <span className="ml-auto text-xs text-gray-400">
            použité {coupon.used_count}×
          </span>
        )}
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
    </div>
  )
}
