/**
 * Reduced commission for the non-profit sector.
 *
 * An organizer CLAIMS non-profit status (legal form + IČO); a platform admin
 * approves it. Only approval touches money: it copies the platform non-profit
 * rate onto organizers.fee_percent / fee_min_cents — the same columns the manual
 * admin fee edit writes — so the pricing path (src/server/order-service.ts) needs
 * no special case, and the discount can never be granted by the applicant alone.
 *
 * The fee is snapshotted per order, so approval applies to future orders only.
 *
 * Auth mirrors the dashboard: organizer member, owner/admin may apply (check-in
 * role and read-only impersonation may not). Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { serviceClient } from '../lib/supabase/server'
import { getCurrentUser } from '../lib/supabase/auth'
import { getImpersonation } from './impersonation-session'
import {
  AdminError,
  requirePlatformAdmin,
  runAdmin,
  writeAuditLog,
} from './admin'
import {
  LEGAL_FORM_VALUES,
  legalFormLabel,
  normalizeIco,
  isValidIco,
} from '../lib/nonprofit'
import type { LegalForm, NonprofitStatus } from '../lib/nonprofit'
import { canRequestFrom, canDecide, decisionPatch } from './nonprofit-rules'
import { getEmailProvider } from '../lib/email'
import { nonprofitStatusEmail } from '../lib/email/templates'
import { formatEur } from '../lib/money'
import { getEnv } from '../lib/env'

export class NonprofitError extends Error {}

export interface NonprofitState {
  status: NonprofitStatus
  legalForm: LegalForm | null
  legalFormLabel: string | null
  ico: string | null
  note: string | null
  requestedAt: string | null
  decidedAt: string | null
  /** Current commission of this organizer, so the UI can show the effect. */
  feePercent: number
  feeMinCents: number
  /** What approval would grant — read from platform settings. */
  offerPercent: number
  offerMinCents: number
  /** False for the check-in role and read-only impersonation. */
  canApply: boolean
}

interface Actor {
  userId: string
  organizerId: string
  role: 'owner' | 'admin' | 'checkin'
  impersonating: boolean
}

async function requireOrganizer(): Promise<Actor> {
  const user = await getCurrentUser()
  if (!user) throw new NonprofitError('Neprihlásený.')
  const imp = await getImpersonation(user)
  if (imp) {
    return {
      userId: user.id,
      organizerId: imp.organizerId,
      role: 'owner',
      impersonating: true,
    }
  }
  const { data } = await serviceClient()
    .from('organizer_members')
    .select('organizer_id, role')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle<{ organizer_id: string; role: Actor['role'] }>()
  if (!data) throw new NonprofitError('Nie ste členom žiadneho organizátora.')
  return {
    userId: user.id,
    organizerId: data.organizer_id,
    role: data.role,
    impersonating: false,
  }
}

function canApply(actor: Actor): boolean {
  return !actor.impersonating && actor.role !== 'checkin'
}

/**
 * Organizer notification address: contact_email, else an owner's auth email.
 * Twin of the helper in admin-payouts.ts — same fallback, same reason.
 */
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

async function run<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof NonprofitError) return { error: e.message }
    console.error('[nonprofit] unexpected error:', e)
    throw e
  }
}

/** The rate an approval grants right now. */
export async function nonprofitOffer(): Promise<{
  percent: number
  minCents: number
}> {
  const { data } = await serviceClient()
    .from('platform_settings')
    .select('nonprofit_fee_percent, nonprofit_fee_min_cents')
    .limit(1)
    .maybeSingle<{
      nonprofit_fee_percent: number | string
      nonprofit_fee_min_cents: number
    }>()
  // numeric arrives as a string over PostgREST — coerce, and fall back to the
  // column defaults if the settings row is somehow missing.
  return {
    percent: data ? Number(data.nonprofit_fee_percent) : 2,
    minCents: data ? Number(data.nonprofit_fee_min_cents) : 20,
  }
}

interface OrganizerNonprofitRow {
  nonprofit_status: NonprofitStatus
  legal_form: LegalForm | null
  ico: string | null
  nonprofit_note: string | null
  nonprofit_requested_at: string | null
  nonprofit_decided_at: string | null
  fee_percent: number | string
  fee_min_cents: number
}

const SELECT_COLS =
  'nonprofit_status, legal_form, ico, nonprofit_note, nonprofit_requested_at, nonprofit_decided_at, fee_percent, fee_min_cents'

export const getNonprofitStateFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<NonprofitState> => {
    const actor = await requireOrganizer()
    const [{ data }, offer] = await Promise.all([
      serviceClient()
        .from('organizers')
        .select(SELECT_COLS)
        .eq('id', actor.organizerId)
        .maybeSingle<OrganizerNonprofitRow>(),
      nonprofitOffer(),
    ])
    return {
      status: data?.nonprofit_status ?? 'none',
      legalForm: data?.legal_form ?? null,
      legalFormLabel: legalFormLabel(data?.legal_form ?? null),
      ico: data?.ico ?? null,
      note: data?.nonprofit_note ?? null,
      requestedAt: data?.nonprofit_requested_at ?? null,
      decidedAt: data?.nonprofit_decided_at ?? null,
      feePercent: Number(data?.fee_percent ?? 4),
      feeMinCents: Number(data?.fee_min_cents ?? 40),
      offerPercent: offer.percent,
      offerMinCents: offer.minCents,
      canApply: canApply(actor),
    }
  },
)

