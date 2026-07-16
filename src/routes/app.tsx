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
    <div className="app-shell">
      <header
        className="sticky top-0 z-40 backdrop-blur"
        style={{
          background: 'color-mix(in oklab, var(--color-ink-950) 85%, transparent)',
          borderBottom: '1px solid var(--color-ink-700)',
        }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <Link to="/app" className="flex items-center gap-2 font-display text-lg font-bold">
            <span>
              ticket<span style={{ color: 'var(--color-accent)' }}>io</span>
            </span>
            <span className="text-xs font-normal uppercase tracking-widest text-ink-400">
              · portál
            </span>
          </Link>
          <div className="flex items-center gap-1 text-sm">
            <Link
              to="/app/settlements"
              className="rounded-lg px-3 py-1.5 text-ink-300 transition hover:bg-ink-800 hover:text-ink-100"
            >
              Vyúčtovania
            </Link>
            <Link
              to="/app/developers"
              className="rounded-lg px-3 py-1.5 text-ink-300 transition hover:bg-ink-800 hover:text-ink-100"
            >
              API
            </Link>
            <Link
              to="/app/settings"
              className="rounded-lg px-3 py-1.5 text-ink-300 transition hover:bg-ink-800 hover:text-ink-100"
            >
              Nastavenia
            </Link>
            <div
              className="mx-2 h-6 w-px"
              style={{ background: 'var(--color-ink-700)' }}
            />
            <span
              className="max-w-[160px] truncate text-xs text-ink-400"
              title={session.organizer?.name ?? session.user.email}
            >
              {session.organizer?.name ?? session.user.email}
            </span>
            <button
              onClick={logout}
              className="ml-2 rounded-lg border border-ink-700 px-3 py-1.5 text-xs font-medium text-ink-200 transition hover:border-ink-500 hover:text-ink-100"
            >
              Odhlásiť
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <Outlet />
      </main>
    </div>
  )
}
