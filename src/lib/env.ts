/**
 * Server-side environment. Import ONLY from server code (server functions,
 * server routes, server services) — it reads process.env and must never reach
 * the client bundle.
 *
 * Supabase vars support a TICKETIO_-prefixed fallback alias: the Lovable sandbox
 * reserves the SUPABASE_ prefix for its own managed secrets, so we cannot set our
 * values under the original names there. Precedence: SUPABASE_* first, then
 * TICKETIO_SUPABASE_* as fallback.
 */

import { z } from 'zod'

/** Read an env var, falling back to its TICKETIO_-prefixed alias. */
function pick(name: string): string | undefined {
  return process.env[name] ?? process.env[`TICKETIO_${name}`]
}

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  // Optional at parse time: public pages run without it. Privileged code calls
  // getServiceRoleKey(), which throws only when the service client is used.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  // GoPay may be unconfigured during early dev; payment creation fails loudly then.
  GOPAY_GOID: z.string().default(''),
  GOPAY_CLIENT_ID: z.string().default(''),
  GOPAY_CLIENT_SECRET: z.string().default(''),
  GOPAY_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  APP_URL: z.string().url().default('http://localhost:3000'),
})

export type Env = z.infer<typeof schema>

let cached: Env | null = null

export function getEnv(): Env {
  if (!cached) {
    cached = schema.parse({
      SUPABASE_URL: pick('SUPABASE_URL'),
      SUPABASE_ANON_KEY: pick('SUPABASE_ANON_KEY'),
      SUPABASE_SERVICE_ROLE_KEY: pick('SUPABASE_SERVICE_ROLE_KEY'),
      GOPAY_GOID: process.env.GOPAY_GOID,
      GOPAY_CLIENT_ID: process.env.GOPAY_CLIENT_ID,
      GOPAY_CLIENT_SECRET: process.env.GOPAY_CLIENT_SECRET,
      GOPAY_ENV: process.env.GOPAY_ENV,
      APP_URL: process.env.APP_URL,
    })
  }
  return cached
}

/** Service role key, resolved lazily. Throws only when actually needed. */
export function getServiceRoleKey(): string {
  const key = getEnv().SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error(
      'Service role key chýba (nastavte SUPABASE_SERVICE_ROLE_KEY alebo TICKETIO_SUPABASE_SERVICE_ROLE_KEY). Táto operácia ho vyžaduje.',
    )
  }
  return key
}

export function isGoPayConfigured(): boolean {
  const e = getEnv()
  return Boolean(e.GOPAY_GOID && e.GOPAY_CLIENT_ID && e.GOPAY_CLIENT_SECRET)
}
