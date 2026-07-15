import { createFileRoute, notFound, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { getEventFn, previewPricingFn, createOrderFn } from '../server/fns'
import { formatEur } from '../lib/money'

interface CartItem {
  ticketTypeId: string
  quantity: number
  name: string
  unitPriceCents: number
}

function parseItems(raw: string): { ticketTypeId: string; quantity: number }[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((part) => {
      const [ticketTypeId, qty] = part.split(':')
      return { ticketTypeId, quantity: Number(qty) }
    })
    .filter((i) => i.ticketTypeId && Number.isInteger(i.quantity) && i.quantity > 0)
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
        }
      })
    return { event: data.event, cart }
  },
  component: Checkout,
})

function Checkout() {
  const { slug } = Route.useParams()
  const { event, cart } = Route.useLoaderData()

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [couponCode, setCouponCode] = useState('')
  const [accept, setAccept] = useState(false)
  const [discountCents, setDiscountCents] = useState(0)
  const [couponMsg, setCouponMsg] = useState<string | null>(null)
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
    const preview = await previewPricingFn({
      data: { slug, items: cartPayload, couponCode: couponCode.trim() || null },
    })
    setDiscountCents(preview.discountCents)
    if (preview.coupon?.ok === false) {
      setCouponMsg(preview.coupon.message)
    } else if (preview.coupon?.ok) {
      setCouponMsg(`Kupón uplatnený: −${formatEur(preview.discountCents)}`)
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
          buyer: { email: email.trim(), name: name.trim() || undefined, phone: phone.trim() || undefined },
          couponCode: couponCode.trim() || null,
          acceptTerms: accept as true,
        },
      })
      if ('error' in result) {
        setError(result.error)
        setSubmitting(false)
        return
      }
      // Full-page redirect to GoPay gateway (or the order page for free orders).
      window.location.href = result.redirectUrl
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznáma chyba.')
      setSubmitting(false)
    }
  }

  if (cart.length === 0) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="text-gray-600">Košík je prázdny.</p>
        <Link
          to="/e/$slug"
          params={{ slug }}
          className="mt-4 inline-block text-indigo-600 hover:underline"
        >
          ← Späť na podujatie
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md px-6 py-12">
      <Link to="/e/$slug" params={{ slug }} className="text-sm text-indigo-600 hover:underline">
        ← Späť
      </Link>
      <h1 className="mt-4 text-2xl font-bold">Pokladňa</h1>
      <p className="text-gray-600">{event.title}</p>

      <section className="mt-6 rounded-lg border p-4">
        {cart.map((i) => (
          <div key={i.ticketTypeId} className="flex justify-between py-1 text-sm">
            <span>
              {i.quantity}× {i.name}
            </span>
            <span>{formatEur(i.quantity * i.unitPriceCents)}</span>
          </div>
        ))}
        <div className="mt-2 border-t pt-2 text-sm">
          <div className="flex justify-between">
            <span>Medzisúčet</span>
            <span>{formatEur(subtotal)}</span>
          </div>
          {discountCents > 0 && (
            <div className="flex justify-between text-green-700">
              <span>Zľava</span>
              <span>−{formatEur(discountCents)}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between text-base font-semibold">
            <span>Spolu</span>
            <span>{formatEur(total)}</span>
          </div>
        </div>
      </section>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">E-mail *</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border px-3 py-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Meno</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border px-3 py-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Telefón</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-md border px-3 py-2"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Zľavový kupón</label>
          <div className="flex gap-2">
            <input
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value)}
              className="w-full rounded-md border px-3 py-2"
            />
            <button
              type="button"
              onClick={applyCoupon}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Uplatniť
            </button>
          </div>
          {couponMsg && <p className="mt-1 text-sm text-gray-600">{couponMsg}</p>}
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={accept}
            onChange={(e) => setAccept(e.target.checked)}
            className="mt-1"
          />
          <span>
            Súhlasím s{' '}
            <a href="/vop" className="text-indigo-600 hover:underline">
              obchodnými podmienkami
            </a>
            .
          </span>
        </label>

        {error && (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
        )}

        <button
          type="submit"
          disabled={!accept || submitting}
          className="w-full rounded-md bg-indigo-600 px-5 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? 'Spracúvam…' : `Zaplatiť ${formatEur(total)}`}
        </button>
      </form>
    </div>
  )
}
