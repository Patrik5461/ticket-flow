import {
  createFileRoute,
  notFound,
  Outlet,
  Link,
  useNavigate,
} from '@tanstack/react-router'
import { getAdminSessionFn } from '../server/admin-session'
import { signOutFn } from '../server/auth'

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
  'rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 [&.active]:bg-gray-900 [&.active]:text-white'

function AdminLayout() {
  const { admin } = Route.useRouteContext()
  const navigate = useNavigate()

  const logout = async () => {
    await signOutFn()
    await navigate({ to: '/login' })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link to="/admin" className="font-semibold">
              Ticketio <span className="text-red-500">· admin</span>
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
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-600">{admin.email}</span>
            <button
              onClick={logout}
              className="rounded-md border px-3 py-1.5 hover:bg-gray-50"
            >
              Odhlásiť
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
