import {
  createFileRoute,
  redirect,
  Outlet,
  Link,
  useNavigate,
} from '@tanstack/react-router'
import { getSessionFn, signOutFn } from '../server/auth'
import { stopImpersonationFn } from '../server/impersonation'
import { ThemeToggle } from '../components/ThemeToggle'

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

  const exitImpersonation = async () => {
    await stopImpersonationFn()
    await navigate({ to: '/admin' })
  }

  return (
    <div className="app-shell">
      {session.impersonating && (
        <div
          className="sticky top-0 z-50 flex items-center justify-between gap-3 px-6 py-2 text-sm font-medium"
          style={{ background: '#b45309', color: '#fff' }}
        >
          <span>
            👁 Prezeráš ako{' '}
            <strong>{session.impersonating.organizerName}</strong> — režim
            čítania (zmeny sú zablokované)
          </span>
          <button
            onClick={exitImpersonation}
            className="rounded-md bg-white/20 px-3 py-1 text-xs font-semibold hover:bg-white/30"
          >
            Ukončiť a späť do /admin
          </button>
        </div>
      )}
      <header
        className="sticky top-0 z-40 backdrop-blur"
        style={{
          background:
            'color-mix(in oklab, var(--color-ink-950) 85%, transparent)',
          borderBottom: '1px solid var(--color-ink-700)',
        }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-3.5">
          <Link
            to="/app"
            className="flex items-center gap-2 font-display text-lg font-bold"
          >
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
            <ThemeToggle className="ml-2" />
            <button
              onClick={logout}
              className="ml-1 rounded-lg border border-ink-700 px-3 py-1.5 text-xs font-medium text-ink-200 transition hover:border-ink-500 hover:text-ink-100"
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
