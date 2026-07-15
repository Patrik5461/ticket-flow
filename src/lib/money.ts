/**
 * Money helpers. All amounts in the system are integer cents (EUR). Never float.
 */

const eurFormatter = new Intl.NumberFormat('sk-SK', {
  style: 'currency',
  currency: 'EUR',
})

/** Format integer cents as a Slovak EUR string, e.g. 1250 -> "12,50 €". */
export function formatEur(cents: number): string {
  return eurFormatter.format(cents / 100)
}

/** Round a euro float to whole cents (defensive helper; internals stay in cents). */
export function toCents(euros: number): number {
  return Math.round(euros * 100)
}
