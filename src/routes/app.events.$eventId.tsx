import {
  createFileRoute,
  Link,
  useRouter,
  notFound,
} from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import {
  getMyEventFn,
  updateEventFn,
  publishEventFn,
  unpublishEventFn,
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
import type { BulkMessageLog } from '../server/bulk-messages'
import { utcIsoToZonedLocal } from '../lib/datetime'
import { formatEur } from '../lib/money'
import type { CouponRow, TicketTypeRow } from '../lib/db-types'
import type { CustomField } from '../lib/custom-fields'

export const Route = createFileRoute('/app/events/$eventId')({
  loader: async ({ params }) => {
    const res = await getMyEventFn({ data: { eventId: params.eventId } })
    if (!res || 'error' in res) throw notFound()
    return res
  },
  component: ManageEvent,
})

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm'
const eurToCents = (s: string) => Math.round(parseFloat(s || '0') * 100)
const centsToEur = (c: number) => (c / 100).toFixed(2)

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
    <div className="max-w-3xl space-y-8">
      <div>
        <Link to="/app" className="text-sm text-indigo-600 hover:underline">
          ← Späť na podujatia
        </Link>
        <div className="mt-3 flex items-center justify-between">
          <h1 className="text-2xl font-bold">{event.title}</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">
              {event.status === 'published' ? 'Zverejnené' : 'Koncept'}
            </span>
            <button
              onClick={togglePublish}
              className={`rounded-md px-4 py-2 text-sm font-medium text-white ${
                event.status === 'published'
                  ? 'bg-gray-600 hover:bg-gray-700'
                  : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {event.status === 'published' ? 'Skryť (koncept)' : 'Zverejniť'}
            </button>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-4 text-sm">
          <Link
            to="/app/events/$eventId/sales"
            params={{ eventId: event.id }}
            className="font-medium text-indigo-600 hover:underline"
          >
            Predaj a tržby →
          </Link>
          <Link
            to="/app/events/$eventId/checkin"
            params={{ eventId: event.id }}
            className="font-medium text-indigo-600 hover:underline"
          >
            Check-in →
          </Link>
          <Link
            to="/app/events/$eventId/guestlist"
            params={{ eventId: event.id }}
            className="font-medium text-indigo-600 hover:underline"
          >
            Guestlist →
          </Link>
          <Link
            to="/app/events/$eventId/manual-order"
            params={{ eventId: event.id }}
            className="font-medium text-indigo-600 hover:underline"
          >
            Ručná objednávka →
          </Link>
          {event.status === 'published' && (
            <a
              href={`/e/${event.slug}`}
              target="_blank"
              rel="noreferrer"
              className="text-indigo-600 hover:underline"
            >
              Verejná stránka: /e/{event.slug} ↗
            </a>
          )}
        </div>
      </div>

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
      <BulkMessageSection eventId={event.id} />
      <EmbedSnippetSection
        slug={event.slug}
        published={event.status === 'published'}
      />
      <CancelEventSection event={event} onChanged={reload} />
    </div>
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

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat('sk-SK', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Europe/Bratislava',
    }).format(new Date(iso))

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
