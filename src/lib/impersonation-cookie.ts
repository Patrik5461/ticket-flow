/**
 * Name of the impersonation cookie, in a module with no heavy imports so both
 * the server-fn layer (server/impersonation-session.ts) and route handlers
 * (lib/supabase/auth-request.ts) can share it without either pulling the other's
 * dependencies into its bundle.
 */
export const IMPERSONATE_COOKIE = 'ticketio_impersonate'
