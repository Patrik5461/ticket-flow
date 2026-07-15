/**
 * Slovak business register (RPO) lookup by IČO. Server-only — the client never
 * queries external registers directly (per CLAUDE.md); the checkout calls this
 * through a server fn.
 *
 * API: GET https://api.statistics.sk/rpo/v1/search?identifier=<ico>
 * Returns a history of names/addresses; we pick the currently valid ones (the
 * entry with no validTo, else the latest validFrom).
 */

const RPO_URL = 'https://api.statistics.sk/rpo/v1/search'

export interface CompanyInfo {
  name: string
  address: string | null
}

interface Dated {
  value?: string
  validFrom?: string
  validTo?: string
}

interface RpoAddress {
  street?: string
  buildingNumber?: string
  postalCodes?: string[]
  municipality?: { value?: string }
  validFrom?: string
  validTo?: string
}

export interface RpoResult {
  fullNames?: Dated[]
  addresses?: RpoAddress[]
}

/** Pick the currently valid entry from a validFrom/validTo history. */
function current<T extends { validTo?: string; validFrom?: string }>(
  items: T[] | undefined,
): T | null {
  if (!items || items.length === 0) return null
  const open = items.filter((i) => !i.validTo)
  const pool = open.length > 0 ? open : items
  return pool.reduce((best, i) =>
    (i.validFrom ?? '') > (best.validFrom ?? '') ? i : best,
  )
}

function formatAddress(a: RpoAddress | null): string | null {
  if (!a) return null
  const line1 = [a.street, a.buildingNumber].filter(Boolean).join(' ').trim()
  const line2 = [a.postalCodes?.[0], a.municipality?.value]
    .filter(Boolean)
    .join(' ')
    .trim()
  const full = [line1, line2].filter(Boolean).join(', ')
  return full || null
}

/** Normalize an IČO to 6–8 digits, or null if it doesn't look valid. */
export function normalizeIco(ico: string): string | null {
  const clean = ico.replace(/\s/g, '')
  return /^\d{6,8}$/.test(clean) ? clean : null
}

/** Pure: extract the current company name + address from an RPO result. */
export function companyFromRpoResult(
  entity: RpoResult | undefined,
): CompanyInfo | null {
  if (!entity) return null
  const name = current(entity.fullNames)?.value
  if (!name) return null
  return { name, address: formatAddress(current(entity.addresses)) }
}

export async function lookupCompanyByIco(
  ico: string,
): Promise<CompanyInfo | null> {
  const clean = normalizeIco(ico)
  if (!clean) return null

  let res: Response
  try {
    res = await fetch(`${RPO_URL}?identifier=${encodeURIComponent(clean)}`, {
      headers: { Accept: 'application/json' },
    })
  } catch {
    return null // register unreachable — caller shows a soft error
  }
  if (!res.ok) return null

  const json = (await res.json()) as { results?: RpoResult[] }
  return companyFromRpoResult(json.results?.[0])
}
