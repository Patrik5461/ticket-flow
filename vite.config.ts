import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

// Content-Security-Policy. Permissive where the app genuinely needs it:
// inline scripts (JSON-LD, analytics config, GoPay), Google Fonts, GA4/Meta
// Pixel, GoPay gateway, and https images (covers, Supabase Storage, QR data
// URIs). `frameAncestors` is passed separately so the embed route can relax it.
function csp(frameAncestors: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "img-src 'self' data: https:",
    "font-src 'self' https://fonts.gstatic.com data:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://connect.facebook.net https://gate.gopay.cz",
    "connect-src 'self' https:",
    "frame-src 'self' https://gate.gopay.cz",
    "form-action 'self' https://gate.gopay.cz",
    `frame-ancestors ${frameAncestors}`,
  ].join('; ')
}

const securityHeaders: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': csp("'self'"),
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  // Vite 8's default target ('baseline-widely-available') assumes Safari 16+,
  // which drops older mobile Safari — the bundle then ships syntax those
  // engines can't parse, so SSR renders but hydration silently dies. Pin an
  // explicit, older target so esbuild down-levels syntax for iOS 14+. (Runtime
  // API gaps like Object.hasOwn / String.prototype.replaceAll aren't syntax and
  // are handled by the pre-hydration polyfill in __root.tsx.)
  build: {
    target: ['safari14', 'chrome87', 'firefox78', 'edge88'],
  },
  plugins: [
    devtools(),
    nitro({
      rollupConfig: { external: [/^@sentry\//] },
      routeRules: {
        '/**': { headers: securityHeaders },
        // The embed widget must be iframeable on organizers' sites.
        '/e/*/embed': {
          headers: { ...securityHeaders, 'Content-Security-Policy': csp('*') },
        },
      },
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
