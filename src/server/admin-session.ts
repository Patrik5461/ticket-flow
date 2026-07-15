/**
 * Admin session probe — the ONE admin server module a route imports directly
 * (from the /admin guard). Like auth.ts it exports only a server fn (+ a type), so
 * the createServerFn bridge strips the handler and its getCurrentUser import from
 * the client bundle. The platform-admin check is inlined here (rather than pulled
 * from admin.ts) so this module has no static edge to admin.ts's plain helpers,
 * which would otherwise drag getCurrentUser into the client graph.
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { getCurrentUser } from '../lib/supabase/auth'
import { serviceClient } from '../lib/supabase/server'

export interface AdminSession {
  userId: string
  email: string
}

/**
 * Returns the caller's admin identity when they are a platform super-admin,
 * otherwise null. The /admin route turns null into a 404 so the admin surface's
 * existence is never revealed.
 */
export const getAdminSessionFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AdminSession | null> => {
    const user = await getCurrentUser()
    if (!user) return null
    const { data } = await serviceClient()
      .from('platform_admins')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle<{ user_id: string }>()
    if (!data) return null
    return { userId: user.id, email: user.email ?? '' }
  },
)
