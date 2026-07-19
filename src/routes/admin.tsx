import {
  createFileRoute,
  notFound,
  Outlet,
  Link,
  useNavigate,
} from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getAdminSessionFn } from '../server/admin-session'
import { signOutFn } from '../server/auth'
import { getHealthAlertsFn } from '../server/health'
import type { HealthAlert } from '../server/health'
import { ThemeToggle } from '../components/ThemeToggle'

/**
 * Platform super-admin shell. The guard maps a non-admin caller to a 404 (not a
 * redirect or 403) so the admin surface's existence is never revealed.
 */
export const Route = createFileRoute('/admin')({
  beforeLoad: async () => {
    const admin = await getAdminSessionFn()
    if (!admin) throw notFound()
    return { admin }
  },
  component: AdminLayout,
})

const navCls =
  'rounded-lg px-3 py-1.5 text-sm font-medium text-ink-300 transition hover:bg-ink-800 hover:text-ink-100 [&.active]:bg-ink-800 [&.active]:text-ink-100'

function AdminLayout() {
  const { admin } = Route.useRouteContext()
  const navigate = useNavigate()

  const [q, setQ] = useState('')

  const logout = async () => {
    await signOutFn()
    await navigate({ to: '/login' })
  }

  const search = (e: React.FormEvent) => {
    e.preventDefault()
    if (q.trim().length < 2) return
    navigate({ to: '/admin/search', search: { q: q.trim() } })
  }

  return (
    <div className="app-shell">
      <header
        className="sticky top-0 z-40 backdrop-blur"
        style={{
          background:
            'color-mix(in oklab, var(--color-ink-950) 85%, transparent)',
          borderBottom: '1px solid var(--color-ink-700)',
        }}
      >
        <div className="relative mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:gap-6 sm:px-6 sm:py-3.5">
          <div className="flex min-w-0 items-center gap-3 sm:gap-5">
            <Link
              to="/admin"
              className="flex shrink-0 items-center gap-2 font-display text-lg font-bold"
            >
              <span>
                ticket<span style={{ color: 'var(--color-accent)' }}>io</span>
              </span>
              <span className="badge-admin hidden sm:inline-flex">
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 2 4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6l-8-4Z" />
                </svg>
                Platform admin
              </span>
              <span className="badge-admin sm:hidden" style={{ padding: '0.15rem 0.4rem' }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2 4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6l-8-4Z" />
                </svg>
                Admin
              </span>
            </Link>
            {/* Desktop nav */}
            <nav className="hidden items-center gap-1 lg:flex">
              <Link
                to="/admin"
                activeOptions={{ exact: true }}
                className={navCls}
              >
                Prehľad
              </Link>
              <Link to="/admin/organizers" className={navCls}>
                Organizátori
              </Link>
              <Link to="/admin/events" className={navCls}>
                Podujatia
              </Link>
              <Link to="/admin/orders" className={navCls}>
                Objednávky
              </Link>
              <Link to="/admin/payouts" className={navCls}>
                Vyplatenia
              </Link>
              <Link to="/admin/admins" className={navCls}>
                Admini
              </Link>
              <Link to="/admin/health" className={navCls}>
                Status
              </Link>
            </nav>
          </div>
          {/* Desktop right side */}
          <div className="hidden shrink-0 items-center gap-2 text-sm lg:flex">
            <form onSubmit={search} className="hidden md:block">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Hľadať…"
                className="w-40 rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-xs text-ink-100 placeholder:text-ink-500 outline-none focus:border-accent xl:w-56"
              />
            </form>
            <span className="hidden max-w-[140px] truncate text-xs text-ink-400 xl:inline">{admin.email}</span>
            <ThemeToggle />
            <button
              onClick={logout}
              className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs font-medium text-ink-200 transition hover:border-ink-500 hover:text-ink-100"
            >
              Odhlásiť
            </button>
          </div>

          {/* Mobile: theme + hamburger */}
          <div className="flex items-center gap-1 lg:hidden">
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
                <form onSubmit={search} className="mb-2 flex gap-2">
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Hľadať objednávku, e-mail…"
                    className="flex-1 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 outline-none focus:border-accent"
                  />
                </form>
                <Link to="/admin" activeOptions={{ exact: true }}>Prehľad</Link>
                <Link to="/admin/organizers">Organizátori</Link>
                <Link to="/admin/events">Podujatia</Link>
                <Link to="/admin/orders">Objednávky</Link>
                <Link to="/admin/payouts">Vyplatenia</Link>
                <Link to="/admin/admins">Admini</Link>
                <Link to="/admin/health">Status</Link>
                <div className="divider" />
                <div className="px-2 py-1 text-xs text-ink-400 truncate">{admin.email}</div>
                <button onClick={logout}>Odhlásiť sa</button>
              </div>
            </details>
          </div>
        </div>

      </header>
      <HealthAlerts />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
        <Outlet />
      </main>
    </div>
  )
}

/** Admin-wide banner for services down / stuck queues. Mounted once in the
 *  layout, polls every 60s independent of page navigation. */
function HealthAlerts() {
  const [alerts, setAlerts] = useState<HealthAlert[]>([])

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const res = await getHealthAlertsFn()
        if (active && !('error' in res)) setAlerts(res.alerts)
      } catch {
        /* ignore — banner just stays hidden */
      }
    }
    void load()
    const id = setInterval(load, 60_000)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [])

  if (alerts.length === 0) return null
  const hasDown = alerts.some((a) => a.level === 'down')

  return (
    <div
      className="px-6 py-2 text-sm font-medium"
      style={{
        background: hasDown ? '#7f1d1d' : '#78350f',
        color: '#fff',
      }}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1">
        <span>⚠️ {alerts.map((a) => a.text).join(' · ')}</span>
        <Link to="/admin/health" className="underline">
          Detail →
        </Link>
      </div>
    </div>
  )
}
