/**
 * Issue platform-commission invoices for settlements that don't have one yet.
 * Side effects (DB, invoice provider) are injected via `deps` for unit testing;
 * realInvoicingDeps() wires the live provider. Deliberately free of admin.ts /
 * getCurrentUser so the /api/cron/issue-invoices route can import it.
 *
 * Server-only.
 */

import { serviceClient } from '../lib/supabase/server'
import { getInvoiceProvider } from '../lib/faktero'
import type { InvoiceRequest, InvoiceResult } from '../lib/faktero'

export interface InvoicingDeps {
  db: { from: (t: string) => any }
  createInvoice: (req: InvoiceRequest) => Promise<InvoiceResult>
  /** Format a 'YYYY-MM-01' period into a human label, e.g. "jún 2026". */
  periodLabel: (periodMonth: string) => string
  now: () => string
}

export interface InvoicingResult {
  processed: number
  created: number
  failed: number
}

interface SettlementToInvoice {
  id: string
  organizer_id: string
  period_month: string
  fee_cents: number
}

/**
 * Invoice up to `limit` settlements whose commission hasn't been invoiced yet
 * (invoice_status = 'none', fee > 0). Optionally scoped to one period ('YYYY-MM').
 * externalId = settlement id lets the provider dedupe on retry.
 */
export async function issueSettlementInvoices(
  deps: InvoicingDeps,
  opts: { limit?: number; periodMonth?: string } = {},
): Promise<InvoicingResult> {
  const limit = opts.limit ?? 50

  let query = deps.db
    .from('settlements')
    .select('id, organizer_id, period_month, fee_cents')
    .eq('invoice_status', 'none')
    .gt('fee_cents', 0)
  if (opts.periodMonth) {
    query = query.eq('period_month', `${opts.periodMonth}-01`)
  }
  const { data } = await query.limit(limit)
  const settlements = (data as SettlementToInvoice[] | null) ?? []

  const result: InvoicingResult = { processed: 0, created: 0, failed: 0 }

  for (const s of settlements) {
    result.processed++

    const { data: org } = await deps.db
      .from('organizers')
      .select('name, ico, dic, ic_dph, email')
      .eq('id', s.organizer_id)
      .maybeSingle()
    const o = org as {
      name: string
      ico: string | null
      dic: string | null
      ic_dph: string | null
      email: string | null
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
          address: null,
        },
        periodLabel: label,
        amountCents: s.fee_cents,
        description: `Provízia platformy Ticketio — ${label}`,
        externalId: s.id,
      })
      await deps.db
        .from('settlements')
        .update({
          invoice_status: 'created',
          invoice_ref: res.id,
          invoiced_at: deps.now(),
        })
        .eq('id', s.id)
      result.created++
    } catch {
      await deps.db
        .from('settlements')
        .update({ invoice_status: 'failed', invoiced_at: deps.now() })
        .eq('id', s.id)
      result.failed++
    }
  }

  return result
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
  }
}
