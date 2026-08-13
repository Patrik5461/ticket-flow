/**
 * Extract the client IP from proxy headers, for the per-IP rate limiters in
 * server/rate-guards.ts.
 *
 * Read the RIGHTMOST X-Forwarded-For entry, not the leftmost.
 *
 * X-Forwarded-For is a list that each hop appends to, so everything except the
 * part our own trusted proxy added is text the caller chose. nginx forwards
 * `$proxy_add_x_forwarded_for`, which is "whatever arrived" + its own view of
 * the peer — so the last element is the only one nginx vouches for, and the
 * ones before it are attacker-controlled.
 *
 * Taking the leftmost entry, as this used to, defeated every limiter in the
 * app: measured against production on 2026-08-13, 60 requests carrying
 * `X-Forwarded-For: 203.0.113.7` exhausted that bucket and returned 429, while
 * a single request with 203.0.113.8 was served immediately. Rotating one header
 * value bypassed the login brute-force ceiling, the anti-enumeration limit on
 * support lookups and the checkout flood ceiling alike — and the same trick
 * pointed at somebody else's address would burn *their* bucket and lock them
 * out of logging in.
 *
 * The rule stays right if the edge is ever fixed to pass the true source
 * address (see below): nginx would then append the real client, which is again
 * the rightmost element.
 *
 * KNOWN LIMITATION, not solvable here: the OPNsense/HAProxy edge does not
 * currently forward the source address at all, so the value nginx appends is
 * the edge's own 192.168.1.1 for every visitor on the internet — every caller
 * therefore shares ONE bucket. Verified the same day: a request sent with
 * `X-Forwarded-For: 192.168.1.1` landed in the already-exhausted no-header
 * bucket. Until the edge sets the header (HAProxy: `http-request set-header
 * X-Forwarded-For %[src]`, which replaces rather than appends) and nginx maps
 * it back with set_real_ip_from, these limiters are global ceilings rather than
 * per-visitor ones. That is a denial-of-service risk at launch — checkout is
 * capped at 20/min — but it is strictly better than a ceiling anyone can step
 * around.
 */

/** Addresses added by our own infrastructure, never a real client. */
const INFRA_ADDRESSES = new Set(['127.0.0.1', '::1'])

export function clientIpFromHeaders(headers: Headers): string {
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const hops = xff
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean)
    // Walk in from the right, skipping loopback: the rightmost entry our proxy
    // appended is the last one we have any reason to believe.
    for (let i = hops.length - 1; i >= 0; i--) {
      const hop = hops[i]
      if (!INFRA_ADDRESSES.has(hop)) return hop
    }
  }
  // x-real-ip is set by nginx itself from $remote_addr, so it is not
  // caller-controlled and is a safe fallback.
  return headers.get('x-real-ip')?.trim() || 'unknown'
}
