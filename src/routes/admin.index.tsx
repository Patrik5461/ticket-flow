import { createFileRoute } from '@tanstack/react-router'

/**
 * Platform overview. Placeholder for Phase 5 block 1 — the metrics + 30-day sales
 * chart land in a later block. The route exists now so the /admin guard and shell
 * are wired end to end.
 */
export const Route = createFileRoute('/admin/')({
  component: AdminOverview,
})

function AdminOverview() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Prehľad platformy</h1>
      <p className="rounded-lg border bg-white p-6 text-sm text-gray-500">
        Súhrnné metriky a graf predajov pribudnú v ďalšom bloku Fázy 5.
      </p>
    </div>
  )
}
