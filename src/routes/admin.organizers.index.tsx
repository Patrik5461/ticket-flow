import { createFileRoute, Link } from '@tanstack/react-router'
import { listOrganizersFn } from '../server/admin-organizers'
import type { OrganizerListItem } from '../server/admin-organizers'
import { formatEur } from '../lib/money'

export const Route = createFileRoute('/admin/organizers/')({
  loader: async () => {
    const res = await listOrganizersFn()
    if ('error' in res) return [] as OrganizerListItem[]
    return res
  },
  component: OrganizersList,
})

function StatusBadge({ status }: { status: OrganizerListItem['status'] }) {
  const cls =
    status === 'active'
      ? 'bg-green-100 text-green-700'
      : 'bg-red-100 text-red-700'
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status === 'active' ? 'Aktívny' : 'Pozastavený'}
    </span>
  )
}

function OrganizersList() {
  const organizers = Route.useLoaderData()

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Organizátori</h1>
      <section className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm table-cards">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-gray-500">
              <th className="px-4 py-3">Názov</th>
              <th className="px-4 py-3">Stav</th>
              <th className="px-4 py-3 text-right">Provízia</th>
              <th className="px-4 py-3 text-right">Podujatia</th>
              <th className="px-4 py-3 text-right">Objednávky</th>
              <th className="px-4 py-3 text-right">Hrubé tržby</th>
              <th className="px-4 py-3 text-right">Provízia platformy</th>
            </tr>
          </thead>
          <tbody>
            {organizers.map((o) => (
              <tr
                key={o.id}
                className="border-b last:border-0 hover:bg-gray-50"
              >
                <td className="px-4 py-3">
                  <Link
                    to="/admin/organizers/$organizerId"
                    params={{ organizerId: o.id }}
                    className="font-medium text-indigo-600 hover:underline"
                  >
                    {o.name}
                  </Link>
                  <div className="text-xs text-gray-400">/{o.slug}</div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={o.status} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {o.fee_percent} % / min {formatEur(o.fee_min_cents)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {o.eventCount}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {o.paidOrders}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatEur(o.grossCents)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatEur(o.feeCents)}
                </td>
              </tr>
            ))}
            {organizers.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  Žiadni organizátori.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
