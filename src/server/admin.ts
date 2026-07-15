/**
 * Platform super-admin server layer. Authorization is enforced here in code (via
 * the service role, which bypasses RLS), consistent with the rest of the app.
 *
 * Every admin route is gated by requirePlatformAdmin; non-admins must never learn
 * that the admin surface exists, so the route layer maps a failed check to a 404
 * (notFound), not a 403. Every admin mutation writes an audit_log row.
 *
 * Server-only.
 */

import { getCurrentUser } from '../lib/supabase/auth'
import { serviceClient } from '../lib/supabase/server'

export class AdminError extends Error {}

export interface AdminActor {
  userId: string
  email: string
}

/** True if the given auth user is a platform super-admin. */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const { data } = await serviceClient()
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle<{ user_id: string }>()
  return Boolean(data)
}

/**
 * Resolve the current caller as a platform admin, or throw. The generic message
 * avoids confirming the admin surface to non-admins if it ever surfaces.
 */
export async function requirePlatformAdmin(): Promise<AdminActor> {
  const user = await getCurrentUser()
  if (!user || !(await isPlatformAdmin(user.id))) {
    throw new AdminError('Nenájdené.')
  }
  return { userId: user.id, email: user.email ?? '' }
}

/** Wrap an admin handler so AdminError surfaces as { error } instead of a 500. */
export async function runAdmin<T>(
  fn: () => Promise<T>,
): Promise<T | { error: string }> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof AdminError) return { error: e.message }
    throw e
  }
}

export interface AuditEntry {
  actorId: string | null
  action: string
  entityType: string
  entityId?: string | null
  oldValue?: unknown
  newValue?: unknown
}

/**
 * Append an audit_log row. Best-effort but surfaced: audit failures should not
 * silently pass, so we let the DB error propagate to the caller's runAdmin (a
 * mutation that cannot be audited is treated as failed).
 */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  const { error } = await serviceClient()
    .from('audit_log')
    .insert({
      actor_id: entry.actorId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      old_value: entry.oldValue ?? null,
      new_value: entry.newValue ?? null,
    })
  if (error) throw new AdminError('Akciu sa nepodarilo zaznamenať (audit).')
}
