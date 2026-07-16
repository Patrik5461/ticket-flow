/**
 * Guestlist CSV parsing. Pure — uses papaparse, no DB. Accepts a CSV with a
 * header row; finds the email and (optional) name columns by common Slovak/English
 * header names, validates emails, and de-duplicates by lowercased email.
 */

import Papa from 'papaparse'

export interface Guest {
  name: string | null
  email: string
}

export interface GuestlistParseResult {
  guests: Guest[]
  /** Rows dropped: invalid/missing email or a duplicate. */
  skipped: number
}

const EMAIL_HEADERS = [
  'email',
  'e-mail',
  'mail',
  'emailová adresa',
  'e-mailová adresa',
]
const NAME_HEADERS = [
  'name',
  'meno',
  'meno a priezvisko',
  'full name',
  'celé meno',
]
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function pickHeader(headers: string[], candidates: string[]): string | null {
  const lower = headers.map((h) => h.trim().toLowerCase())
  for (const c of candidates) {
    const i = lower.indexOf(c)
    if (i !== -1) return headers[i]
  }
  return null
}

export function parseGuestlist(csvText: string): GuestlistParseResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  })

  const headers = parsed.meta.fields ?? []
  const emailCol = pickHeader(headers, EMAIL_HEADERS)
  const nameCol = pickHeader(headers, NAME_HEADERS)

  const guests: Guest[] = []
  const seen = new Set<string>()
  let skipped = 0

  // No email column at all → treat every row as skipped.
  if (!emailCol) {
    return { guests: [], skipped: parsed.data.length }
  }

  for (const row of parsed.data) {
    const email = (row[emailCol] ?? '').trim().toLowerCase()
    if (!EMAIL_RE.test(email) || seen.has(email)) {
      skipped++
      continue
    }
    seen.add(email)
    const name = nameCol ? (row[nameCol] ?? '').trim() : ''
    guests.push({ name: name || null, email })
  }

  return { guests, skipped }
}
