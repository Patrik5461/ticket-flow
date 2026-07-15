import {
  createFileRoute,
  redirect,
  Outlet,
  Link,
  useNavigate,
} from '@tanstack/react-router'
import { getSessionFn, signOutFn } from '../server/auth'

export const Route = createFileRoute('/app')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) {
      throw redirect({ to: '/login' })
    }
    return { session }
  },
  component: AppLayout,
})

function AppLayout() {
  const { session } = Route.useRouteContext()
  const navigate = useNavigate()

  const logout = async () => {
    await signOutFn()
    await navigate({ to: '/login' })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link to="/app" className="font-semibold">
            Ticketio <span className="text-gray-400">· portál</span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-600">
              {session.organizer?.name ?? session.user.email}
            </span>
            <button
              onClick={logout}
              className="rounded-md border px-3 py-1.5 hover:bg-gray-50"
            >
              Odhlásiť
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
