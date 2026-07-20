import { createClient } from '@supabase/supabase-js'
import { Preferences } from '@capacitor/preferences'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env'

// Persist the auth session in native Preferences so the door worker stays
// logged in across app restarts; supabase-js auto-refreshes the access token,
// so the session effectively holds indefinitely without re-login.
const capacitorStorage = {
  getItem: async (key: string) => (await Preferences.get({ key })).value,
  setItem: async (key: string, value: string) => {
    await Preferences.set({ key, value })
  },
  removeItem: async (key: string) => {
    await Preferences.remove({ key })
  },
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: capacitorStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})

/** Current access token (Bearer), or null if signed out. */
export async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}
