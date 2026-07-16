/**
 * Pure validators for organizer company details. No IO.
 */

/** Slovak IČO: exactly 8 digits. */
export function isValidIco(raw: string): boolean {
  return /^\d{8}$/.test(raw.trim())
}

/** Normalize IBAN: strip spaces, uppercase. */
export function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase()
}

/**
 * IBAN format + mod-97 checksum (ISO 13616). Length 15–34, two letters + two
 * check digits, alphanumeric body. Returns true for a structurally valid IBAN.
 */
export function isValidIban(raw: string): boolean {
  const iban = normalizeIban(raw)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  // Move the first 4 chars to the end, then convert letters to numbers.
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const code =
      ch >= 'A' && ch <= 'Z' ? (ch.charCodeAt(0) - 55).toString() : ch
    for (const d of code) {
      remainder = (remainder * 10 + (d.charCodeAt(0) - 48)) % 97
    }
  }
  return remainder === 1
}
