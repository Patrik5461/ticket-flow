/**
 * AI support usage metering (Phase 17 Block 4). The support assistant records
 * how many Anthropic API calls / tool executions / FAQ fallbacks happen each
 * UTC day, and enforces a configurable daily cap (env SUPPORT_DAILY_LIMIT).
 * Writes go through the atomic bump_support_usage SQL function so concurrent
 * chats can't lose counts. The admin fn is requirePlatformAdmin-guarded.
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { serviceClient } from '../lib/supabase/server'
import { getEnv } from '../lib/env'
import { requirePlatformAdmin, runAdmin } from './admin'

/** Configured daily cap on Anthropic API calls (0 = unlimited). */
export function supportDailyLimit(): number {
  return getEnv().SUPPORT_DAILY_LIMIT
}

/** API calls already made today (UTC). 0 if the table has no row yet. */
export async function getTodaySupportCalls(): Promise<number> {
  const { data } = await serviceClient()
    .from('support_usage')
    .select('api_calls')
    .eq('day', new Date().toISOString().slice(0, 10))
    .maybeSingle<{ api_calls: number }>()
  return data?.api_calls ?? 0
}

/** Atomically add to today's counters. Best-effort — never throws. */
export async function bumpSupportUsage(
  apiCalls: number,
  toolCalls: number,
  fallbackHits: number,
): Promise<void> {
  if (apiCalls === 0 && toolCalls === 0 && fallbackHits === 0) return
  try {
    await serviceClient().rpc('bump_support_usage', {
      p_api: apiCalls,
      p_tool: toolCalls,
      p_fallback: fallbackHits,
    })
  } catch {
    // Metering must never break the chat.
  }
}

export interface SupportUsageDay {
  day: string
  apiCalls: number
  toolCalls: number
  fallbackHits: number
}

export interface SupportUsage {
  limit: number
  today: SupportUsageDay
  days: SupportUsageDay[]
}

export const getSupportUsageFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SupportUsage | { error: string }> => {
    return runAdmin(async () => {
      await requirePlatformAdmin()
      const today = new Date().toISOString().slice(0, 10)
      const { data } = await serviceClient()
        .from('support_usage')
        .select('day, api_calls, tool_calls, fallback_hits')
        .order('day', { ascending: false })
        .limit(14)
        .returns<
          {
            day: string
            api_calls: number
            tool_calls: number
            fallback_hits: number
          }[]
        >()
      const days: SupportUsageDay[] = (data ?? []).map((r) => ({
        day: r.day,
        apiCalls: r.api_calls,
        toolCalls: r.tool_calls,
        fallbackHits: r.fallback_hits,
      }))
      const todayRow: SupportUsageDay = days.find((d) => d.day === today) ?? {
        day: today,
        apiCalls: 0,
        toolCalls: 0,
        fallbackHits: 0,
      }
      return { limit: supportDailyLimit(), today: todayRow, days }
    })
  },
)
