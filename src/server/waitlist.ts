/**
 * Waitlist domain logic. Two entry points, both dependency-injected for testing:
 *
 *  - joinWaitlist: a buyer watches a (sold-out) ticket type. Idempotent per
 *    (type, email) via the partial unique index — a repeat signup is a no-op.
 *  - processWaitlist: the cron worker. Requeues expired notifications, then for
 *    each type with free capacity notifies the first N still-waiting people with
 *    a time-limited checkout link. Claiming is optimistic (conditional UPDATE
 *    guarded on status='waiting') so concurrent ticks can't double-notify.
 *
 * Server-only.
 */

import { waitlistEmail } from '../lib/email/templates'

export interface WaitlistDb {
  from: (t: string) => any
}

export interface JoinResult {
  ok: boolean
  message?: string
}

/** Buyer signs up to watch a ticket type. Returns ok even for duplicates. */
export async function joinWaitlist(
  db: WaitlistDb,
  input: { slug: string; ticketTypeId: string; email: string },
): Promise<JoinResult> {
  const email = input.email.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, message: 'Neplatný e-mail.' }
  }

  const { data: event } = await db
    .from('events')
    .select('id')
    .eq('slug', input.slug)
    .eq('status', 'published')
    .maybeSingle()
  if (!event) return { ok: false, message: 'Podujatie sa nenašlo.' }

  const { data: type } = await db
    .from('ticket_types')
    .select('id, event_id')
    .eq('id', input.ticketTypeId)
    .eq('event_id', event.id)
    .maybeSingle()
  if (!type) return { ok: false, message: 'Typ vstupenky sa nenašiel.' }

  // Skip if already waiting (the partial unique index also enforces this).
  const { data: existing } = await db
    .from('waitlist_entries')
    .select('id')
    .eq('ticket_type_id', input.ticketTypeId)
    .eq('email', email)
    .eq('status', 'waiting')
    .maybeSingle()
  if (existing) return { ok: true }

  const { error } = await db.from('waitlist_entries').insert({
    event_id: event.id,
    ticket_type_id: input.ticketTypeId,
    email,
    status: 'waiting',
  })
  // A unique-violation just means someone signed up concurrently — treat as ok.
  if (error && error.code !== '23505') {
    return { ok: false, message: 'Nepodarilo sa uložiť. Skúste znova.' }
  }
  return { ok: true }
}

export interface WaitlistDeps {
  db: WaitlistDb
  /** Send one notification; must throw on failure. */
  sendEmail: (to: string, subject: string, html: string) => Promise<void>
  /** Build the checkout link that preselects one ticket of the type. */
  buildLink: (slug: string, ticketTypeId: string) => string
  /** Current time as ISO string. */
  now: () => string
  /** Current time in ms (for the notify window). */
  nowMs: () => number
  /** Minutes the checkout link stays "reserved" before re-offering. */
  windowMinutes?: number
}

export interface WaitlistResult {
  notified: number
  types: number
}

interface WaitingRow {
  id: string
  event_id: string
  ticket_type_id: string
  email: string
  created_at: string
}

interface TypeRow {
  id: string
  capacity: number
  sold_count: number
  name: string
  event_id: string
}

export async function processWaitlist(
  deps: WaitlistDeps,
  opts: { limit?: number } = {},
): Promise<WaitlistResult> {
  const limit = opts.limit ?? 200
  const windowMin = deps.windowMinutes ?? 30

  // 1) Requeue expired notifications so unclaimed spots go to the next person.
  await deps.db
    .from('waitlist_entries')
    .update({ status: 'waiting', notify_expires_at: null })
    .eq('status', 'notified')
    .lt('notify_expires_at', deps.now())

  // 2) Load the FIFO queue of people still waiting.
  const { data: waitingData } = await deps.db
    .from('waitlist_entries')
    .select('id, event_id, ticket_type_id, email, created_at')
    .eq('status', 'waiting')
    .order('created_at', { ascending: true })
  const waiting = ((waitingData as WaitingRow[] | null) ?? []).slice(0, limit)
  if (waiting.length === 0) return { notified: 0, types: 0 }

  // 3) Capacity per involved type.
  const typeIds = [...new Set(waiting.map((w) => w.ticket_type_id))]
  const { data: typeData } = await deps.db
    .from('ticket_types')
    .select('id, capacity, sold_count, name, event_id')
    .in('id', typeIds)
  const types = new Map(
    ((typeData as TypeRow[] | null) ?? []).map((t) => [t.id, t]),
  )

  // 4) Event slugs for the links.
  const eventIds = [...new Set(waiting.map((w) => w.event_id))]
  const { data: eventData } = await deps.db
    .from('events')
    .select('id, slug, title')
    .in('id', eventIds)
  const events = new Map(
    (
      (eventData as { id: string; slug: string; title: string }[] | null) ?? []
    ).map((e) => [e.id, e]),
  )

  const expiresAt = new Date(deps.nowMs() + windowMin * 60_000).toISOString()
  let notified = 0
  const typesTouched = new Set<string>()

  // Per type: notify up to `available` people, in FIFO order.
  const byType = new Map<string, WaitingRow[]>()
  for (const w of waiting) {
    const arr = byType.get(w.ticket_type_id) ?? []
    arr.push(w)
    byType.set(w.ticket_type_id, arr)
  }

  for (const [typeId, queue] of byType) {
    const type = types.get(typeId)
    if (!type) continue
    const available = type.capacity - type.sold_count
    if (available <= 0) continue

    let sent = 0
    for (const entry of queue) {
      if (sent >= available) break
      const event = events.get(entry.event_id)
      if (!event) continue

      // Optimistic claim: only proceed if still 'waiting'.
      const { data: claimed } = await deps.db
        .from('waitlist_entries')
        .update({
          status: 'notified',
          notified_at: deps.now(),
          notify_expires_at: expiresAt,
        })
        .eq('id', entry.id)
        .eq('status', 'waiting')
        .select('id')
        .maybeSingle()
      if (!claimed) continue // lost the race

      try {
        const link = deps.buildLink(event.slug, typeId)
        const { subject, html } = waitlistEmail({
          eventTitle: event.title,
          typeName: type.name,
          link,
          windowMinutes: windowMin,
        })
        await deps.sendEmail(entry.email, subject, html)
        notified++
        typesTouched.add(typeId)
        sent++
      } catch {
        // Send failed — put them back at the front so a later tick retries.
        await deps.db
          .from('waitlist_entries')
          .update({ status: 'waiting', notify_expires_at: null })
          .eq('id', entry.id)
      }
    }
  }

  return { notified, types: typesTouched.size }
}
