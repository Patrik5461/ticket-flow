/**
 * Email-queue worker: drain email_jobs, sending each idempotently with bounded
 * retries. Kind-specific rendering + sending is injected as `sendJob`, so the
 * queue mechanics are unit-testable. Claiming is optimistic (conditional UPDATE
 * on status+attempts), so concurrent ticks can't send the same job twice.
 *
 * Server-only.
 */

export interface EmailJobRow {
  id: string
  kind: string
  recipient: string
  event_id: string | null
  order_id: string | null
  ticket_id: string | null
  subject: string | null
  html: string | null
  status: string
  attempts: number
  max_attempts: number
}

export interface EmailJobsDeps {
  db: { from: (t: string) => any }
  /** Render + send one job; must throw on failure. */
  sendJob: (job: EmailJobRow) => Promise<void>
  now: () => string
}

export interface EmailProcessResult {
  processed: number
  sent: number
  failed: number
}

export async function processEmailJobs(
  deps: EmailJobsDeps,
  opts: { limit?: number } = {},
): Promise<EmailProcessResult> {
  const limit = opts.limit ?? 50

  const { data: candidates } = await deps.db
    .from('email_jobs')
    .select(
      'id, kind, recipient, event_id, order_id, ticket_id, subject, html, status, attempts, max_attempts',
    )
    .in('status', ['pending', 'failed'])
    .order('created_at', { ascending: true })
  const claimable = ((candidates as EmailJobRow[] | null) ?? [])
    .filter((j) => j.attempts < j.max_attempts)
    .slice(0, limit)

  const result: EmailProcessResult = { processed: 0, sent: 0, failed: 0 }

  for (const job of claimable) {
    const { data: claimed } = await deps.db
      .from('email_jobs')
      .update({
        status: 'sending',
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
      await deps.sendJob(job)
      await deps.db
        .from('email_jobs')
        .update({ status: 'sent', last_error: null, updated_at: deps.now() })
        .eq('id', job.id)
      result.sent++
    } catch (e) {
      await deps.db
        .from('email_jobs')
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
