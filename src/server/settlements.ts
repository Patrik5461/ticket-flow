/**
 * Settlement server fns: the organizer's own list, and a platform-admin trigger
 * to (re)generate a month on demand (the pg_cron job does this monthly). Exports
 * only server fns (+ re-typed row), so handler imports are stripped from the
 * client bundle.
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getCurrentUser } from '../lib/supabase/auth'
import { serviceClient } from '../lib/supabase/server'
import {
  requirePlatformAdmin,
  runAdmin,
  writeAuditLog,
  AdminError,
} from './admin'
import { isImpersonating } from './impersonation-session'
import { listSettlements } from './settlement-service'
import type { SettlementRow } from './settlement-service'
import {
  issueSettlementInvoices,
  realInvoicingDeps,
} from './settlement-invoicing'
import { validateSettlementRange, nextDay } from '../lib/settlement-range'
import type { SettlementRangeInput } from '../lib/settlement-range'
import { zonedLocalToUtcIso } from '../lib/datetime'

const TZ = 'Europe/Bratislava'

export interface GenerateSettlementResult {
  ok: true
  settlementId: string | null
}

/** Resolve the from/to timestamptz bounds for a generation request. */
function rangeBounds(input: SettlementRangeInput): {
  from: string
  to: string
} {
  if (input.from && input.to) {
    return {
      from: zonedLocalToUtcIso(`${input.from}T00:00`, TZ),
      to: zonedLocalToUtcIso(`${nextDay(input.to)}T00:00`, TZ),
    }
  }
  // Whole event: unbounded window (the claim filters by event anyway).
  return { from: '2000-01-01T00:00:00Z', to: '2999-01-01T00:00:00Z' }
}

const rangeSchema = z.object({
  from: z.string().optional().nullable(),
  to: z.string().optional().nullable(),
  eventId: z.string().uuid().optional().nullable(),
})

export type { SettlementRow } from './settlement-service'

export const listMySettlementsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SettlementRow[]> => {
    const user = await getCurrentUser()
    if (!user) return []
    const { data } = await serviceClient()
      .from('organizer_members')
      .select('organizer_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle<{ organizer_id: string }>()
    if (!data) return []
    return listSettlements(data.organizer_id)
  },
)

/** Organizer generates a settlement over a period or for one of their events. */
export const generateMySettlementFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => rangeSchema.parse(d))
  .handler(
    async ({ data }): Promise<GenerateSettlementResult | { error: string }> => {
      const user = await getCurrentUser()
      if (!user) return { error: 'Neprihlásený.' }
      if (await isImpersonating(user)) {
        return {
          error:
            'Režim čítania (prezeranie ako organizátor) — zmeny nie sú povolené.',
        }
      }
      const { data: mem } = await serviceClient()
        .from('organizer_members')
        .select('organizer_id, role')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle<{ organizer_id: string; role: string }>()
      if (!mem) return { error: 'Nie ste členom žiadneho organizátora.' }
      if (mem.role === 'checkin') return { error: 'Nemáte oprávnenie.' }

      const validationError = validateSettlementRange(data)
      if (validationError) return { error: validationError }

      return generateSettlement(
        mem.organizer_id,
        data,
        user.id,
        'settlement.manual_generated',
      )
    },
  )

/** Platform admin generates a settlement for any organizer. */
export const adminGenerateSettlementFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    rangeSchema.extend({ organizerId: z.string().uuid() }).parse(d),
  )
  .handler(
    async ({ data }): Promise<GenerateSettlementResult | { error: string }> => {
      return runAdmin(async () => {
        const admin = await requirePlatformAdmin()
        const validationError = validateSettlementRange(data)
        if (validationError) return { error: validationError }
        return generateSettlement(
          data.organizerId,
          data,
          admin.userId,
          'settlement.admin_generated',
        )
      })
    },
  )

/** Shared: verify optional event ownership, call the claim RPC, audit. */
async function generateSettlement(
  organizerId: string,
  input: SettlementRangeInput,
  actorId: string,
  auditAction: string,
): Promise<GenerateSettlementResult | { error: string }> {
  const db = serviceClient()

  if (input.eventId) {
    const { data: ev } = await db
      .from('events')
      .select('id')
      .eq('id', input.eventId)
      .eq('organizer_id', organizerId)
      .maybeSingle<{ id: string }>()
    if (!ev) return { error: 'Podujatie nepatrí tomuto organizátorovi.' }
  }

  const bounds = rangeBounds(input)
  const { data: settlementId, error } = await db.rpc(
    'generate_settlement_range',
    {
      p_organizer: organizerId,
      p_from: bounds.from,
      p_to: bounds.to,
      p_kind: input.eventId ? 'event' : 'manual',
      p_event_id: input.eventId ?? null,
      p_created_by: actorId,
    },
  )
  if (error) return { error: 'Generovanie vyúčtovania zlyhalo.' }

  await writeAuditLog({
    actorId,
    action: auditAction,
    entityType: 'settlement',
    entityId: (settlementId as string | null) ?? null,
    newValue: {
      organizer_id: organizerId,
      from: input.from ?? null,
      to: input.to ?? null,
      event_id: input.eventId ?? null,
    },
  })

  return {
    ok: true as const,
    settlementId: (settlementId as string | null) ?? null,
  }
}

export const generateSettlementsNowFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z.object({ periodMonth: z.string().regex(/^\d{4}-\d{2}$/) }).parse(d),
  )
  .handler(
    async ({
      data,
    }): Promise<{ ok: true; count: number } | { error: string }> => {
      return runAdmin(async () => {
        await requirePlatformAdmin()
        const { data: count, error } = await serviceClient().rpc(
          'generate_settlements',
          { p_period_month: `${data.periodMonth}-01` },
        )
        if (error) throw new AdminError('Generovanie vyúčtovaní zlyhalo.')
        // Issue commission invoices for the freshly generated month.
        await issueSettlementInvoices(realInvoicingDeps(), {
          periodMonth: data.periodMonth,
        })
        return { ok: true as const, count: (count as number | null) ?? 0 }
      })
    },
  )
