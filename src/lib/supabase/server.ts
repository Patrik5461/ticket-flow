/**
 * Supabase clients. Server-only.
 *
 *  - service client: full access, bypasses RLS. Used by all write paths and by
 *    buyer flows that authorize via signed tokens instead of RLS.
 *  - anon client: honours RLS. Used for public reads (published events etc.).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getEnv } from '../env'

const authOpts = { auth: { persistSession: false, autoRefreshToken: false } }

let service: SupabaseClient | null = null
let anon: SupabaseClient | null = null

export function serviceClient(): SupabaseClient {
  if (!service) {
    const env = getEnv()
    service = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, authOpts)
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
