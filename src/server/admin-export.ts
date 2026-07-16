/**
 * Platform data exports (orders, organizers) as Excel-friendly CSV for
 * accounting. Plain server helpers (serviceClient + csv) — no protected imports,
 * so the /api/admin/export/* route handlers can use them.
 *
 * Server-only.
 */

import { serviceClient } from '../lib/supabase/server'
import { toCsv } from '../lib/csv'

export interface DateRange {
  from?: string | null // YYYY-MM-DD (inclusive)
  to?: string | null // YYYY-MM-DD (inclusive)
}

/** Cents → "12,34" (SK decimal comma, no currency symbol) for spreadsheets. */
function eur(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}

function applyRange<T>(q: T, range: DateRange, col = 'created_at'): T {
  let out = q as any
  if (range.from) out = out.gte(col, range.from)
  if (range.to) out = out.lte(col, `${range.to}T23:59:59.999Z`)
  return out as T
}

export async function buildOrdersCsv(
  range: DateRange,
): Promise<{ csv: string; count: number }> {
  const { data } = await applyRange(
    serviceClient()
      .from('orders')
      .select(
        'id, created_at, paid_at, status, buyer_email, buyer_name, total_cents, fee_cents, gopay_payment_id, events(title, organizers(name))',
      ),
    range,
  )
    .order('created_at', { ascending: true })
    .returns<
      {
        id: string
        created_at: string
        paid_at: string | null
        status: string
        buyer_email: string
        buyer_name: string | null
        total_cents: number
        fee_cents: number
        gopay_payment_id: string | null
        events: { title: string; organizers: { name: string } | null } | null
      }[]
    >()

  const header = [
    'Číslo',
    'Vytvorená',
    'Zaplatená',
    'Stav',
    'E-mail',
    'Meno',
    'Suma',
    'Provízia',
    'GoPay ID',
    'Podujatie',
    'Organizátor',
  ]
  const rows = (data ?? []).map((o) => [
    o.id.slice(0, 8).toUpperCase(),
    o.created_at,
    o.paid_at ?? '',
    o.status,
    o.buyer_email,
    o.buyer_name ?? '',
    eur(o.total_cents),
    eur(o.fee_cents),
    o.gopay_payment_id ?? '',
    o.events?.title ?? '',
    o.events?.organizers?.name ?? '',
  ])
  return { csv: toCsv(header, rows), count: rows.length }
}

export async function buildOrganizersCsv(
  range: DateRange,
): Promise<{ csv: string; count: number }> {
  const { data } = await applyRange(
    serviceClient()
      .from('organizers')
      .select(
        'name, slug, status, ico, dic, ic_dph, iban, contact_email, phone, address, fee_percent, fee_min_cents, created_at',
      ),
    range,
  )
    .order('created_at', { ascending: true })
    .returns<
      {
        name: string
        slug: string
        status: string
        ico: string | null
        dic: string | null
        ic_dph: string | null
        iban: string | null
        contact_email: string | null
        phone: string | null
        address: string | null
        fee_percent: number
        fee_min_cents: number
        created_at: string
      }[]
    >()

  const header = [
    'Názov',
    'Slug',
    'Stav',
    'IČO',
    'DIČ',
    'IČ DPH',
    'IBAN',
    'E-mail',
    'Telefón',
    'Adresa',
    'Provízia %',
    'Min. provízia',
    'Registrovaný',
  ]
  const rows = (data ?? []).map((o) => [
    o.name,
    o.slug,
    o.status,
    o.ico ?? '',
    o.dic ?? '',
    o.ic_dph ?? '',
    o.iban ?? '',
    o.contact_email ?? '',
    o.phone ?? '',
    o.address ?? '',
    String(o.fee_percent),
    eur(o.fee_min_cents),
    o.created_at,
  ])
  return { csv: toCsv(header, rows), count: rows.length }
}

/** Record an export in the audit log (best-effort; never blocks the download). */
export async function auditExport(
  userId: string,
  kind: string,
  meta: Record<string, unknown>,
): Promise<void> {
  await serviceClient()
    .from('audit_log')
    .insert({
      actor_id: userId,
      action: `admin.export_${kind}`,
      entity_type: 'platform',
      entity_id: null,
      new_value: meta,
    })
    .then(
      () => undefined,
      () => undefined,
    )
}
