/**
 * Pure decision rules for the non-profit commission — no DB, no auth, no I/O.
 *
 * The risky part of this feature is not the queries but the state machine: who
 * may apply, when, and what exactly an approval writes to the money columns.
 * Keeping it here makes it testable the same way checkin-service.ts is.
 */

import type { NonprofitStatus } from '../lib/nonprofit'

export interface NonprofitOffer {
  percent: number
  minCents: number
}

/**
 * Whether a new application may be opened from this state.
 *
 * Re-applying after a rejection is allowed — the applicant fixes the data and
 * tries again. Applying while a request is open would reset its queue position,
 * and applying after approval is pointless.
 */
export function canRequestFrom(
  status: NonprofitStatus | undefined,
): { ok: true } | { ok: false; error: string } {
  if (status === 'pending') {
    return { ok: false, error: 'Žiadosť už čaká na posúdenie.' }
  }
  if (status === 'approved') {
    return { ok: false, error: 'Neziskovú sadzbu už máte schválenú.' }
  }
  return { ok: true }
}

export interface DecisionInput {
  approve: boolean
  adminId: string
  decidedAt: string
  offer: NonprofitOffer
  reason?: string
}

/**
 * The exact organizers-row patch a decision produces.
 *
 * Approval is the only path that touches fee_percent / fee_min_cents; a
 * rejection must leave the organizer's current commission untouched, so the
 * patch it returns carries no fee keys at all.
 */
export function decisionPatch(input: DecisionInput): Record<string, unknown> {
  const common = {
    nonprofit_decided_at: input.decidedAt,
    nonprofit_decided_by: input.adminId,
  }
  return input.approve
    ? {
        ...common,
        nonprofit_status: 'approved',
        fee_percent: input.offer.percent,
        fee_min_cents: input.offer.minCents,
      }
    : {
        ...common,
        nonprofit_status: 'rejected',
        nonprofit_note: input.reason ?? null,
      }
}

/** Only an open request can be decided. */
export function canDecide(
  status: NonprofitStatus | undefined,
): { ok: true } | { ok: false; error: string } {
  return status === 'pending'
    ? { ok: true }
    : { ok: false, error: 'Táto žiadosť už nie je otvorená.' }
}
