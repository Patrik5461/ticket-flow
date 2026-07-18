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
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-3.5">
          <div className="flex flex-wrap items-center gap-5">
            <Link
              to="/admin"
              className="flex items-center gap-2 font-display text-lg font-bold"
            >
              <span>
                ticket<span style={{ color: 'var(--color-accent)' }}>io</span>
              </span>
              <span className="badge-admin">
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
            </Link>
            <nav className="flex items-center gap-1">
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
          <div className="flex items-center gap-3 text-sm">
            <form onSubmit={search}>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Hľadať e-mail, event, org, obj.#, GoPay…"
                className="w-64 rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-xs text-ink-100 placeholder:text-ink-500 outline-none focus:border-accent"
              />
            </form>
            <span className="text-xs text-ink-400">{admin.email}</span>
            <ThemeToggle />

            <button
              onClick={logout}
              className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs font-medium text-ink-200 transition hover:border-ink-500 hover:text-ink-100"
            >
              Odhlásiť
            </button>
          </div>
        </div>
      </header>
      <HealthAlerts />
      <main className="mx-auto max-w-6xl px-6 py-10">
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
