import { createFileRoute, Link, useRouter, notFound } from '@tanstack/react-router'
import { useState } from 'react'
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
  type EventDetail,
} from '../server/dashboard'
import { utcIsoToZonedLocal } from '../lib/datetime'
import { formatEur } from '../lib/money'
import type { CouponRow, TicketTypeRow } from '../lib/db-types'

export const Route = createFileRoute('/app/events/$eventId')({
  loader: async ({ params }) => {
    const res = await getMyEventFn({ data: { eventId: params.eventId } })
    if (!res || 'error' in res) throw notFound()
    return res as EventDetail
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
      <TicketTypesSection eventId={event.id} types={ticketTypes} onChanged={reload} />
      <CouponsSection eventId={event.id} coupons={coupons} tz={tz} onChanged={reload} />
    </div>
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
  })
  const [msg, setMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
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
        <input value={form.title} onChange={set('title')} className={inputCls} placeholder="Názov" required />
        <textarea value={form.description} onChange={set('description')} rows={3} className={inputCls} placeholder="Popis" />
        <div className="grid grid-cols-2 gap-4">
          <input value={form.venueName} onChange={set('venueName')} className={inputCls} placeholder="Miesto" />
          <input value={form.venueAddress} onChange={set('venueAddress')} className={inputCls} placeholder="Adresa" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Začiatok</span>
            <input type="datetime-local" value={form.startsAtLocal} onChange={set('startsAtLocal')} className={inputCls} required />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Koniec</span>
            <input type="datetime-local" value={form.endsAtLocal} onChange={set('endsAtLocal')} className={inputCls} />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
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
          <TicketTypeForm key={t.id} eventId={eventId} type={t} onChanged={onChanged} />
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
    }
    const res = editing
      ? await updateTicketTypeFn({ data: { ...payload, ticketTypeId: type!.id } })
      : await createTicketTypeFn({ data: { ...payload, eventId } })
    setBusy(false)
    if ('error' in res) {
      setErr(res.error)
      return
    }
    if (!editing) setForm({ name: '', priceEur: '', capacity: '', maxPerOrder: '10', hidden: false })
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
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} />
        </label>
        <label className="col-span-2 text-xs text-gray-500">
          Cena (€)
          <input type="number" step="0.01" min="0" value={form.priceEur} onChange={(e) => setForm((f) => ({ ...f, priceEur: e.target.value }))} className={inputCls} />
        </label>
        <label className="col-span-2 text-xs text-gray-500">
          Kapacita
          <input type="number" min="0" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} className={inputCls} />
        </label>
        <label className="col-span-2 text-xs text-gray-500">
          Max/obj.
          <input type="number" min="1" value={form.maxPerOrder} onChange={(e) => setForm((f) => ({ ...f, maxPerOrder: e.target.value }))} className={inputCls} />
        </label>
        <label className="col-span-2 flex items-center gap-1 pb-2 text-xs text-gray-600">
          <input type="checkbox" checked={form.hidden} onChange={(e) => setForm((f) => ({ ...f, hidden: e.target.checked }))} />
          Skryté
        </label>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button onClick={submit} disabled={busy} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {editing ? 'Uložiť' : '+ Pridať typ'}
        </button>
        {editing && (
          <button onClick={remove} disabled={busy} className="rounded-md border px-3 py-1.5 text-xs text-red-600 hover:bg-red-50">
            Zmazať
          </button>
        )}
        {type && <span className="ml-auto text-xs text-gray-400">{type.sold_count} predaných · {formatEur(type.price_cents)}</span>}
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
          <CouponForm key={c.id} eventId={eventId} coupon={c} tz={tz} onChanged={onChanged} />
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
      type: form.type as 'percent' | 'fixed',
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
          <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} className={inputCls} />
        </label>
        <label className="col-span-3 text-xs text-gray-500">
          Typ
          <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as 'percent' | 'fixed' }))} className={inputCls}>
            <option value="percent">Percentá (%)</option>
            <option value="fixed">Pevná (centy)</option>
          </select>
        </label>
        <label className="col-span-3 text-xs text-gray-500">
          Hodnota {form.type === 'percent' ? '(%)' : '(centy)'}
          <input type="number" min="0" value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} className={inputCls} />
        </label>
        <label className="col-span-3 text-xs text-gray-500">
          Max použití
          <input type="number" min="1" value={form.maxUses} onChange={(e) => setForm((f) => ({ ...f, maxUses: e.target.value }))} className={inputCls} placeholder="∞" />
        </label>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button onClick={submit} disabled={busy} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {editing ? 'Uložiť' : '+ Pridať kupón'}
        </button>
        {editing && (
          <button onClick={remove} disabled={busy} className="rounded-md border px-3 py-1.5 text-xs text-red-600 hover:bg-red-50">
            Zmazať
          </button>
        )}
        {coupon && <span className="ml-auto text-xs text-gray-400">použité {coupon.used_count}×</span>}
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
    </div>
  )
}
