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
    // Intent (hover) preload is disabled on purpose. The current @tanstack
    // release set is skewed — react-start@1.168.28 ships start-client-core
    // @1.170.14 while react-router@1.170.18 pulls router-core@1.171.15, whose
    // `_nonReactive` store the older start-client preload path can't read, so
    // preloadRoute crashes on hover ("Cannot read properties of undefined
    // (reading '_nonReactive')"). Click-time navigation uses a different path
    // and works. Re-enable ('intent') once the @tanstack versions are realigned.
    defaultPreload: false,
    defaultNotFoundComponent: DefaultNotFound,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
