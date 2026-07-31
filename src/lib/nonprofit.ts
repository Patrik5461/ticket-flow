/**
 * Shared, client-safe vocabulary for the non-profit commission.
 *
 * Deliberately separate from src/server/nonprofit.ts: the registration and
 * settings screens render these labels, and importing them from the server
 * module would drag server-only code into the client graph (see the lazy-schema
 * fix in src/lib/env.ts for why that matters here).
 */

/** Legal forms that can qualify. Values match the DB check constraint. */
export const LEGAL_FORMS = [
  { value: 'civic_association', label: 'Občianske združenie' },
  { value: 'foundation', label: 'Nadácia' },
  { value: 'npo', label: 'Nezisková organizácia (n. o.)' },
  { value: 'non_investment_fund', label: 'Neinvestičný fond' },
  { value: 'church', label: 'Účelové zariadenie cirkvi' },
  { value: 'other_nonprofit', label: 'Iná nezisková právna forma' },
] as const

export type LegalForm = (typeof LEGAL_FORMS)[number]['value']

/** Non-empty tuple shape that z.enum() requires. */
export const LEGAL_FORM_VALUES = LEGAL_FORMS.map((f) => f.value) as [
  LegalForm,
  ...LegalForm[],
]

export type NonprofitStatus = 'none' | 'pending' | 'approved' | 'rejected'

export function legalFormLabel(value: string | null): string | null {
  return LEGAL_FORMS.find((f) => f.value === value)?.label ?? null
}

/** IČO is 8 digits in SK/CZ; spaces are common in copy-paste. */
export function normalizeIco(input: string): string {
  return input.replace(/\s+/g, '')
}

export function isValidIco(input: string): boolean {
  return /^\d{8}$/.test(normalizeIco(input))
}