const icoSchema = z
  .string()
  .trim()
  .transform(normalizeIco)
  .refine(isValidIco, 'IČO musí mať 8 číslic.')

export const requestNonprofitRateFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        legalForm: z.enum(LEGAL_FORM_VALUES),
        ico: icoSchema,
        note: z.string().trim().max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ ok: true } | { error: string }> => {
    return run(async () => {
      const actor = await requireOrganizer()
      if (!canApply(actor)) {
        throw new NonprofitError('Na túto akciu nemáte oprávnenie.')
      }

      const { data: before } = await serviceClient()
        .from('organizers')
        .select('nonprofit_status')
        .eq('id', actor.organizerId)
        .maybeSingle<{ nonprofit_status: NonprofitStatus }>()

      const allowed = canRequestFrom(before?.nonprofit_status)
      if (!allowed.ok) throw new NonprofitError(allowed.error)

      const { error } = await serviceClient()
        .from('organizers')
        .update({
          legal_form: data.legalForm,
          ico: data.ico,
          nonprofit_status: 'pending',
          nonprofit_note: data.note ?? null,
          nonprofit_requested_at: new Date().toISOString(),
          nonprofit_decided_at: null,
          nonprofit_decided_by: null,
        })
        .eq('id', actor.organizerId)
      if (error) throw new NonprofitError('Žiadosť sa nepodarilo odoslať.')
      return { ok: true as const }
    })
  })

// ---------------------------------------------------------------------------
// Admin side
// ---------------------------------------------------------------------------

export interface NonprofitRequest {
  organizerId: string
  name: string
  slug: string
  legalForm: LegalForm | null
  legalFormLabel: string | null
  ico: string | null
  note: string | null
  requestedAt: string | null
  feePercent: number
  feeMinCents: number
}

export const listNonprofitRequestsFn = createServerFn({
  method: 'GET',
}).handler(async (): Promise<NonprofitRequest[] | { error: string }> => {
  return runAdmin(async () => {
    await requirePlatformAdmin()
    const { data } = await serviceClient()
      .from('organizers')
      .select(`id, name, slug, ${SELECT_COLS}`)
      .eq('nonprofit_status', 'pending')
      .order('nonprofit_requested_at', { ascending: true })
      .returns<
        (OrganizerNonprofitRow & { id: string; name: string; slug: string })[]
      >()
    return (data ?? []).map((o) => ({
      organizerId: o.id,
      name: o.name,
      slug: o.slug,
      legalForm: o.legal_form,
      legalFormLabel: legalFormLabel(o.legal_form),
      ico: o.ico,
      note: o.nonprofit_note,
      requestedAt: o.nonprofit_requested_at,
      feePercent: Number(o.fee_percent),
      feeMinCents: Number(o.fee_min_cents),
    }))
  })
})

export const decideNonprofitRequestFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        organizerId: z.string().uuid(),
        approve: z.boolean(),
        /** Shown to the applicant; expected when rejecting. */
        reason: z.string().trim().max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    return runAdmin(async () => {
      const admin = await requirePlatformAdmin()
      const db = serviceClient()

      const { data: before } = await db
        .from('organizers')
        .select(`name, ${SELECT_COLS}`)
        .eq('id', data.organizerId)
        .maybeSingle<OrganizerNonprofitRow & { name: string }>()
      // AdminError, not NonprofitError — runAdmin only turns the former into
      // { error } instead of a 500.
      if (!before) throw new AdminError('Organizátor sa nenašiel.')
      const open = canDecide(before.nonprofit_status)
      if (!open.ok) throw new AdminError(open.error)

      const offer = await nonprofitOffer()
      const patch = decisionPatch({
        approve: data.approve,
        adminId: admin.userId,
        decidedAt: new Date().toISOString(),
        offer,
        reason: data.reason,
      })

      const { error } = await db
        .from('organizers')
        .update(patch)
        .eq('id', data.organizerId)
      if (error) throw new AdminError('Rozhodnutie sa nepodarilo uložiť.')

      await writeAuditLog({
        actorId: admin.userId,
        action: data.approve
          ? 'organizer.nonprofit_approved'
          : 'organizer.nonprofit_rejected',
        entityType: 'organizer',
        entityId: data.organizerId,
        oldValue: {
          nonprofit_status: before.nonprofit_status,
          fee_percent: Number(before.fee_percent),
          fee_min_cents: before.fee_min_cents,
        },
        newValue: patch,
      })

      // Tell the applicant. Best-effort, exactly like the payout decision: the
      // decision is already committed and audited, so a mail failure must not
      // roll it back or surface as a failed approval.
      const to = await organizerEmail(data.organizerId)
      if (to) {
        const { subject, html } = nonprofitStatusEmail({
          approved: data.approve,
          organizerName: before.name,
          percentLabel: `${String(offer.percent).replace('.', ',')} %`,
          minLabel: formatEur(offer.minCents),
          legalFormLabel: legalFormLabel(before.legal_form),
          reason: data.reason ?? null,
          settingsUrl: `${getEnv().APP_URL}/app/settings`,
        })
        await getEmailProvider()
          .send({ to, subject, html })
          .then(
            () => undefined,
            () => undefined,
          )
      }

      return { ok: true } as const
    })
  })
