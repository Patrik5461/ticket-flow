import { createFileRoute, Link } from '@tanstack/react-router'
import { listMySettlementsFn } from '../server/settlements'
import { formatEur } from '../lib/money'

export const Route = createFileRoute('/app/settlements')({
  loader: async () => listMySettlementsFn(),
  component: SettlementsPage,
})

function SettlementsPage() {
  const settlements = Route.useLoaderData()

  const monthLabel = (iso: string) =>
    new Intl.DateTimeFormat('sk-SK', {
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/Bratislava',
    }).format(new Date(iso))

  return (
    <div className="space-y-5">
      <div>
        <Link to="/app" className="text-sm text-indigo-600 hover:underline">
          ← Späť na podujatia
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Vyúčtovania</h1>
        <p className="mt-1 text-sm text-gray-500">
          Mesačný súhrn tržieb, provízie a netto. Generuje sa 1. deň v mesiaci
          za predchádzajúci mesiac.
        </p>
      </div>

      <section className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-gray-500">
              <th className="px-4 py-3">Obdobie</th>
              <th className="px-4 py-3 text-right">Objednávky</th>
              <th className="px-4 py-3 text-right">Hrubé tržby</th>
              <th className="px-4 py-3 text-right">Provízia</th>
              <th className="px-4 py-3 text-right">Refundácie</th>
              <th className="px-4 py-3 text-right">Netto</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {settlements.map((s) => (
              <tr
                key={s.id}
                className="border-b last:border-0 hover:bg-gray-50"
              >
                <td className="px-4 py-3 font-medium capitalize">
                  {monthLabel(s.period_start)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {s.order_count}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatEur(s.gross_cents)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                  {formatEur(s.fee_cents)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                  {formatEur(s.refunded_cents)}
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">
                  {formatEur(s.net_cents)}
                </td>
                <td className="px-4 py-3 text-right">
                  <a
                    href={`/api/settlements/${s.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-gray-50"
                  >
                    PDF
                  </a>
                </td>
              </tr>
            ))}
            {settlements.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  Zatiaľ žiadne vyúčtovania.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
