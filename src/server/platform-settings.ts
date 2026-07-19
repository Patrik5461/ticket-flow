/**
 * Platform-wide default commission (Phase 18 Block 4). One source of truth for
 * the fee shown on /cennik and inherited by new organizers (via the DB trigger
 * in the migration). getPlatformSettingsFn is public + cached; the admin edits
 * it through updatePlatformSettingsFn (audited).
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { serviceClient } from '../lib/supabase/server'
import { requirePlatformAdmin, runAdmin, writeAuditLog } from './admin'

export interface PlatformSettings {
  defaultFeePercent: number
  defaultFeeMinCents: number
}

const FALLBACK: PlatformSettings = {
  defaultFeePercent: 4,
  defaultFeeMinCents: 40,
}

// Short cache; the fee changes very rarely. Invalidated on write.
const TTL_MS = 60_000
let cached: { at: number; value: PlatformSettings } | null = null

async function readSettings(): Promise<PlatformSettings> {
  const { data } = await serviceClient()
    .from('platform_settings')
    .select('default_fee_percent, default_fee_min_cents')
    .limit(1)
    .maybeSingle<{
      default_fee_percent: number | string
      default_fee_min_cents: number
    }>()
  if (!data) return FALLBACK
  return {
    // numeric comes back as string over PostgREST — coerce.
    defaultFeePercent: Number(data.default_fee_percent),
    defaultFeeMinCents: Number(data.default_fee_min_cents),
  }
}

export const getPlatformSettingsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PlatformSettings> => {
    if (cached && Date.now() - cached.at < TTL_MS) return cached.value
    const value = await readSettings()
    cached = { at: Date.now(), value }
    return value
  },
)

export const updatePlatformSettingsFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        defaultFeePercent: z.number().min(0).max(100),
        defaultFeeMinCents: z.number().int().min(0).max(100_000),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ ok: true } | { error: string }> => {
    return runAdmin(async () => {
      const actor = await requirePlatformAdmin()
      const { error } = await serviceClient()
        .from('platform_settings')
        .update({
          default_fee_percent: data.defaultFeePercent,
          default_fee_min_cents: data.defaultFeeMinCents,
          updated_at: new Date().toISOString(),
          updated_by: actor.userId,
        })
        .eq('id', true)
      if (error) return { error: 'Nastavenie sa nepodarilo uložiť.' }

      await writeAuditLog({
        actorId: actor.userId,
        action: 'platform_settings.updated',
        entityType: 'platform_settings',
        newValue: data,
      })

      cached = null // invalidate public cache
      return { ok: true as const }
    })
  })
