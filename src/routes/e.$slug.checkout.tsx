import { createFileRoute, notFound, Link } from '@tanstack/react-router'
import { useState } from 'react'
import {
  getEventFn,
  previewPricingFn,
  createOrderFn,
  lookupCompanyFn,
} from '../server/fns'
import { formatEur } from '../lib/money'
import { EventAnalytics } from '../components/EventAnalytics'
import type { CustomField } from '../lib/custom-fields'

interface CartItem {
  ticketTypeId: string
  quantity: number
  name: string
  unitPriceCents: number
  customFields: CustomField[]
}

function parseItems(raw: string): { ticketTypeId: string; quantity: number }[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((part) => {
      const [ticketTypeId, qty] = part.split(':')
      return { ticketTypeId, quantity: Number(qty) }
    })
    .filter(
      (i) => i.ticketTypeId && Number.isInteger(i.quantity) && i.quantity > 0,
    )
}

export const Route = createFileRoute('/e/$slug/checkout')({
  validateSearch: (search: Record<string, unknown>) => ({
    items: typeof search.items === 'string' ? search.items : '',
  }),
  loaderDeps: ({ search }) => ({ items: search.items }),
  loader: async ({ params, deps }) => {
    const data = await getEventFn({ data: { slug: params.slug } })
    if (!data) throw notFound()

    const parsed = parseItems(deps.items)
    const byId = new Map(data.ticketTypes.map((t) => [t.id, t]))
    const cart: CartItem[] = parsed
      .filter((i) => byId.has(i.ticketTypeId))
      .map((i) => {
        const t = byId.get(i.ticketTypeId)!
        return {
          ticketTypeId: i.ticketTypeId,
          quantity: i.quantity,
          name: t.name,
          unitPriceCents: t.price_cents,
          customFields: t.customFields,
        }
      })
    return { event: data.event, cart }
  },
  component: Checkout,
})

function Field({
  label,
  children,
  required,
}: {
  label: string
  children: React.ReactNode
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-200">
        {label} {required && <span className="text-accent">*</span>}
      </span>
      {children}
    </label>
  )
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: CustomField
  value: string
  onChange: (v: string) => void
}) {
  if (field.type === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-sm text-ink-200">
        <input
          type="checkbox"
          checked={value === 'true'}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
        />
        {field.label} {field.required && <span className="text-accent">*</span>}
      </label>
    )
  }
  return (
    <Field label={field.label} required={field.required}>
      {field.type === 'select' ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        >
          <option value="">— vyberte —</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      )}
    </Field>
  )
}

const inputCls =
  'w-full rounded-xl border border-ink-700 bg-ink-900 px-4 py-3 text-ink-100 placeholder:text-ink-500 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20'

