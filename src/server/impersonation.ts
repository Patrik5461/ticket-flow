/**
 * Impersonation server functions (start/stop). Route files import these; their
 * handler bodies (and the setCookie import) are stripped from the client bundle
 * by the createServerFn bridge. The plain session helpers live in
 * impersonation-session.ts (imported only by other server modules).
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { setCookie } from '@tanstack/react-start/server'
import { z } from 'zod'
import { serviceClient } from '../lib/supabase/server'
import { requirePlatformAdmin, runAdmin, writeAuditLog } from './admin'

// Must match impersonation-session.ts (kept in sync deliberately: importing it
// here would pull that module's react-start/server import into the client graph).
const IMPERSONATE_COOKIE = 'ticketio_impersonate'

const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
}

export const startImpersonationFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z.object({ organizerId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    return runAdmin(async () => {
      const admin = await requirePlatformAdmin()
      const { data: org } = await serviceClient()
        .from('organizers')
        .select('id, name')
        .eq('id', data.organizerId)
        .maybeSingle<{ id: string; name: string }>()
      if (!org) return { error: 'Organizátor sa nenašiel.' } as const

      setCookie(IMPERSONATE_COOKIE, org.id, {
        ...cookieOpts,
        maxAge: 2 * 60 * 60,
      })
      await writeAuditLog({
        actorId: admin.userId,
        action: 'admin.impersonate_start',
        entityType: 'organizer',
        entityId: org.id,
        newValue: { organizer: org.name },
      })
      return { ok: true as const }
    })
  })

export const stopImpersonationFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    setCookie(IMPERSONATE_COOKIE, '', { ...cookieOpts, maxAge: 0 })
    return { ok: true as const }
  },
)
