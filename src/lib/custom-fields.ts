/**
 * Custom checkout fields per ticket type. Pure schema + validation — no DB.
 */

export type CustomFieldType = 'text' | 'select' | 'checkbox'

export interface CustomField {
  key: string
  label: string
  type: CustomFieldType
  required: boolean
  /** For 'select': the allowed option values. */
  options?: string[]
}

/** Coerce arbitrary JSON (jsonb column) into a clean CustomField[]. */
export function parseCustomFields(raw: unknown): CustomField[] {
  if (!Array.isArray(raw)) return []
  const out: CustomField[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const key = typeof r.key === 'string' ? r.key : ''
    const label = typeof r.label === 'string' ? r.label : ''
    const type = r.type === 'select' || r.type === 'checkbox' ? r.type : 'text'
    if (!key || !label) continue
    out.push({
      key,
      label,
      type,
      required: r.required === true,
      ...(type === 'select' && Array.isArray(r.options)
        ? {
            options: r.options.filter(
              (o): o is string => typeof o === 'string',
            ),
          }
        : {}),
    })
  }
  return out
}

export interface FieldError {
  key: string
  message: string
}

/**
 * Validate one attendee's answers against the fields. Returns the first error, or
 * null if valid. Required text/select must be non-empty; required checkbox must be
 * checked; select values must be one of the options.
 */
export function validateAnswers(
  fields: CustomField[],
  answers: Record<string, string>,
): FieldError | null {
  for (const f of fields) {
    const raw = answers[f.key]
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (f.type === 'checkbox') {
      if (f.required && value !== 'true') {
        return { key: f.key, message: `Pole „${f.label}" je povinné.` }
      }
      continue
    }
    if (f.required && !value) {
      return { key: f.key, message: `Pole „${f.label}" je povinné.` }
    }
    if (
      f.type === 'select' &&
      value &&
      f.options &&
      !f.options.includes(value)
    ) {
      return { key: f.key, message: `Neplatná hodnota pre „${f.label}".` }
    }
  }
  return null
}
