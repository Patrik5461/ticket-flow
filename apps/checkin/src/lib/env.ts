// Build-time config (Vite inlines VITE_*). See .env.example.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string
export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? 'https://ticketio.sk'
