import {
  createFileRoute,
  notFound,
  Outlet,
  Link,
  useNavigate,
} from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard,
  Building2,
  CalendarDays,
  Receipt,
  Wallet,
  FileText,
  ShieldCheck,
  Activity,
  Search,
  LogOut,
  Menu,
  X,
} from 'lucide-react'
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

const navItems = [
  { to: '/admin', label: 'Prehľad', icon: LayoutDashboard, exact: true },
  { to: '/admin/organizers', label: 'Organizátori', icon: Building2 },
  { to: '/admin/events', label: 'Podujatia', icon: CalendarDays },
  { to: '/admin/orders', label: 'Objednávky', icon: Receipt },
  { to: '/admin/payouts', label: 'Vyplatenia', icon: Wallet },
  { to: '/admin/obsah', label: 'Obsah', icon: FileText },
  { to: '/admin/admins', label: 'Admini', icon: ShieldCheck },
  { to: '/admin/health', label: 'Zdravie systému', icon: Activity },
] as const

const navLinkCls =
  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-ink-300 transition hover:bg-ink-800 hover:text-ink-100 [&.active]:bg-accent/15 [&.active]:text-accent [&.active]:ring-1 [&.active]:ring-accent/30'

function AdminLayout() {
  const { admin } = Route.useRouteContext()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)

  const logout = async () => {
    await signOutFn()
    await navigate({ to: '/login' })
  }

  const search = (e: React.FormEvent) => {
    e.preventDefault()
    if (q.trim().length < 2) return
    setMobileOpen(false)
    navigate({ to: '/admin/search', search: { q: q.trim() } })
  }

  const SidebarInner = ({ onNavigate }: { onNavigate?: () => void }) => (
    <>
      <div className="flex items-center justify-between px-5 pb-5 pt-6">
        <Link
          to="/admin"
          onClick={onNavigate}
          className="flex items-center gap-2 font-display text-lg font-bold"
        >
          <span>
            ticket<span style={{ color: 'var(--color-accent)' }}>io</span>
          </span>
        </Link>
        {onNavigate && (
          <button
            onClick={onNavigate}
            aria-label="Zavrieť menu"
            className="grid h-9 w-9 place-items-center rounded-lg border border-ink-700 text-ink-200 lg:hidden"
          >
            <X size={18} />
          </button>
        )}
      </div>
      <div className="px-5 pb-4">
        <span className="badge-admin">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2 4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6l-8-4Z" />
          </svg>
          Platform admin
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={item.exact ? { exact: true } : undefined}
              className={navLinkCls}
              onClick={onNavigate}
            >
              <Icon size={18} className="shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="mt-auto border-t border-ink-800 p-4 space-y-3">
        <form onSubmit={search} className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-500"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Hľadať…"
            className="w-full rounded-lg border border-ink-700 bg-ink-900 py-2 pl-9 pr-3 text-xs text-ink-100 placeholder:text-ink-500 outline-none focus:border-accent"
          />
        </form>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1 truncate text-xs text-ink-400">
            {admin.email}
          </div>
          <ThemeToggle />
        </div>
        <button
          onClick={logout}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-ink-700 px-3 py-2 text-xs font-medium text-ink-200 transition hover:border-ink-500 hover:text-ink-100"
        >
          <LogOut size={14} />
          Odhlásiť sa
        </button>
      </div>
    </>
  )

  return (
    <div className="app-shell min-h-screen">
      {/* Desktop sidebar */}
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col lg:flex"
        style={{
          background: 'var(--color-ink-950)',
          borderRight: '1px solid var(--color-ink-800)',
        }}
      >
        <SidebarInner />
      </aside>

      {/* Mobile top bar */}
      <header
        className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-800 px-4 py-3 backdrop-blur lg:hidden"
        style={{
          background:
            'color-mix(in oklab, var(--color-ink-950) 85%, transparent)',
        }}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Otvoriť menu"
            className="grid h-11 w-11 place-items-center rounded-lg border border-ink-700 text-ink-100"
          >
            <Menu size={20} />
          </button>
          <Link
            to="/admin"
            className="flex items-center gap-2 font-display text-lg font-bold"
          >
            <span>
              ticket<span style={{ color: 'var(--color-accent)' }}>io</span>
            </span>
            <span className="badge-admin" style={{ padding: '0.15rem 0.4rem' }}>
              Admin
            </span>
          </Link>
        </div>
        <ThemeToggle />
      </header>

      {/* Mobile off-canvas drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className="relative flex h-full w-72 max-w-[80vw] flex-col shadow-2xl"
            style={{
              background: 'var(--color-ink-950)',
              borderRight: '1px solid var(--color-ink-800)',
            }}
          >
            <SidebarInner onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="lg:pl-60">
        <HealthAlerts />
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
          <Outlet />
        </main>
      </div>
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
