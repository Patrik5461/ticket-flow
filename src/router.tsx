import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

/**
 * Router-level fallback for unmatched routes (and a missing NotFound on the root
 * route). Inline styles on purpose — it must render even when app CSS/context is
 * unavailable. Kept minimal and neutral.
 */
function DefaultNotFound() {
  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.5rem',
        padding: '4rem 1.5rem',
        textAlign: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Stránka sa nenašla</h1>
      <p style={{ color: '#6b7280' }}>
        Požadovaná stránka neexistuje alebo bola presunutá.
      </p>
      <a href="/" style={{ marginTop: '0.75rem', color: '#4f46e5' }}>
        ← Späť na úvod
      </a>
    </div>
  )
}

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: DefaultNotFound,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
