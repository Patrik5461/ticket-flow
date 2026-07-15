import { createFileRoute, Link } from '@tanstack/react-router'
import { getOrderFn } from '../server/fns'
import { formatEur } from '../lib/money'
import type { OrderStatus } from '../lib/db-types'

export const Route = createFileRoute('/order/$id')({
  validateSearch: (search: Record<string, unknown>) => ({
    t: typeof search.t === 'string' ? search.t : '',
  }),
  loaderDeps: ({ search }) => ({ t: search.t }),
  loader: async ({ params, deps }) => {
    const view = await getOrderFn({ data: { orderId: params.id, token: deps.t } })
    return { view }
  },
  component: OrderPage,
})

const STATUS: Record<
  OrderStatus,
  { text: string; tone: 'success' | 'warn' | 'muted'; desc: string }
> = {
  pending: {
    text: 'Čaká na platbu',
    tone: 'warn',
    desc: 'Platba zatiaľ nebola potvrdená. Ak ste práve zaplatili, obnovte stránku o chvíľu.',
  },
  paid: {
    text: 'Zaplatené',
    tone: 'success',
    desc: 'Ďakujeme. Vstupenky nájdete nižšie a tiež v e-maile.',
  },
  expired: {
    text: 'Platnosť vypršala',
    tone: 'muted',
    desc: 'Rezervácia expirovala. Skúste objednávku vytvoriť znova.',
  },
  cancelled: {
    text: 'Zrušené',
    tone: 'muted',
    desc: 'Objednávka bola zrušená.',
  },
  refunded: {
    text: 'Vrátené',
    tone: 'muted',
    desc: 'Platba bola vrátená.',
  },
  partially_refunded: {
    text: 'Čiastočne vrátené',
    tone: 'warn',
    desc: 'Časť objednávky bola refundovaná.',
  },
}

const TONE = {
  success: 'border-accent/40 bg-accent/10 text-accent',
  warn: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  muted: 'border-ink-700 bg-ink-800 text-ink-400',
}

function OrderPage() {
  const { id } = Route.useParams()
  const { t } = Route.useSearch()
  const { view } = Route.useLoaderData()

  if (!view) {
    return (
      <div className="mx-auto max-w-md px-6 py-24">
        <div className="card-surface p-10 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-ink-800 text-ink-400">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
            </svg>
          </div>
          <h1 className="mt-4 font-display text-2xl font-bold">Objednávka nenájdená</h1>
          <p className="mt-2 text-ink-400">Objednávka sa nenašla alebo je odkaz neplatný.</p>
          <Link to="/" className="btn-primary mt-6 inline-flex">Späť na úvod</Link>
        </div>
      </div>
    )
  }

  const { order, event, tickets } = view
  const s = STATUS[order.status]

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-3xl px-6 py-12 md:py-20">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-ink-300 transition hover:text-ink-100">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Späť na úvod
        </Link>

        {/* Status header */}
        <div className="mt-8 animate-fade-up">
          <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-widest ${TONE[s.tone]}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {s.text}
          </div>
          <h1 className="mt-4 font-display text-4xl font-bold md:text-5xl">{event.title}</h1>
          <p className="mt-3 text-ink-400">
            Objednávka <span className="font-mono text-ink-300">#{order.id.slice(0, 8).toUpperCase()}</span>
          </p>
        </div>

        {/* Status message */}
        <div className={`mt-8 rounded-xl border p-4 text-sm ${TONE[s.tone]}`}>
          {s.desc}
        </div>

        {/* Totals */}
        <div className="card-surface mt-6 p-6">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-ink-400">
              <span>Medzisúčet</span>
              <span className="tabular-nums">{formatEur(order.subtotal_cents)}</span>
            </div>
            {order.discount_cents > 0 && (
              <div className="flex justify-between text-accent">
                <span>Zľava</span>
                <span className="tabular-nums">−{formatEur(order.discount_cents)}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between border-t border-ink-700 pt-3">
              <span className="text-ink-300">Spolu</span>
              <span className="font-display text-2xl font-bold tabular-nums">
                {formatEur(order.total_cents)}
              </span>
            </div>
          </div>
        </div>

        {/* Tickets */}
        {tickets.length > 0 && (
          <section className="mt-12">
            <h2 className="font-display text-2xl font-bold">Vaše vstupenky</h2>
            <p className="mt-1 text-sm text-ink-400">
              QR kód ukážte pri vstupe. Vstupenku si môžete stiahnuť aj ako PDF.
            </p>
            <ul className="mt-6 space-y-4">
              {tickets.map((ticket, idx) => (
                <li
                  key={ticket.id}
                  className="card-surface animate-fade-up overflow-hidden"
                  style={{ animationDelay: `${idx * 60}ms` }}
                >
                  <div className="flex flex-col sm:flex-row">
                    <div className="grid place-items-center bg-white p-4 sm:w-40">
                      <img
                        src={ticket.qrDataUrl}
                        width={128}
                        height={128}
                        alt="QR vstupenky"
                        className="h-32 w-32"
                      />
                    </div>
                    <div className="flex flex-1 flex-col justify-between p-6">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-widest text-accent">
                          Vstupenka
                        </div>
                        <div className="mt-1 font-display text-xl font-bold">
                          {ticket.typeName}
                        </div>
                        <div className="mt-2 font-mono text-xs text-ink-500">
                          {ticket.id.slice(0, 8).toUpperCase()}
                        </div>
                      </div>
                      <a
                        href={`/api/orders/${id}/tickets/${ticket.id}?t=${encodeURIComponent(t)}`}
                        className="btn-ghost mt-4 self-start text-sm"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                        </svg>
                        Stiahnuť PDF
                      </a>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
