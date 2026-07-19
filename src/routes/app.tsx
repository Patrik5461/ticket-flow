import {
  createFileRoute,
  redirect,
  Outlet,
  Link,
  useNavigate,
} from '@tanstack/react-router'
import { useState } from 'react'
import {
  CalendarDays,
  MapPin,
  Wallet,
  Code2,
  Settings,
  LogOut,
  Menu,
  X,
} from 'lucide-react'
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

type NavItem = {
  to: string
  label: string
  icon: typeof CalendarDays
  exact?: boolean
}

const navItems: NavItem[] = [
  { to: '/app', label: 'Moje podujatia', icon: CalendarDays, exact: true },
  { to: '/app/venues', label: 'Mapy sedadiel', icon: MapPin },
  { to: '/app/settlements', label: 'Vyúčtovania', icon: Wallet },
  { to: '/app/developers', label: 'API', icon: Code2 },
  { to: '/app/settings', label: 'Nastavenia', icon: Settings },
]

const navLinkCls =
  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-ink-300 transition hover:bg-ink-800 hover:text-ink-100 [&.active]:bg-accent/15 [&.active]:text-accent [&.active]:ring-1 [&.active]:ring-accent/30'

function AppLayout() {
  const { session } = Route.useRouteContext()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  const logout = async () => {
    await signOutFn()
    await navigate({ to: '/login' })
  }

  const exitImpersonation = async () => {
    await stopImpersonationFn()
    await navigate({ to: '/admin' })
  }

  const SidebarInner = ({ onNavigate }: { onNavigate?: () => void }) => (
    <>
      <div className="flex items-center justify-between px-5 pb-5 pt-6">
        <Link
          to="/app"
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
        <span className="text-xs font-normal uppercase tracking-widest text-ink-400">
          Portál organizátora
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
        <div className="flex items-center justify-between gap-2">
          <div
            className="min-w-0 flex-1 truncate text-xs text-ink-400"
            title={session.organizer?.name ?? session.user.email}
          >
            {session.organizer?.name ?? session.user.email}
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
            to="/app"
            className="flex items-center gap-2 font-display text-lg font-bold"
          >
            <span>
              ticket<span style={{ color: 'var(--color-accent)' }}>io</span>
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
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
