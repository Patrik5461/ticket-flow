/**
 * Platform-admin management: list / add (by email) / remove platform admins.
 * requirePlatformAdmin, audited. Safeguard: the last admin cannot be removed, so
 * the platform never ends up with zero admins.
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { serviceClient } from '../lib/supabase/server'
import {
  requirePlatformAdmin,
  runAdmin,
  writeAuditLog,
  AdminError,
} from './admin'

export interface PlatformAdminView {
  userId: string
  email: string
  note: string | null
  createdAt: string
}

export const listPlatformAdminsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PlatformAdminView[] | { error: string }> => {
    return runAdmin(async () => {
      await requirePlatformAdmin()
      const db = serviceClient()
      const { data: rows } = await db
        .from('platform_admins')
        .select('user_id, note, created_at')
        .order('created_at', { ascending: true })
        .returns<
          { user_id: string; note: string | null; created_at: string }[]
        >()

      const out: PlatformAdminView[] = []
      for (const r of rows ?? []) {
        const { data } = await db.auth.admin.getUserById(r.user_id)
        out.push({
          userId: r.user_id,
          email: data.user?.email ?? '—',
          note: r.note,
          createdAt: r.created_at,
        })
      }
      return out
    })
  },
)

/** Find an auth user by email (case-insensitive). Returns id or null. */
async function findUserByEmail(email: string): Promise<string | null> {
  const db = serviceClient()
  const target = email.trim().toLowerCase()
  // Single large page is enough at this scale; paginate if it ever grows.
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const user = data.users.find((u) => (u.email ?? '').toLowerCase() === target)
  return user?.id ?? null
}

export const addPlatformAdminFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        email: z.string().trim().email(),
        note: z.string().trim().max(200).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    return runAdmin(async () => {
      const admin = await requirePlatformAdmin()
      const userId = await findUserByEmail(data.email)
      if (!userId) {
        return {
          error:
            'Užívateľ s týmto e-mailom neexistuje (musí byť registrovaný).',
        } as const
      }
      const db = serviceClient()
      const { error } = await db
        .from('platform_admins')
        .upsert(
          { user_id: userId, note: data.note || null },
          { onConflict: 'user_id', ignoreDuplicates: true },
        )
      if (error) throw new AdminError('Admina sa nepodarilo pridať.')

      await writeAuditLog({
        actorId: admin.userId,
        action: 'admin.platform_admin_add',
        entityType: 'platform_admin',
        entityId: userId,
        newValue: { email: data.email },
      })
      return { ok: true as const }
    })
  })

export const removePlatformAdminFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    return runAdmin(async () => {
      const admin = await requirePlatformAdmin()
      const db = serviceClient()

      const { count } = await db
        .from('platform_admins')
        .select('*', { count: 'exact', head: true })
      if ((count ?? 0) <= 1) {
        return {
          error: 'Nemožno odobrať posledného platform admina.',
        } as const
      }

      const { error } = await db
        .from('platform_admins')
        .delete()
        .eq('user_id', data.userId)
      if (error) throw new AdminError('Admina sa nepodarilo odobrať.')

      await writeAuditLog({
        actorId: admin.userId,
        action: 'admin.platform_admin_remove',
        entityType: 'platform_admin',
        entityId: data.userId,
      })
      return { ok: true as const }
    })
  })
