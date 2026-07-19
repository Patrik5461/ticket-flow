/**
 * CMS content blocks (Phase 18). Public pages read a block by key via the cached
 * getContentFn; the platform admin lists and edits blocks. Body is Markdown,
 * rendered safely on the client (src/components/Markdown.tsx). Writes go through
 * the service role and are audited.
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { serviceClient } from '../lib/supabase/server'
import { requirePlatformAdmin, runAdmin, writeAuditLog } from './admin'

export interface ContentBlock {
  key: string
  title: string
  body: string
}

export interface ContentBlockMeta {
  key: string
  title: string
  updatedAt: string
  updatedBy: string | null
}

// Small in-process cache for public reads. Content changes rarely; a short TTL
// keeps public pages cheap without going stale for long. Invalidated on write.
const TTL_MS = 60_000
const cache = new Map<string, { at: number; value: ContentBlock | null }>()

const keySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(
    /^[a-z0-9-]+$/,
    'Kľúč smie obsahovať len malé písmená, číslice a pomlčky.',
  )

export const getContentFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => z.object({ key: keySchema }).parse(d))
  .handler(async ({ data }): Promise<ContentBlock | null> => {
    const hit = cache.get(data.key)
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value

    const { data: row } = await serviceClient()
      .from('content_blocks')
      .select('key, title, body')
      .eq('key', data.key)
      .maybeSingle<ContentBlock>()

    const value = row ?? null
    cache.set(data.key, { at: Date.now(), value })
    return value
  })

export const listContentFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ContentBlockMeta[] | { error: string }> => {
    return runAdmin(async () => {
      await requirePlatformAdmin()
      const { data: rows } = await serviceClient()
        .from('content_blocks')
        .select('key, title, updated_at, updated_by')
        .order('key', { ascending: true })
        .returns<
          {
            key: string
            title: string
            updated_at: string
            updated_by: string | null
          }[]
        >()
      return (rows ?? []).map((r) => ({
        key: r.key,
        title: r.title,
        updatedAt: r.updated_at,
        updatedBy: r.updated_by,
      }))
    })
  },
)

export const getContentAdminFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => z.object({ key: keySchema }).parse(d))
  .handler(async ({ data }): Promise<ContentBlock | { error: string }> => {
    return runAdmin(async () => {
      await requirePlatformAdmin()
      const { data: row } = await serviceClient()
        .from('content_blocks')
        .select('key, title, body')
        .eq('key', data.key)
        .maybeSingle<ContentBlock>()
      return row ?? { key: data.key, title: '', body: '' }
    })
  })

export const updateContentFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        key: keySchema,
        title: z.string().trim().min(1).max(200),
        body: z.string().max(100_000),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ ok: true } | { error: string }> => {
    return runAdmin(async () => {
      const actor = await requirePlatformAdmin()
      const db = serviceClient()
      const { error } = await db.from('content_blocks').upsert(
        {
          key: data.key,
          title: data.title,
          body: data.body,
          updated_at: new Date().toISOString(),
          updated_by: actor.userId,
        },
        { onConflict: 'key' },
      )
      if (error) return { error: 'Blok sa nepodarilo uložiť.' }

      await writeAuditLog({
        actorId: actor.userId,
        action: 'content.updated',
        entityType: 'content_block',
        entityId: data.key,
        newValue: { title: data.title },
      })

      cache.delete(data.key) // invalidate the public cache immediately
      return { ok: true as const }
    })
  })
