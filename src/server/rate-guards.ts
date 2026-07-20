/**
 * Shared per-IP rate limiters for abuse-sensitive public endpoints. In-memory
 * (per-instance) — see lib/rate-limit. No protected imports, so this is safe to
 * import from route handlers and server functions alike.
 *
 * Server-only.
 */

import { RateLimiter } from '../lib/rate-limit'

const MINUTE = 60_000

/** Order creation — protects capacity/pricing endpoints from floods. */
export const checkoutLimiter = new RateLimiter(20, MINUTE)
/** Login/signup — brute-force protection. */
export const authLimiter = new RateLimiter(10, MINUTE)
/** Check-in scans — staff scan fast, so this is high; just a flood ceiling. */
export const checkinLimiter = new RateLimiter(300, MINUTE)
/** Manual undo of a check-in (owner/admin only) — keyed by user; abuse ceiling. */
export const undoLimiter = new RateLimiter(30, MINUTE)
/** Public support lookups — anti-enumeration: 5 attempts / 15 min / IP. */
export const supportLimiter = new RateLimiter(5, 15 * MINUTE)
