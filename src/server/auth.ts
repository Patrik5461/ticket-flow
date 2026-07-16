/**
 * Organizer authentication + onboarding. Server functions.
 *
 * Sign-up creates the auth user (cookie session via @supabase/ssr) and, on first
 * sign-up, provisions an organizer row + an owner membership. Membership is the
 * basis for every dashboard authorization check (see requireMembership).
 */

import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { createAuthClient, getCurrentUser } from '../lib/supabase/auth'
import { serviceClient } from '../lib/supabase/server'
import { slugify } from '../lib/slug'
import { clientIpFromHeaders } from '../lib/client-ip'
import { authLimiter } from './rate-guards'

export interface SessionInfo {
  user: { id: string; email: string }
  organizer: { id: string; name: string; slug: string } | null
  role: 'owner' | 'admin' | 'checkin' | null
}

async function uniqueOrganizerSlug(base: string): Promise<string> {
  const db = serviceClient()
  const root = slugify(base) || 'organizator'
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`
    const { data } = await db
      .from('organizers')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle()
    if (!data) return candidate
  }
  return `${root}-${Date.now()}`
}

/** Idempotently ensure the user owns an organizer. Returns the organizer id. */
async function ensureOrganizerForUser(
  userId: string,
  organizerName: string,
): Promise<string> {
  const db = serviceClient()

  const { data: existing } = await db
    .from('organizer_members')
    .select('organizer_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle<{ organizer_id: string }>()
  if (existing) return existing.organizer_id

  const slug = await uniqueOrganizerSlug(organizerName)
  const { data: org, error } = await db
    .from('organizers')
    .insert({ name: organizerName, slug })
    .select('id')
    .single<{ id: string }>()
  if (error || !org) {
    throw new Error('Nepodarilo sa vytvoriť organizátora.')
  }

  await db
    .from('organizer_members')
    .insert({ organizer_id: org.id, user_id: userId, role: 'owner' })
  return org.id
}

export const signUpFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        email: z.string().email(),
        password: z.string().min(8, 'Heslo musí mať aspoň 8 znakov.'),
        organizerName: z.string().trim().min(2).max(120),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    if (!authLimiter.check(clientIpFromHeaders(getRequest().headers)).ok) {
      return { error: 'Príliš veľa pokusov. Skúste o chvíľu.' } as const
    }
    const supabase = createAuthClient()
    const { data: signUp, error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
    })
    if (error) return { error: error.message } as const
    if (!signUp.user) return { error: 'Registrácia zlyhala.' } as const

    await ensureOrganizerForUser(signUp.user.id, data.organizerName)

    // With email confirmation enabled, no session is returned until the user
    // confirms; otherwise they are logged in immediately.
    return { ok: true, needsConfirmation: !signUp.session } as const
  })

export const signInFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({ email: z.string().email(), password: z.string().min(1) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    if (!authLimiter.check(clientIpFromHeaders(getRequest().headers)).ok) {
      return { error: 'Príliš veľa pokusov. Skúste o chvíľu.' } as const
    }
    const supabase = createAuthClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    })
    if (error) return { error: 'Nesprávny e-mail alebo heslo.' } as const
    return { ok: true } as const
  })

export const signOutFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    await createAuthClient().auth.signOut()
    return { ok: true } as const
  },
)

export const getSessionFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SessionInfo | null> => {
    const user = await getCurrentUser()
    if (!user) return null

    const { data: membership } = await serviceClient()
      .from('organizer_members')
      .select('role, organizers(id, name, slug)')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle<{
        role: SessionInfo['role']
        organizers: { id: string; name: string; slug: string } | null
      }>()

    return {
      user: { id: user.id, email: user.email ?? '' },
      organizer: membership?.organizers ?? null,
      role: membership?.role ?? null,
    }
  },
)
