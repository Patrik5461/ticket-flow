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
import { requirePlatformAdmin, runAdmin, AdminError } from './admin'
import { listSettlements } from './settlement-service'
import type { SettlementRow } from './settlement-service'
import {
  issueSettlementInvoices,
  realInvoicingDeps,
} from './settlement-invoicing'

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
