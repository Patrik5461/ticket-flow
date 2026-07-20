import {
  createFileRoute,
  Link,
  notFound,
  useRouter,
} from '@tanstack/react-router'
import { getOrderRefundDetailFn } from '../server/refunds'
import { OrderRefundPanel } from '../components/OrderRefundPanel'
import { formatEur } from '../lib/money'
import { formatSk } from '../lib/datetime'
import type { OrderStatus } from '../lib/db-types'

export const Route = createFileRoute('/app/events/$eventId/orders/$orderId')({
  loader: async ({ params }) => {
    const res = await getOrderRefundDetailFn({
      data: { orderId: params.orderId },
    })
    if ('error' in res) throw notFound()
    return res
  },
  component: OrgOrderDetail,
})

const STATUS_SK: Record<OrderStatus, string> = {
  pending: 'Čaká na platbu',
  paid: 'Zaplatené',
  expired: 'Expirované',
  cancelled: 'Zrušené',
  refunded: 'Vrátené',
  partially_refunded: 'Čiastočne vrátené',
}

function OrgOrderDetail() {
  const { eventId } = Route.useParams()
  const detail = Route.useLoaderData()
  const router = useRouter()
  const { order, event } = detail

  const fmt = (iso: string | null) =>
    iso ? formatSk(iso, 'dateTime', event.timezone) : '—'

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          to="/app/events/$eventId/sales"
          params={{ eventId }}
          className="text-sm text-indigo-600 hover:underline"
        >
          ← Späť na predaj
        </Link>
        <h1 className="mt-2 flex items-center gap-3 text-2xl font-bold">
          Objednávka <span className="font-mono">{order.ref}</span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-sm font-medium text-gray-700">
            {STATUS_SK[order.status]}
          </span>
        </h1>
      </div>

      <section className="rounded-lg border bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">
          Kupujúci
        </h2>
        <div className="flex justify-between py-1 text-sm">
          <span className="text-gray-500">E-mail</span>
          <span>{order.buyer_email}</span>
        </div>
        <div className="flex justify-between py-1 text-sm">
          <span className="text-gray-500">Meno</span>
          <span>{order.buyer_name ?? '—'}</span>
        </div>
        <div className="flex justify-between py-1 text-sm">
          <span className="text-gray-500">Vytvorená</span>
          <span>{fmt(order.created_at)}</span>
        </div>
        <div className="mt-3 flex justify-between border-t pt-3 text-sm">
          <span className="text-gray-500">Spolu zaplatené</span>
          <span className="font-bold">{formatEur(order.total_cents)}</span>
        </div>
      </section>

      <OrderRefundPanel detail={detail} onChanged={() => router.invalidate()} />
    </div>
  )
}
