/**
 * Money helpers. All amounts in the system are integer cents (EUR). Never float.
 */

const eurFormatter = new Intl.NumberFormat('sk-SK', {
  style: 'currency',
  currency: 'EUR',
})

/**
 * Normalize the no-break space variants ICU emits — U+00A0 (no-break) and
 * U+202F (narrow no-break) — to a plain space. Node's ICU (server) and the
 * browser's ICU (client) disagree on which one to use in sk-SK currency/date
 * output, and Safari/WebKit differs from Node while Chrome happens to match.
 * That byte difference is a React hydration text mismatch (#418) that throws
 * during hydration and leaves the page non-interactive on mobile Safari. Running
 * every Intl string through this makes both sides identical.
 */
export function normIntlSpaces(s: string): string {
  return s.replace(/[\u00A0\u202F]/g, ' ')
}

/** Format integer cents as a Slovak EUR string, e.g. 1250 -> "12,50 €". */
export function formatEur(cents: number): string {
  return normIntlSpaces(eurFormatter.format(cents / 100))
}

/** Round a euro float to whole cents (defensive helper; internals stay in cents). */
export function toCents(euros: number): number {
  return Math.round(euros * 100)
}
