/**
 * Queue of check-ins performed offline, waiting to be sent to the server.
 *
 * Persisted in native Preferences, never in memory — an app restart (or a crash
 * mid-event) must not lose admissions. Entries are removed only after the
 * server has accepted them (block 3c).
 *
 * The entry keeps the scanned QR string because the sync replays it through the
 * existing, idempotent POST /api/checkin. That is a token for a ticket that has
 * already been admitted; it is wiped together with everything else on sign-out.
 */
import { Preferences } from '@capacitor/preferences'

const QUEUE_KEY = 'offline.queue'

export interface QueuedScan {
  /** Local id (not a server id) — used to remove the entry after sync. */
  id: string
  eventId: string
  ticketId: string
  ref: string | null
  holderName: string | null
  /** The scanned QR token, replayed to /api/checkin on sync. */
  qr: string
  /** When the holder was actually admitted at the door. */
  scannedAt: string
  deviceLabel: string
}

export async function readQueue(): Promise<QueuedScan[]> {
  const { value } = await Preferences.get({ key: QUEUE_KEY })
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as QueuedScan[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeQueue(entries: QueuedScan[]): Promise<void> {
  await Preferences.set({ key: QUEUE_KEY, value: JSON.stringify(entries) })
}

/** Append one offline admission. Written immediately (survives a restart). */
export async function enqueueScan(entry: QueuedScan): Promise<void> {
  const queue = await readQueue()
  queue.push(entry)
  await writeQueue(queue)
}

/** Pending count, optionally for one event. */
export async function queueCount(eventId?: string): Promise<number> {
  const queue = await readQueue()
  return eventId ? queue.filter((e) => e.eventId === eventId).length : queue.length
}

/** Drop entries the server has accepted (or definitively rejected). */
export async function removeFromQueue(ids: string[]): Promise<void> {
  if (!ids.length) return
  const drop = new Set(ids)
  const queue = await readQueue()
  await writeQueue(queue.filter((e) => !drop.has(e.id)))
}

export async function clearQueue(): Promise<void> {
  await Preferences.remove({ key: QUEUE_KEY })
}
