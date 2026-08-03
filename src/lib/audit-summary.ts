/**
 * Turning an audit_log row into something a person reads.
 *
 * audit_log stores old_value/new_value as free-form jsonb written by whichever
 * admin action produced it, so the history screen would otherwise be a wall of
 * JSON. This renders one line instead: what changed, and from what to what.
 *
 * Pure — no DB, no server imports — so it is unit-testable and can be used on
 * either side. It never throws: a row whose values are null, a string, or a
 * shape nobody anticipated still has to render, because the alternative is a
 * history screen that crashes on one bad row.
 */

/** Action code → what to call it in the UI. Unknown codes show as themselves. */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  'admin.venue_update': 'Upravená hala',
  'admin.venue_map_create': 'Pridaná mapa',
  'admin.venue_map_update': 'Upravená mapa',
  'admin.venue_map_delete': 'Zmazaná mapa',
  'admin.venue_import_unlock': 'Uvoľnené pre import',
}

/** Field name → Slovak label. Unknown fields show under their own name. */
const FIELD_LABEL: Record<string, string> = {
  name: 'názov',
  address: 'adresa',
  seats: 'sedadlá',
  objects: 'objekty',
  importLockedAt: 'zámok',
}

/** Fields that identify the row rather than describe the change. */
const SKIP = new Set(['venueId'])

/** Longest rendered value; a pasted address should not fill the screen. */
const MAX_VALUE = 60

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

function show(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v).slice(0, MAX_VALUE)
  const s = String(v)
  return s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE - 1)}…` : s
}

/**
 * One line describing the difference: „sedadlá 390 → 388, názov A → B".
 *
 * A field present on both sides and unchanged is dropped — an audit row often
 * carries the whole object, and listing what stayed the same buries what did
 * not. A field on one side only is shown as a plain value, which is what a
 * create (new only) or a delete (old only) looks like.
 *
 * Returns '' when there is nothing worth showing; the caller renders the action
 * label alone.
 */
export function summarizeAuditChange(
  oldValue: unknown,
  newValue: unknown,
): string {
  const before = asRecord(oldValue)
  const after = asRecord(newValue)
  const keys = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].filter((k) => !SKIP.has(k))

  return keys
    .map((k) => {
      const label = FIELD_LABEL[k] ?? k
      const inBefore = k in before
      const inAfter = k in after
      if (inBefore && inAfter) {
        const a = show(before[k])
        const b = show(after[k])
        return a === b ? '' : `${label} ${a} → ${b}`
      }
      return `${label} ${show(inAfter ? after[k] : before[k])}`
    })
    .filter(Boolean)
    .join(', ')
}
