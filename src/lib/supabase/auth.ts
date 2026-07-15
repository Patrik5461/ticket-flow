/**
 * Cookie-bound Supabase client for organizer auth. Server-only. Reads/writes the
 * session cookies through TanStack Start's request context so SSR and server
 * functions share one authenticated session, and RLS runs as the logged-in user.
 */

import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { getRequest, setCookie } from '@tanstack/react-start/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { getEnv } from '../env'

export function createAuthClient(): SupabaseClient {
  const env = getEnv()
  return createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        const header = getRequest().headers.get('cookie') ?? ''
        return parseCookieHeader(header).map((c) => ({
          name: c.name,
          value: c.value ?? '',
        }))
      },
      setAll(cookies) {
        for (const { name, value, options } of cookies) {
          setCookie(name, value, options)
        }
      },
    },
  })
}

/** The current authenticated user (JWT validated against the auth server), or null. */
export async function getCurrentUser(): Promise<User | null> {
  const { data } = await createAuthClient().auth.getUser()
  return data.user ?? null
}
