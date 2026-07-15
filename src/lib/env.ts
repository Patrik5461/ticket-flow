/**
 * Server-side environment. Import ONLY from server code (server functions,
 * server routes, server services) — it reads process.env and must never reach
 * the client bundle.
 */

import { z } from 'zod'

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
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
    cached = schema.parse(process.env)
  }
  return cached
}

export function isGoPayConfigured(): boolean {
  const e = getEnv()
  return Boolean(e.GOPAY_GOID && e.GOPAY_CLIENT_ID && e.GOPAY_CLIENT_SECRET)
}
