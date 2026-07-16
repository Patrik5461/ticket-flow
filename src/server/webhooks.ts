/**
 * Webhook enqueue + delivery worker. Enqueue fans one event out to every active
 * endpoint subscribed to that type; the worker drains the queue with HMAC-signed
 * POSTs, claiming each delivery atomically (conditional UPDATE on status+attempts)
 * and retrying failures up to max_attempts. Side effects (DB, fetch, signing,
 * clock) are injected for testing.
 *
 * Server-only.
 */

import type { WebhookEventType } from '../lib/webhooks'

export interface WebhookDb {
  from: (t: string) => any
}

/** Fan an event out to the organizer's subscribed, active endpoints. */
export async function enqueueWebhookEvent(
  db: WebhookDb,
  organizerId: string,
  eventType: WebhookEventType,
  payload: unknown,
): Promise<number> {
  const { data: endpoints } = await db
    .from('webhook_endpoints')
    .select('id, events')
    .eq('organizer_id', organizerId)
    .eq('active', true)
  const targets = (
    (endpoints as { id: string; events: string[] | null }[] | null) ?? []
  ).filter((e) => Array.isArray(e.events) && e.events.includes(eventType))
  if (targets.length === 0) return 0

  await db.from('webhook_deliveries').insert(
    targets.map((e) => ({
      endpoint_id: e.id,
      event_type: eventType,
      payload,
      status: 'pending',
    })),
  )
  return targets.length
}

export interface WebhookDeps {
  db: WebhookDb
  /** POST the signed body; resolves with the HTTP status (throws on network error). */
  post: (
    url: string,
    body: string,
    signature: string,
  ) => Promise<{ status: number }>
  sign: (secret: string, timestamp: string, body: string) => string
  now: () => string
  /** Unix seconds as a string (signature timestamp). */
  nowUnix: () => string
}

export interface WebhookResult {
  processed: number
  delivered: number
  failed: number
}

interface DeliveryRow {
  id: string
  endpoint_id: string
  event_type: string
  payload: unknown
  status: string
  attempts: number
  max_attempts: number
}

export async function processWebhooks(
  deps: WebhookDeps,
  opts: { limit?: number } = {},
): Promise<WebhookResult> {
  const limit = opts.limit ?? 50

  const { data: candidates } = await deps.db
    .from('webhook_deliveries')
    .select(
      'id, endpoint_id, event_type, payload, status, attempts, max_attempts',
    )
    .in('status', ['pending', 'failed'])
    .order('created_at', { ascending: true })
  const claimable = ((candidates as DeliveryRow[] | null) ?? [])
    .filter((d) => d.attempts < d.max_attempts)
    .slice(0, limit)

  const result: WebhookResult = { processed: 0, delivered: 0, failed: 0 }

  for (const d of claimable) {
    // Atomic claim: only one tick advances this delivery.
    const { data: claimed } = await deps.db
      .from('webhook_deliveries')
      .update({
        status: 'sending',
        attempts: d.attempts + 1,
        updated_at: deps.now(),
      })
      .eq('id', d.id)
      .eq('status', d.status)
      .eq('attempts', d.attempts)
      .select('id')
      .maybeSingle()
    if (!claimed) continue

    result.processed++

    // Look up the endpoint fresh (respects url/secret/active changes).
    const endpointRes = await deps.db
      .from('webhook_endpoints')
      .select('url, secret, active')
      .eq('id', d.endpoint_id)
      .maybeSingle()
    const endpoint = endpointRes.data as {
      url: string
      secret: string
      active: boolean
    } | null

    if (!endpoint || !endpoint.active) {
      // Endpoint gone/disabled — stop retrying.
      await deps.db
        .from('webhook_deliveries')
        .update({
          status: 'failed',
          attempts: d.max_attempts,
          last_error: 'endpoint neaktívny',
          updated_at: deps.now(),
        })
        .eq('id', d.id)
      result.failed++
      continue
    }

    const ts = deps.nowUnix()
    const body = JSON.stringify({
      id: d.id,
      type: d.event_type,
      created: ts,
      data: d.payload,
    })
    const signature = `t=${ts},v1=${deps.sign(endpoint.secret, ts, body)}`

    try {
      const res = await deps.post(endpoint.url, body, signature)
      const ok = res.status >= 200 && res.status < 300
      await deps.db
        .from('webhook_deliveries')
        .update({
          status: ok ? 'delivered' : 'failed',
          response_status: res.status,
          last_error: ok ? null : `HTTP ${res.status}`,
          delivered_at: ok ? deps.now() : null,
          updated_at: deps.now(),
        })
        .eq('id', d.id)
      if (ok) result.delivered++
      else result.failed++
    } catch (e) {
      await deps.db
        .from('webhook_deliveries')
        .update({
          status: 'failed',
          last_error: e instanceof Error ? e.message : 'network error',
          updated_at: deps.now(),
        })
        .eq('id', d.id)
      result.failed++
    }
  }

  return result
}
