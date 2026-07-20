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

export function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('sk-SK', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: tz,
  }).format(new Date(iso))
}
