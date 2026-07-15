import {
  createFileRoute,
  Link,
  notFound,
  useRouter,
} from '@tanstack/react-router'
import { getOrderAdminFn } from '../server/admin-orders'
import { getOrderRefundDetailFn } from '../server/refunds'
import { OrderRefundPanel } from '../components/OrderRefundPanel'
import { formatEur } from '../lib/money'
import type { OrderStatus } from '../lib/db-types'

export const Route = createFileRoute('/admin/orders/$orderId')({
  loader: async ({ params }) => {
    const [res, refund] = await Promise.all([
      getOrderAdminFn({ data: { orderId: params.orderId } }),
      getOrderRefundDetailFn({ data: { orderId: params.orderId } }),
    ])
    if ('error' in res) throw notFound()
    return { detail: res, refund: 'error' in refund ? null : refund }
  },
  component: OrderDetail,
})

const STATUS_SK: Record<OrderStatus, string> = {
  pending: 'Čaká na platbu',
  paid: 'Zaplatené',
  expired: 'Expirované',
  cancelled: 'Zrušené',
  refunded: 'Vrátené',
  partially_refunded: 'Čiastočne vrátené',
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}

function OrderDetail() {
  const { detail, refund } = Route.useLoaderData()
  const { order, event, items, tickets, payments } = detail
  const router = useRouter()

  const fmt = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat('sk-SK', {
          dateStyle: 'short',
          timeStyle: 'medium',
          timeZone: event.timezone,
        }).format(new Date(iso))
      : '—'

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          to="/admin/orders"
          className="text-sm text-indigo-600 hover:underline"
        >
          ← Späť na vyhľadávanie
        </Link>
        <h1 className="mt-2 flex items-center gap-3 text-2xl font-bold">
          Objednávka <span className="font-mono">{order.ref}</span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-sm font-medium text-gray-700">
            {STATUS_SK[order.status]}
          </span>
        </h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">
            Kupujúci
          </h2>
          <Row label="E-mail" value={order.buyer_email} />
          <Row label="Meno" value={order.buyer_name ?? '—'} />
          <Row label="Telefón" value={order.buyer_phone ?? '—'} />
        </section>

        <section className="rounded-lg border bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">
            Podujatie
          </h2>
          <Row label="Názov" value={event.title} />
          <Row
            label="Organizátor"
            value={
              <Link
                to="/admin/organizers/$organizerId"
                params={{ organizerId: event.organizerId }}
                className="text-indigo-600 hover:underline"
              >
                {event.organizerName}
              </Link>
            }
          />
          <Row label="Vytvorená" value={fmt(order.created_at)} />
          <Row label="Zaplatená" value={fmt(order.paid_at)} />
        </section>
      </div>

      <section className="rounded-lg border bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">
          Položky
        </h2>
        <table className="w-full text-sm">
          <tbody>
            {items.map((i, idx) => (
              <tr key={idx} className="border-t first:border-t-0">
                <td className="py-1.5">
                  {i.quantity}× {i.name}
                </td>
                <td className="py-1.5 text-right tabular-nums text-gray-600">
                  {formatEur(i.unit_price_cents * i.quantity)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 border-t pt-3">
          <Row label="Medzisúčet" value={formatEur(order.subtotal_cents)} />
          {order.discount_cents > 0 && (
            <Row label="Zľava" value={`−${formatEur(order.discount_cents)}`} />
          )}
          <Row
            label="Spolu"
            value={
              <span className="font-bold">{formatEur(order.total_cents)}</span>
            }
          />
          <Row label="Provízia platformy" value={formatEur(order.fee_cents)} />
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">
            Vstupenky
          </h2>
          <Row label="Spolu" value={tickets.total} />
          <Row label="Platné" value={tickets.valid} />
          <Row label="Použité (check-in)" value={tickets.used} />
          <Row label="Zrušené" value={tickets.cancelled} />
        </section>

        <section className="rounded-lg border bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">
            Platba
          </h2>
          <Row label="GoPay ID" value={order.gopay_payment_id ?? '—'} />
          {payments.length === 0 ? (
            <p className="mt-2 text-sm text-gray-400">
              Žiadne platobné udalosti.
            </p>
          ) : (
            <ul className="mt-2 space-y-1 text-xs">
              {payments.map((p, idx) => (
                <li key={idx} className="flex justify-between gap-3">
                  <span className="font-mono">{p.state}</span>
                  <span className="text-gray-400">{fmt(p.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {refund && (
        <OrderRefundPanel
          detail={refund}
          onChanged={() => router.invalidate()}
        />
      )}
    </div>
  )
}
