/**
 * Issue platform-commission invoices for settlements that don't have one yet.
 * Side effects (DB, invoice provider) are injected via `deps` for unit testing;
 * realInvoicingDeps() wires the live provider. Deliberately free of admin.ts /
 * getCurrentUser so the /api/cron/issue-invoices route can import it.
 *
 * Server-only.
 */

import { serviceClient } from '../lib/supabase/server'
import { getInvoiceProvider, isInvoicingConfigured } from '../lib/faktero'
import type { InvoiceRequest, InvoiceResult } from '../lib/faktero'

export interface InvoicingDeps {
  db: { from: (t: string) => any }
  createInvoice: (req: InvoiceRequest) => Promise<InvoiceResult>
  /** Format a 'YYYY-MM-01' period into a human label, e.g. "jún 2026". */
  periodLabel: (periodMonth: string) => string
  now: () => string
  /** False when the provider env vars are missing; defaults to configured. */
  configured?: () => boolean
  /**
   * Look up an invoice the provider may already hold for this settlement.
   * Absent when the provider cannot answer — a previous failure is then left
   * alone instead of risking a duplicate.
   */
  findInvoice?: (externalId: string) => Promise<InvoiceResult | null>
  /** Mail a finished invoice. Absent when the provider cannot send. */
  sendInvoice?: (invoiceId: string, recipientEmail: string) => Promise<void>
}

export interface InvoicingResult {
  processed: number
  created: number
  failed: number
  /** Failures already on the provider's side, adopted instead of re-issued. */
  adopted: number
  /** Invoices mailed to the organizer in this run. */
  sent: number
}

interface SettlementToInvoice {
  id: string
  organizer_id: string
  period_month: string
  fee_cents: number
  invoice_attempts: number
}

interface PendingSend {
  id: string
  organizer_id: string
  invoice_ref: string | null
  invoice_attempts: number
}

/**
 * Give up after this many tries, so a permanent error stops calling out.
 * Mirrored in trigger_invoice_issuing() (migration 20260805170000), which has to
 * count the same rows this worker will pick up or it never wakes it.
 */
export const MAX_INVOICE_ATTEMPTS = 5

/** Provider errors carry the API's own message; keep it, bounded. */
function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500)
}

/**
 * Invoice up to `limit` settlements whose commission hasn't been invoiced yet
 * (invoice_status 'none' or 'failed', fee > 0, under the attempt ceiling).
 * Optionally scoped to one period ('YYYY-MM').
 *
 * A retry asks the provider first whether it already holds an invoice for this
 * settlement: a failure can happen after the invoice was created (the response
 * never arrived, the process died before the DB write), and re-issuing it would
 * bill the organizer twice for the same month. If it is there, it is adopted;
 * only a confirmed absence leads to a new invoice.
 */
export async function issueSettlementInvoices(
  deps: InvoicingDeps,
  opts: { limit?: number; periodMonth?: string } = {},
): Promise<InvoicingResult> {
  const limit = opts.limit ?? 50

  // Without a configured provider there is nothing to issue an invoice with.
  // Leave the settlements untouched: marking them 'created' would record an
  // invoice number nobody can produce, and burning an attempt on a call that
  // was never made would spend the retry budget on our own misconfiguration.
  if (deps.configured && !deps.configured()) {
    return { processed: 0, created: 0, failed: 0, adopted: 0, sent: 0 }
  }

  let query = deps.db
    .from('settlements')
    .select('id, organizer_id, period_month, fee_cents, invoice_attempts')
    .in('invoice_status', ['none', 'failed'])
    .lt('invoice_attempts', MAX_INVOICE_ATTEMPTS)
    .gt('fee_cents', 0)
  if (opts.periodMonth) {
    query = query.eq('period_month', `${opts.periodMonth}-01`)
  }
  const { data } = await query.limit(limit)
  const settlements = (data as SettlementToInvoice[] | null) ?? []

  const result: InvoicingResult = {
    processed: 0,
    created: 0,
    failed: 0,
    adopted: 0,
    sent: 0,
  }

  for (const s of settlements) {
    result.processed++
    const retry = s.invoice_attempts > 0

    // A retry only happens when the provider can be asked what it already has.
    // Without that answer, a second invoice is the likelier harm of the two.
    if (retry && !deps.findInvoice) continue

    if (retry) {
      try {
        const existing = await deps.findInvoice!(s.id)
        if (existing) {
          await deps.db
            .from('settlements')
            .update({
              invoice_status: 'created',
              invoice_ref: existing.id,
              invoice_number: existing.number ?? null,
              // An adopted invoice may already have gone out; only an unsent
              // one is left for the mailing pass to pick up.
              invoice_sent_at: existing.sentAt ?? null,
              invoiced_at: deps.now(),
              invoice_error: null,
            })
            .eq('id', s.id)
          result.adopted++
          continue
        }
      } catch (e) {
        // Could not find out — leave it for the next run rather than guess.
        await deps.db
          .from('settlements')
          .update({
            invoice_attempts: s.invoice_attempts + 1,
            invoice_error: errorText(e),
          })
          .eq('id', s.id)
        result.failed++
        continue
      }
    }

    const { data: org } = await deps.db
      .from('organizers')
      .select('name, ico, dic, ic_dph, email, address, faktero_customer_id')
      .eq('id', s.organizer_id)
      .maybeSingle()
    const o = org as {
      name: string
      ico: string | null
      dic: string | null
      ic_dph: string | null
      email: string | null
      address: string | null
      faktero_customer_id: string | null
    } | null

    const label = deps.periodLabel(s.period_month)
    try {
      const res = await deps.createInvoice({
        customer: {
          name: o?.name ?? '—',
          ico: o?.ico ?? null,
          dic: o?.dic ?? null,
          icDph: o?.ic_dph ?? null,
          email: o?.email ?? null,
          address: o?.address ?? null,
          externalId: s.organizer_id,
          providerId: o?.faktero_customer_id ?? null,
        },
        periodLabel: label,
        amountCents: s.fee_cents,
        description: `Provízia platformy Ticketio — ${label}`,
        externalId: s.id,
      })
      // Remember the provider-side customer, so the next period does not create
      // a second copy of the same organizer.
      if (res.customerId && res.customerId !== o?.faktero_customer_id) {
        await deps.db
          .from('organizers')
          .update({ faktero_customer_id: res.customerId })
          .eq('id', s.organizer_id)
      }
      await deps.db
        .from('settlements')
        .update({
          invoice_status: 'created',
          invoice_ref: res.id,
          invoice_number: res.number ?? null,
          invoiced_at: deps.now(),
          invoice_attempts: s.invoice_attempts + 1,
          invoice_error: null,
        })
        .eq('id', s.id)
      result.created++
    } catch (e) {
      await deps.db
        .from('settlements')
        .update({
          invoice_status: 'failed',
          invoiced_at: deps.now(),
          invoice_attempts: s.invoice_attempts + 1,
          invoice_error: errorText(e),
        })
        .eq('id', s.id)
      result.failed++
    }
  }

  await mailIssuedInvoices(deps, result, limit)
  return result
}

