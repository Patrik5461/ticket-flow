/**
 * Platform-admin payout request management. Every mutation is gated by
 * requirePlatformAdmin, writes an audit_log row, and emails the organizer. The
 * actual bank transfer is manual — this only records state.
 *
 * Exports ONLY server fns (+ types).
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { serviceClient } from '../lib/supabase/server'
import { requirePlatformAdmin, runAdmin, writeAuditLog } from './admin'
import { getEmailProvider } from '../lib/email'
import { payoutStatusEmail } from '../lib/email/templates'
import { formatEur } from '../lib/money'

export interface AdminPayoutRow {
  id: string
  organizerId: string
  organizerName: string
  amountCents: number
  status: 'requested' | 'approved' | 'paid' | 'rejected'
  note: string | null
  createdAt: string
  resolvedAt: string | null
}

export const listPayoutRequestsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AdminPayoutRow[] | { error: string }> => {
    return runAdmin(async () => {
      await requirePlatformAdmin()
      const db = serviceClient()
      const { data } = await db
        .from('payout_requests')
        .select(
          'id, organizer_id, amount_cents, status, note, created_at, resolved_at, organizers(name)',
        )
        .order('created_at', { ascending: false })
        .returns<
          {
            id: string
            organizer_id: string
            amount_cents: number
            status: AdminPayoutRow['status']
            note: string | null
            created_at: string
            resolved_at: string | null
            organizers: { name: string } | null
          }[]
        >()
      return (data ?? []).map((r) => ({
        id: r.id,
        organizerId: r.organizer_id,
        organizerName: r.organizers?.name ?? '—',
        amountCents: r.amount_cents,
        status: r.status,
        note: r.note,
        createdAt: r.created_at,
        resolvedAt: r.resolved_at,
      }))
    })
  },
)

/** Organizer notification address: contact_email, else an owner's auth email. */
async function organizerEmail(organizerId: string): Promise<string | null> {
  const db = serviceClient()
  const { data: org } = await db
    .from('organizers')
    .select('contact_email')
    .eq('id', organizerId)
    .maybeSingle<{ contact_email: string | null }>()
  if (org?.contact_email) return org.contact_email

  const { data: owner } = await db
    .from('organizer_members')
    .select('user_id')
    .eq('organizer_id', organizerId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle<{ user_id: string }>()
  if (!owner) return null
  const { data } = await db.auth.admin.getUserById(owner.user_id)
  return data.user?.email ?? null
}

const ACTIONS = {
  approve: { from: ['requested'], to: 'approved' as const },
  reject: { from: ['requested', 'approved'], to: 'rejected' as const },
  mark_paid: { from: ['approved'], to: 'paid' as const },
}

export const resolvePayoutFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        action: z.enum(['approve', 'reject', 'mark_paid']),
        note: z.string().trim().max(500).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    return runAdmin(async () => {
      const admin = await requirePlatformAdmin()
      const db = serviceClient()

      const { data: req } = await db
        .from('payout_requests')
        .select('id, organizer_id, amount_cents, status')
        .eq('id', data.id)
        .maybeSingle<{
          id: string
          organizer_id: string
          amount_cents: number
          status: string
        }>()
      if (!req) throw new Error('Žiadosť sa nenašla.')

      const rule = ACTIONS[data.action]
      if (!rule.from.includes(req.status)) {
        return {
          error: `Nepovolený prechod zo stavu „${req.status}".`,
        } as const
      }

      const { error } = await db
        .from('payout_requests')
        .update({
          status: rule.to,
          note: data.note || null,
          resolved_by: admin.userId,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', req.id)
        .eq('status', req.status)
      if (error) throw new Error('Aktualizácia zlyhala.')

      await writeAuditLog({
        actorId: admin.userId,
        action: `payout.${rule.to}`,
        entityType: 'payout_request',
        entityId: req.id,
        oldValue: { status: req.status },
        newValue: { status: rule.to, amount_cents: req.amount_cents },
      })

      // Notify the organizer (best-effort).
      const to = await organizerEmail(req.organizer_id)
      if (to) {
        const { subject, html } = payoutStatusEmail({
          status: rule.to,
          amountLabel: formatEur(req.amount_cents),
          note: data.note,
        })
        await getEmailProvider()
          .send({ to, subject, html })
          .then(
            () => undefined,
            () => undefined,
          )
      }

      return { ok: true as const }
    })
  })