function Checkout() {
  const { slug } = Route.useParams()
  const { event, cart } = Route.useLoaderData()

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [couponCode, setCouponCode] = useState('')
  const [accept, setAccept] = useState(false)
  // Attendee answers: { [ticketTypeId]: [ {fieldKey: value}, ... ] }
  const [answers, setAnswers] = useState<
    Record<string, Record<string, string>[]>
  >({})
  const setAnswer = (tid: string, idx: number, key: string, val: string) =>
    setAnswers((a) => {
      const arr = [...(a[tid] ?? [])]
      arr[idx] = { ...(arr[idx] ?? {}), [key]: val }
      return { ...a, [tid]: arr }
    })
  // "Kúpiť na firmu"
  const [companyBuy, setCompanyBuy] = useState(false)
  const [ico, setIco] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [companyAddress, setCompanyAddress] = useState('')
  const [companyDic, setCompanyDic] = useState('')
  const [companyIcDph, setCompanyIcDph] = useState('')
  const [companyBusy, setCompanyBusy] = useState(false)
  const [companyMsg, setCompanyMsg] = useState<string | null>(null)
  const [discountCents, setDiscountCents] = useState(0)
  const [couponMsg, setCouponMsg] = useState<{
    ok: boolean
    text: string
  } | null>(null)
  const [couponBusy, setCouponBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const subtotal = cart.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0)
  const total = Math.max(0, subtotal - discountCents)

  const cartPayload = cart.map((i) => ({
    ticketTypeId: i.ticketTypeId,
    quantity: i.quantity,
  }))

  const applyCoupon = async () => {
    setCouponMsg(null)
    setCouponBusy(true)
    try {
      const preview = await previewPricingFn({
        data: {
          slug,
          items: cartPayload,
          couponCode: couponCode.trim() || null,
        },
      })
      setDiscountCents(preview.discountCents)
      if (preview.coupon?.ok === false) {
        setCouponMsg({ ok: false, text: preview.coupon.message })
      } else if (preview.coupon?.ok) {
        setCouponMsg({
          ok: true,
          text: `Zľava −${formatEur(preview.discountCents)}`,
        })
      }
    } finally {
      setCouponBusy(false)
    }
  }

  const lookupCompany = async () => {
    setCompanyMsg(null)
    setCompanyBusy(true)
    try {
      const res = await lookupCompanyFn({ data: { ico: ico.trim() } })
      if ('company' in res && res.company) {
        setCompanyName(res.company.name)
        setCompanyAddress(res.company.address ?? '')
        setCompanyMsg(null)
      } else {
        setCompanyMsg(res.error)
      }
    } finally {
      setCompanyBusy(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = await createOrderFn({
        data: {
          slug,
          items: cartPayload,
          buyer: {
            email: email.trim(),
            name: name.trim() || undefined,
            phone: phone.trim() || undefined,
          },
          couponCode: couponCode.trim() || null,
          answers,
          billing:
            companyBuy && companyName.trim()
              ? {
                  ico: ico.trim() || null,
                  dic: companyDic.trim() || null,
                  icDph: companyIcDph.trim() || null,
                  name: companyName.trim(),
                  address: companyAddress.trim() || null,
                }
              : null,
          acceptTerms: accept as true,
        },
      })
      if ('error' in result) {
        setError(result.error)
        setSubmitting(false)
        return
      }
      window.location.href = result.redirectUrl
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznáma chyba.')
      setSubmitting(false)
    }
  }

  if (cart.length === 0) {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <div className="card-surface p-10">
          <p className="text-ink-300">Košík je prázdny.</p>
          <Link
            to="/e/$slug"
            params={{ slug }}
            className="btn-primary mt-6 inline-flex"
          >
            Späť na podujatie
          </Link>
        </div>
      </div>
    )
  }

  const Summary = (
    <div className="card-surface p-6">
      <div className="text-xs font-semibold uppercase tracking-widest text-accent">
        Súhrn objednávky
      </div>
      <h2 className="mt-1 font-display text-xl font-bold">{event.title}</h2>

      <ul className="mt-5 space-y-2 border-t border-ink-700 pt-4 text-sm">
        {cart.map((i) => (
          <li
            key={i.ticketTypeId}
            className="flex justify-between text-ink-200"
          >
            <span>
              <span className="text-ink-400">{i.quantity}×</span> {i.name}
            </span>
            <span className="tabular-nums">
              {formatEur(i.quantity * i.unitPriceCents)}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 space-y-1.5 border-t border-ink-700 pt-4 text-sm">
        <div className="flex justify-between text-ink-400">
          <span>Medzisúčet</span>
          <span className="tabular-nums">{formatEur(subtotal)}</span>
        </div>
        {discountCents > 0 && (
          <div className="flex justify-between text-accent">
            <span>Zľava</span>
            <span className="tabular-nums">−{formatEur(discountCents)}</span>
          </div>
        )}
        <div className="mt-2 flex items-baseline justify-between border-t border-ink-700 pt-3">
          <span className="text-sm text-ink-300">Spolu</span>
          <span className="font-display text-2xl font-bold tabular-nums">
            {formatEur(total)}
          </span>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen">
      <EventAnalytics
        ga4Id={event.ga4_measurement_id}
        pixelId={event.meta_pixel_id}
      />
      <div className="mx-auto max-w-6xl px-6 py-10 md:py-16">
        <Link
          to="/e/$slug"
          params={{ slug }}
          className="inline-flex items-center gap-2 text-sm text-ink-300 transition hover:text-ink-100"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Späť
        </Link>
        <h1 className="mt-6 font-display text-4xl font-bold md:text-5xl">
          Pokladňa
        </h1>
        <p className="mt-2 text-ink-400">
          Vyplňte údaje a pokračujte na platbu.
        </p>

        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_400px]">
          {/* FORM */}
          <form onSubmit={submit} className="space-y-6">
            <section className="card-surface p-6">
              <h2 className="font-display text-lg font-bold">
                Kontaktné údaje
              </h2>
              <div className="mt-4 grid gap-4">
                <Field label="E-mail" required>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="vas@email.sk"
                    className={inputCls}
                  />
                  <span className="mt-1.5 block text-xs text-ink-500">
                    Na tento e-mail vám pošleme vstupenky s QR kódom.
                  </span>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Meno">
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Telefón">
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className={inputCls}
                    />
                  </Field>
                </div>
              </div>
            </section>

            <section className="card-surface p-6">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={companyBuy}
                  onChange={(e) => setCompanyBuy(e.target.checked)}
                />
                <span className="font-display text-lg font-bold">
                  Kúpiť na firmu
                </span>
              </label>
              {companyBuy && (
                <div className="mt-4 grid gap-4">
                  <Field label="IČO">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        value={ico}
                        onChange={(e) => setIco(e.target.value)}
                        placeholder="12345678"
                        className={inputCls}
                      />
                      <button
                        type="button"
                        onClick={lookupCompany}
                        disabled={companyBusy || !ico.trim()}
                        className="btn-ghost shrink-0 disabled:opacity-40"
                      >
                        {companyBusy ? 'Načítavam…' : 'Načítať z registra'}
                      </button>
                    </div>
                    {companyMsg && (
                      <span className="mt-1.5 block text-xs text-red-400">
                        {companyMsg}
                      </span>
                    )}
                  </Field>
                  <Field label="Názov firmy" required>
                    <input
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Adresa">
                    <input
                      value={companyAddress}
                      onChange={(e) => setCompanyAddress(e.target.value)}
                      className={inputCls}
                    />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="DIČ">
                      <input
                        value={companyDic}
                        onChange={(e) => setCompanyDic(e.target.value)}
                        className={inputCls}
                      />
                    </Field>
                    <Field label="IČ DPH">
                      <input
                        value={companyIcDph}
                        onChange={(e) => setCompanyIcDph(e.target.value)}
                        className={inputCls}
                      />
                    </Field>
                  </div>
                </div>
              )}
            </section>

            {cart.some((c) => c.customFields.length > 0) && (
              <section className="card-surface p-6">
                <h2 className="font-display text-lg font-bold">
                  Údaje účastníkov
                </h2>
                <div className="mt-4 space-y-5">
                  {cart
                    .filter((c) => c.customFields.length > 0)
                    .map((c) => (
                      <div key={c.ticketTypeId} className="space-y-3">
                        {Array.from({ length: c.quantity }).map((_, idx) => (
                          <div
                            key={idx}
                            className="rounded-xl border border-ink-700 p-4"
                          >
                            <div className="mb-3 text-sm font-semibold text-ink-200">
                              {c.name} #{idx + 1}
                            </div>
                            <div className="space-y-3">
                              {c.customFields.map((f) => (
                                <FieldInput
                                  key={f.key}
                                  field={f}
                                  value={
                                    (
                                      answers[c.ticketTypeId] as
                                        | Record<string, string>[]
                                        | undefined
                                    )?.[idx]?.[f.key] ?? ''
                                  }
                                  onChange={(v) =>
                                    setAnswer(c.ticketTypeId, idx, f.key, v)
                                  }
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                </div>
              </section>
            )}

            <section className="card-surface p-6">
              <h2 className="font-display text-lg font-bold">Zľavový kupón</h2>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  placeholder="Napíšte kód"
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={applyCoupon}
                  disabled={couponBusy || !couponCode.trim()}
                  className="btn-ghost shrink-0 disabled:opacity-40"
                >
                  {couponBusy ? 'Overujem…' : 'Uplatniť'}
                </button>
              </div>
              {couponMsg && (
                <p
                  className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                    couponMsg.ok
                      ? 'bg-accent/10 text-accent'
                      : 'bg-red-500/10 text-red-400'
                  }`}
                >
                  {couponMsg.text}
                </p>
              )}
            </section>

            <section className="card-surface p-6">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={accept}
                  onChange={(e) => setAccept(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[color:var(--color-accent)]"
                />
                <span className="text-sm text-ink-300">
                  Súhlasím s{' '}
                  <a href="/vop" className="text-accent hover:underline">
                    obchodnými podmienkami
                  </a>{' '}
                  a spracovaním osobných údajov na účel odoslania vstupeniek.
                </span>
              </label>
            </section>

            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
                <div className="font-semibold">
                  Nepodarilo sa spracovať objednávku
                </div>
                <div className="mt-1">{error}</div>
              </div>
            )}

            <button
              type="submit"
              disabled={!accept || submitting}
              className="btn-primary w-full py-4 text-base disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {submitting ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-950/30 border-t-ink-950" />
                  Spracúvam…
                </>
              ) : (
                <>
                  Zaplatiť {formatEur(total)}
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M5 12h14M13 5l7 7-7 7" />
                  </svg>
                </>
              )}
            </button>
            <p className="text-center text-xs text-ink-500">
              Platba prebieha zabezpečene cez GoPay.
            </p>
          </form>

          {/* SUMMARY */}
          <aside className="lg:sticky lg:top-8 lg:self-start">{Summary}</aside>
        </div>
      </div>
    </div>
  )
}
