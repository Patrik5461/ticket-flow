import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/')({ component: Dashboard })

function Dashboard() {
  const { session } = Route.useRouteContext()

  return (
    <div>
      <h1 className="text-2xl font-bold">Prehľad</h1>
      <p className="mt-2 text-gray-600">
        Vitajte, {session.organizer?.name ?? session.user.email}.
      </p>
      <div className="mt-6 rounded-lg border border-dashed bg-white p-8 text-center text-gray-500">
        Zoznam podujatí a ich správa pribudnú v ďalšej časti.
      </div>
    </div>
  )
}
