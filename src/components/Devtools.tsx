import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

/**
 * Dev-only devtools panel, isolated in its own module. The
 * `@tanstack/devtools-vite` plugin strips devtools code from files that import
 * these packages — keeping that here means the plugin transforms THIS file, not
 * __root.tsx, so the pre-hydration polyfill/error scripts in the root shell can
 * never be caught by that transform.
 */
export function Devtools() {
  return (
    <TanStackDevtools
      config={{ position: 'bottom-right' }}
      plugins={[
        {
          name: 'Tanstack Router',
          render: <TanStackRouterDevtoolsPanel />,
        },
      ]}
    />
  )
}
