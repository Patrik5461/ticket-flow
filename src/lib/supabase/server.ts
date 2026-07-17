/**
 * Supabase clients. Server-only.
 *
 *  - service client: full access, bypasses RLS. Used by all write paths and by
 *    buyer flows that authorize via signed tokens instead of RLS.
 *  - anon client: honours RLS. Used for public reads (published events etc.).
 */

import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getEnv, getServiceRoleKey } from '../env'

const authOpts = { auth: { persistSession: false, autoRefreshToken: false } }

let service: SupabaseClient | null = null
let anon: SupabaseClient | null = null

export function serviceClient(): SupabaseClient {
  if (!service) {
    const env = getEnv()
    // Lazy: throws here (not at env parse) if the service role key is absent,
    // so public pages using anonClient keep working without it.
    service = createClient(env.SUPABASE_URL, getServiceRoleKey(), authOpts)
  }
  return service
}

export function anonClient(): SupabaseClient {
  if (!anon) {
    const env = getEnv()
    anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, authOpts)
  }
  return anon
}
