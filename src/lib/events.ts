/**
 * Shared program filter for the public pages.
 *
 * `listPublishedEvents()` returns every published event, oldest first — so a
 * naive "first six" on the landing page shows the six events furthest in the
 * past. Anything the buyer is offered has to be filtered through this first.
 */
export interface DatedEvent {
  starts_at: string
  ends_at?: string | null
}

/** An event stays on the program until it ends; a missing end means it ends when it starts. */
export function isUpcoming(e: DatedEvent, now: number = Date.now()): boolean {
  const end = e.ends_at ?? e.starts_at
  const t = new Date(end).getTime()
  return Number.isFinite(t) && t >= now
}

/** Published events still ahead of us, soonest first. */
export function upcomingEvents<T extends DatedEvent>(
  events: T[],
  now: number = Date.now(),
): T[] {
  return events
    .filter((e) => isUpcoming(e, now))
    .sort(
      (a, b) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
    )
}
