/**
 * Slovak date formatting. This is a client-only SPA (no SSR), so plain
 * Intl.DateTimeFormat is fine — there's no hydration to mismatch.
 */
export function formatWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('sk-SK', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  }).format(new Date(iso))
}

/**
 * Age of the offline data, e.g. "21. 7. 20:14 · pred 12 min". The operator must
 * be able to tell at a glance how stale the downloaded ticket list is.
 */
export function formatSynced(iso: string, tz: string, now = Date.now()): string {
  const when = new Intl.DateTimeFormat('sk-SK', {
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  }).format(new Date(iso))
  return `${when} · ${formatAge(iso, now)}`
}

/** Relative age in Slovak: "pred 12 min" / "pred 3 h" / "pred 2 dňami". */
export function formatAge(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60000))
  if (min < 1) return 'práve teraz'
  if (min < 60) return `pred ${min} min`
  const hours = Math.round(min / 60)
  if (hours < 24) return `pred ${hours} h`
  const days = Math.round(hours / 24)
  return days === 1 ? 'pred 1 dňom' : `pred ${days} dňami`
}

/** Offline data older than this is flagged in the UI as possibly stale. */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000

export function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('sk-SK', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: tz,
  }).format(new Date(iso))
}
