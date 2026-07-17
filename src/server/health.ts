/**
 * Detailed system health for the admin status panel: dependency checks (DB,
 * Storage, GoPay, Resend, Faktero) with per-check status + latency, job-queue
 * stats (pending/failed/stuck + last activity) and system info. Admin-guarded.
 *
 * The public /api/health stays lightweight (liveness + DB); this is the rich,
 * admin-only view. External-API checks are cached briefly so a 30s auto-refresh
 * doesn't hammer GoPay/Resend/Faktero.
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { serviceClient } from '../lib/supabase/server'
import { getEnv, isGoPayConfigured } from '../lib/env'
import { gopayHealthy } from '../lib/gopay'
import { requirePlatformAdmin, runAdmin } from './admin'

export type HealthStatus = 'ok' | 'degraded' | 'down' | 'not_configured'

export interface ServiceCheck {
  name: string
  status: HealthStatus
  latencyMs: number | null
  detail?: string
}

export interface QueueStat {
  name: string
  pending: number
  failed: number
  stuck: number
  lastActivity: string | null
}

export interface SystemHealth {
  services: ServiceCheck[]
  queues: QueueStat[]
  system: {
    version: string
    uptimeSeconds: number
    organizers: number
    events: number
    orders: number
  }
  checkedAt: string
}

const STUCK_AGE_MS = 10 * 60 * 1000 // pending longer than this ⇒ worker stuck
const EXTERNAL_CACHE_MS = 25 * 1000 // just under the 30s auto-refresh

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms),
    ),
  ])
}

async function timed(
  name: string,
  fn: () => Promise<{ status: HealthStatus; detail?: string }>,
): Promise<ServiceCheck> {
  const t0 = Date.now()
  try {
    const r = await fn()
    return {
      name,
      status: r.status,
      latencyMs: Date.now() - t0,
      detail: r.detail,
    }
  } catch (e) {
    return {
      name,
      status: 'down',
      latencyMs: Date.now() - t0,
      detail: e instanceof Error ? e.message : 'error',
    }
  }
}

// -- external check cache (per service) -------------------------------------
const cache = new Map<string, { at: number; check: ServiceCheck }>()
async function cached(
  name: string,
  fn: () => Promise<{ status: HealthStatus; detail?: string }>,
): Promise<ServiceCheck> {
  const hit = cache.get(name)
  if (hit && Date.now() - hit.at < EXTERNAL_CACHE_MS) return hit.check
  const check = await timed(name, fn)
  cache.set(name, { at: Date.now(), check })
  return check
}

// -- dependency checks ------------------------------------------------------

async function checkDatabase(): Promise<{ status: HealthStatus }> {
  const { error } = await withTimeout(
    Promise.resolve(
      serviceClient().from('app_settings').select('key').limit(1),
    ),
    4000,
  )
  if (error) throw new Error(error.message)
  return { status: 'ok' }
}

async function checkStorage(): Promise<{ status: HealthStatus }> {
  const { error } = await withTimeout(
    serviceClient().storage.listBuckets(),
    4000,
  )
  if (error) throw new Error(error.message)
  return { status: 'ok' }
}

async function checkGopay(): Promise<{
  status: HealthStatus
  detail?: string
}> {
  if (!isGoPayConfigured()) return { status: 'not_configured' }
  const ok = await withTimeout(gopayHealthy(), 6000)
  return ok ? { status: 'ok' } : { status: 'down', detail: 'auth failed' }
}

async function checkResend(): Promise<{
  status: HealthStatus
  detail?: string
}> {
  const key = getEnv().RESEND_API_KEY
  if (!key) return { status: 'not_configured' }
  const res = await fetch('https://api.resend.com/domains', {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(5000),
  })
  if (res.ok) return { status: 'ok' }
  if (res.status === 401) return { status: 'down', detail: 'neplatný kľúč' }
  return { status: 'degraded', detail: `HTTP ${res.status}` }
}

async function checkFaktero(): Promise<{
  status: HealthStatus
  detail?: string
}> {
  const env = getEnv()
  if (!env.FAKTERO_API_KEY || !env.FAKTERO_API_URL) {
    return { status: 'not_configured' }
  }
  const res = await fetch(env.FAKTERO_API_URL, {
    headers: { Authorization: `Bearer ${env.FAKTERO_API_KEY}` },
    signal: AbortSignal.timeout(5000),
  })
  return res.status < 500
    ? { status: 'ok' }
    : { status: 'degraded', detail: `HTTP ${res.status}` }
}

// -- queues -----------------------------------------------------------------

async function jobQueue(
  table: string,
  name: string,
  activeStatuses: string[],
): Promise<QueueStat> {
  const db = serviceClient()
  const { data: rows } = await db
    .from(table)
    .select('status, attempts, max_attempts, created_at')
    .in('status', activeStatuses)
    .returns<
      {
        status: string
        attempts: number
        max_attempts: number
        created_at: string
      }[]
    >()
  const now = Date.now()
  let pending = 0
  let failed = 0
  let stuck = 0
  for (const r of rows ?? []) {
    const retryable = r.status !== 'failed' || r.attempts < r.max_attempts
    if (r.status === 'failed' && r.attempts >= r.max_attempts) failed++
    if (retryable) {
      pending++
      if (now - new Date(r.created_at).getTime() > STUCK_AGE_MS) stuck++
    }
  }
  const { data: last } = await db
    .from(table)
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ updated_at: string }>()
  return {
    name,
    pending,
    failed,
    stuck,
    lastActivity: last?.updated_at ?? null,
  }
}

async function waitlistQueue(): Promise<QueueStat> {
  const db = serviceClient()
  const { count: waiting } = await db
    .from('waitlist_entries')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'waiting')
  const { data: last } = await db
    .from('waitlist_entries')
    .select('notified_at')
    .order('notified_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ notified_at: string | null }>()
  return {
    name: 'waitlist',
    pending: waiting ?? 0,
    failed: 0,
    stuck: 0,
    lastActivity: last?.notified_at ?? null,
  }
}

async function invoiceQueue(): Promise<QueueStat> {
  const db = serviceClient()
  // Settlements with a commission but no Faktero invoice yet.
  const { data: rows } = await db
    .from('settlements')
    .select('created_at, invoiced_at, fee_cents')
    .is('invoiced_at', null)
    .gt('fee_cents', 0)
    .returns<
      { created_at: string; invoiced_at: string | null; fee_cents: number }[]
    >()
  const now = Date.now()
  let stuck = 0
  for (const r of rows ?? []) {
    if (now - new Date(r.created_at).getTime() > STUCK_AGE_MS) stuck++
  }
  return {
    name: 'invoice',
    pending: (rows ?? []).length,
    failed: 0,
    stuck,
    lastActivity: null,
  }
}

async function count(table: string): Promise<number> {
  const { count: c } = await serviceClient()
    .from(table)
    .select('*', { count: 'exact', head: true })
  return c ?? 0
}

async function buildHealth(): Promise<SystemHealth> {
  const [
    database,
    storage,
    gopay,
    resend,
    faktero,
    refund,
    email,
    webhook,
    waitlist,
    invoice,
    organizers,
    events,
    orders,
  ] = await Promise.all([
    timed('database', checkDatabase),
    timed('storage', checkStorage),
    cached('gopay', checkGopay),
    cached('resend', checkResend),
    cached('faktero', checkFaktero),
    jobQueue('refund_jobs', 'refund', ['pending', 'processing', 'failed']),
    jobQueue('email_jobs', 'email', ['pending', 'sending', 'failed']),
    jobQueue('webhook_deliveries', 'webhook', ['pending', 'sending', 'failed']),
    waitlistQueue(),
    invoiceQueue(),
    count('organizers'),
    count('events'),
    count('orders'),
  ])

  return {
    services: [database, storage, gopay, resend, faktero],
    queues: [refund, email, invoice, waitlist, webhook],
    system: {
      version: process.env.APP_COMMIT || process.env.APP_VERSION || 'dev',
      uptimeSeconds: Math.round(process.uptime()),
      organizers,
      events,
      orders,
    },
    checkedAt: new Date().toISOString(),
  }
}

export const getSystemHealthFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SystemHealth | { error: string }> => {
    return runAdmin(async () => {
      await requirePlatformAdmin()
      return buildHealth()
    })
  },
)
