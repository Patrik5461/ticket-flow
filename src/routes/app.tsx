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
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:gap-6 sm:px-6 sm:py-3.5">
          <Link
            to="/app"
            className="flex min-w-0 items-center gap-2 font-display text-lg font-bold"
          >
            <span className="truncate">
              ticket<span style={{ color: 'var(--color-accent)' }}>io</span>
            </span>
            <span className="hidden text-xs font-normal uppercase tracking-widest text-ink-400 sm:inline">
              · portál
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden items-center gap-1 text-sm md:flex">
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

          {/* Mobile: theme toggle + hamburger */}
          <div className="flex items-center gap-1 md:hidden">
            <ThemeToggle />
            <details className="mobile-nav">
              <summary
                aria-label="Menu"
                className="grid h-11 w-11 place-items-center rounded-lg border border-ink-700 text-ink-100"
              >
                <svg className="mobile-nav-icon-closed" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
                <svg className="mobile-nav-icon-open" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </summary>
              <div className="mobile-nav-panel">
                <div className="px-2 pb-2 pt-1 text-xs text-ink-400 truncate">
                  {session.organizer?.name ?? session.user.email}
                </div>
                <Link to="/app">Moje podujatia</Link>
                <Link to="/app/settlements">Vyúčtovania</Link>
                <Link to="/app/developers">API</Link>
                <Link to="/app/settings">Nastavenia</Link>
                <div className="divider" />
                <button onClick={logout}>Odhlásiť sa</button>
              </div>
            </details>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
        <Outlet />
      </main>
    </div>
  )
}