/**
 * Second pass: mail the invoices that exist but have not gone out yet —
 * including the ones just created above.
 *
 * Sending is separate from issuing on purpose. A failed send must not push the
 * settlement back into the issuing queue, because re-issuing would bill the
 * organizer a second time; it only has to be tried again. Rows stay eligible
 * until invoice_sent_at is set, so a send that fails is retried on the next run
 * rather than being lost the way a 'failed' invoice used to be.
 */
async function mailIssuedInvoices(
  deps: InvoicingDeps,
  result: InvoicingResult,
  limit: number,
): Promise<void> {
  if (!deps.sendInvoice) return

  const { data } = await deps.db
    .from('settlements')
    .select('id, organizer_id, invoice_ref, invoice_attempts')
    .eq('invoice_status', 'created')
    .is('invoice_sent_at', null)
    .lt('invoice_attempts', MAX_INVOICE_ATTEMPTS)
    .limit(limit)
  const pending = (data as PendingSend[] | null) ?? []

  for (const s of pending) {
    if (!s.invoice_ref) continue

    const { data: org } = await deps.db
      .from('organizers')
      .select('email')
      .eq('id', s.organizer_id)
      .maybeSingle()
    const email = (org as { email: string | null } | null)?.email
    if (!email) {
      // Nowhere to send it. Say so on the row instead of retrying forever.
      await deps.db
        .from('settlements')
        .update({
          invoice_attempts: MAX_INVOICE_ATTEMPTS,
          invoice_error: 'Organizátor nemá e-mail, faktúru nebolo kam poslať.',
        })
        .eq('id', s.id)
      continue
    }

    try {
      await deps.sendInvoice(s.invoice_ref, email)
      await deps.db
        .from('settlements')
        .update({ invoice_sent_at: deps.now(), invoice_error: null })
        .eq('id', s.id)
      result.sent++
    } catch (e) {
      await deps.db
        .from('settlements')
        .update({
          invoice_attempts: s.invoice_attempts + 1,
          invoice_error: errorText(e),
        })
        .eq('id', s.id)
    }
  }
}

/** Live dependencies: the configured invoice provider + service DB client. */
export function realInvoicingDeps(): InvoicingDeps {
  const provider = getInvoiceProvider()
  const monthFmt = new Intl.DateTimeFormat('sk-SK', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Bratislava',
  })
  return {
    db: serviceClient(),
    createInvoice: (req) => provider.createInvoice(req),
    periodLabel: (pm) => monthFmt.format(new Date(pm)),
    now: () => new Date().toISOString(),
    configured: isInvoicingConfigured,
    ...(provider.findByExternalId
      ? { findInvoice: (id: string) => provider.findByExternalId!(id) }
      : {}),
    ...(provider.sendInvoice
      ? {
          sendInvoice: (id: string, email: string) =>
            provider.sendInvoice!(id, email),
        }
      : {}),
  }
}
