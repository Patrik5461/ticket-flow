/**
 * Refund-queue worker: enqueue one job per paid order of a cancelled event, and
 * drain the queue idempotently with bounded retries. Side effects (DB, the actual
 * order refund) are injected via `deps` so the flow is unit-testable.
 *
 * Claiming is optimistic: a conditional UPDATE (guarded on the job's current
 * status + attempts) means two concurrent ticks can't process the same job twice.
 *
 * Server-only.
 */

export interface RefundJobsDeps {
  db: { from: (t: string) => any }
  /** Refund a whole order; must throw on failure. Idempotent for the caller. */
  refundOrder: (orderId: string) => Promise<void>
  now: () => string
}

interface JobRow {
  id: string
  order_id: string
  status: string
  attempts: number
  max_attempts: number
}

/**
 * Enqueue a refund job for every still-refundable order of an event. Idempotent:
 * the unique(order_id) constraint makes a repeat enqueue a no-op. Returns how
 * many refundable orders the event has.
 */
export async function enqueueEventRefundJobs(
  deps: RefundJobsDeps,
  eventId: string,
): Promise<number> {
  const { data: orders } = await deps.db
    .from('orders')
    .select('id')
    .eq('event_id', eventId)
    .in('status', ['paid', 'partially_refunded'])
  const rows = (orders as { id: string }[] | null) ?? []
  if (rows.length === 0) return 0

  await deps.db.from('refund_jobs').upsert(
    rows.map((o) => ({ event_id: eventId, order_id: o.id })),
    { onConflict: 'order_id', ignoreDuplicates: true },
  )
  return rows.length
}

export interface ProcessResult {
  processed: number
  done: number
  failed: number
}

/**
 * Drain up to `limit` claimable jobs (pending, or failed-under-retry-limit).
 * Each job is claimed atomically, then its order refund is attempted; success →
 * 'done', throw → 'failed' (retried on a later tick until max_attempts).
 */
export async function processRefundJobs(
  deps: RefundJobsDeps,
  opts: { limit?: number } = {},
): Promise<ProcessResult> {
  const limit = opts.limit ?? 25

  const { data: candidates } = await deps.db
    .from('refund_jobs')
    .select('id, order_id, status, attempts, max_attempts')
    .in('status', ['pending', 'failed'])
    .order('created_at', { ascending: true })
  const claimable = ((candidates as JobRow[] | null) ?? [])
    .filter((j) => j.attempts < j.max_attempts)
    .slice(0, limit)

  const result: ProcessResult = { processed: 0, done: 0, failed: 0 }

  for (const job of claimable) {
    // Atomically claim: only succeeds if the job is still in the state we read.
    const { data: claimed } = await deps.db
      .from('refund_jobs')
      .update({
        status: 'processing',
        attempts: job.attempts + 1,
        updated_at: deps.now(),
      })
      .eq('id', job.id)
      .eq('status', job.status)
      .eq('attempts', job.attempts)
      .select('id')
      .maybeSingle()
    if (!claimed) continue // lost the race to another tick

    result.processed++
    try {
      await deps.refundOrder(job.order_id)
      await deps.db
        .from('refund_jobs')
        .update({ status: 'done', last_error: null, updated_at: deps.now() })
        .eq('id', job.id)
      result.done++
    } catch (e) {
      await deps.db
        .from('refund_jobs')
        .update({
          status: 'failed',
          last_error: e instanceof Error ? e.message : 'neznáma chyba',
          updated_at: deps.now(),
        })
        .eq('id', job.id)
      result.failed++
    }
  }

  return result
}
