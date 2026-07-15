import { createFileRoute } from '@tanstack/react-router'
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

const STATUS_LABEL: Record<OrderStatus, { text: string; cls: string }> = {
  pending: { text: 'Čaká na platbu', cls: 'bg-amber-100 text-amber-800' },
  paid: { text: 'Zaplatené', cls: 'bg-green-100 text-green-800' },
  expired: { text: 'Platnosť vypršala', cls: 'bg-gray-100 text-gray-600' },
  cancelled: { text: 'Zrušené', cls: 'bg-gray-100 text-gray-600' },
  refunded: { text: 'Vrátené', cls: 'bg-gray-100 text-gray-600' },
}

function OrderPage() {
  const { id } = Route.useParams()
  const { t } = Route.useSearch()
  const { view } = Route.useLoaderData()

  if (!view) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center text-gray-600">
        Objednávka sa nenašla alebo je odkaz neplatný.
      </div>
    )
  }

  const { order, event, tickets } = view
  const status = STATUS_LABEL[order.status]

  return (
    <div className="mx-auto max-w-lg px-6 py-12">
      <h1 className="text-2xl font-bold">{event.title}</h1>
      <div className="mt-2 flex items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${status.cls}`}>
          {status.text}
        </span>
        <span className="text-sm text-gray-500">Objednávka {order.id.slice(0, 8)}</span>
      </div>

      <div className="mt-4 rounded-lg border p-4 text-sm">
        <div className="flex justify-between">
          <span>Medzisúčet</span>
          <span>{formatEur(order.subtotal_cents)}</span>
        </div>
        {order.discount_cents > 0 && (
          <div className="flex justify-between text-green-700">
            <span>Zľava</span>
            <span>−{formatEur(order.discount_cents)}</span>
          </div>
        )}
        <div className="mt-1 flex justify-between font-semibold">
          <span>Spolu</span>
          <span>{formatEur(order.total_cents)}</span>
        </div>
      </div>

      {order.status === 'pending' && (
        <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          Platba zatiaľ nebola potvrdená. Ak ste práve zaplatili, obnovte stránku o chvíľu.
        </p>
      )}

      {tickets.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Vaše vstupenky</h2>
          <ul className="space-y-4">
            {tickets.map((ticket) => (
              <li
                key={ticket.id}
                className="flex items-center gap-4 rounded-lg border p-4"
              >
                <img
                  src={ticket.qrDataUrl}
                  width={96}
                  height={96}
                  alt="QR vstupenky"
                  className="rounded"
                />
                <div className="flex-1">
                  <div className="font-medium">{ticket.typeName}</div>
                  <div className="text-xs text-gray-500">
                    {ticket.id.slice(0, 8).toUpperCase()}
                  </div>
                  <a
                    href={`/api/orders/${id}/tickets/${ticket.id}?t=${encodeURIComponent(t)}`}
                    className="mt-1 inline-block text-sm text-indigo-600 hover:underline"
                  >
                    Stiahnuť PDF
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
