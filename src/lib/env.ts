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

/**
 * Public fallback defaults, used as the LAST resort when neither the plain env
 * var nor its TICKETIO_ alias is set. The Lovable sandbox does not deliver our
 * custom secrets into preview, so env validation would otherwise fail there.
 *
 * SAFE to hardcode/commit: the anon key is a PUBLIC client key (Supabase ships it
 * to browsers by design) and access is gated entirely by RLS. The SERVICE ROLE
 * key must NEVER have a hardcoded fallback — it stays env-only (see getEnv).
 */
const PUBLIC_DEFAULTS = {
  SUPABASE_URL: 'https://upymwphlrkxcegnyslky.supabase.co',
  SUPABASE_ANON_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweW13cGhscmt4Y2VnbnlzbGt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMTMxMzMsImV4cCI6MjA5OTY4OTEzM30.iydVpeFkHOjACc4_U6q_NtUwPDrel2QHu0UuL9nL3pA',
} as const

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
  // Shared secret guarding internal cron endpoints (e.g. refund-queue worker).
  CRON_SECRET: z.string().default(''),
  // Faktero (commission invoicing). Without both, invoicing falls back to a log
  // provider (no external call).
  FAKTERO_API_KEY: z.string().default(''),
  FAKTERO_API_URL: z.string().default(''),
  // Resend (transactional email). Without a key, email falls back to the console
  // provider (dev). EMAIL_FROM must be an address on a Resend-verified domain.
  RESEND_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default('Ticketio <noreply@ticketio.sk>'),
})

export type Env = z.infer<typeof schema>

let cached: Env | null = null

export function getEnv(): Env {
  if (!cached) {
    cached = schema.parse({
      // Order: SUPABASE_* env → TICKETIO_* alias → hardcoded public default.
      SUPABASE_URL: pick('SUPABASE_URL') ?? PUBLIC_DEFAULTS.SUPABASE_URL,
      SUPABASE_ANON_KEY:
        pick('SUPABASE_ANON_KEY') ?? PUBLIC_DEFAULTS.SUPABASE_ANON_KEY,
      // No hardcoded fallback — service role stays env-only, checked lazily.
      SUPABASE_SERVICE_ROLE_KEY: pick('SUPABASE_SERVICE_ROLE_KEY'),
      GOPAY_GOID: process.env.GOPAY_GOID,
      GOPAY_CLIENT_ID: process.env.GOPAY_CLIENT_ID,
      GOPAY_CLIENT_SECRET: process.env.GOPAY_CLIENT_SECRET,
      GOPAY_ENV: process.env.GOPAY_ENV,
      APP_URL: process.env.APP_URL,
      CRON_SECRET: process.env.CRON_SECRET,
      FAKTERO_API_KEY: process.env.FAKTERO_API_KEY,
      FAKTERO_API_URL: process.env.FAKTERO_API_URL,
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      EMAIL_FROM: process.env.EMAIL_FROM,
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
