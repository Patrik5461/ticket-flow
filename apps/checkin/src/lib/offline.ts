/**
 * Offline data for the scanner: the downloaded ticket list per event, kept in
 * @capacitor/preferences (iOS UserDefaults / Android SharedPreferences — inside
 * the app sandbox, not the webview's localStorage).
 *
 * SECURITY. The bundle holds NO qr_secret — only a SHA-256 digest of each
 * ticket's QR token (see src/server/offline-bundle.ts). Nothing extractable
 * from the device can be turned into a valid ticket. Holder names are personal
 * data though, so the data is wiped:
 *   - on sign-out (clearAllOffline),
 *   - manually, per event (deleteOffline),
 *   - automatically 24 h after the event ends (purgeExpiredOffline).
 *
 * A ticket sold after the last download is not in the bundle; the scanner must
 * report it as "unknown — verify online", never as invalid (block 3b).
 */
import { Preferences } from '@capacitor/preferences'
import { fetchOfflineBundlePage } from './api'
import { clearQueue } from './queue'
import { dismissConflicts } from './sync'
import type { OfflineTicket } from './types'

/** How long downloaded personal data may survive the event. */
export const RETENTION_MS = 24 * 60 * 60 * 1000
const PAGE_SIZE = 500

const INDEX_KEY = 'offline.index'
const ticketsKey = (eventId: string) => `offline.tickets.${eventId}`

/** What the device knows about one downloaded event. */
export interface OfflineMeta {
  eventId: string
  title: string
  startsAt: string
  endsAt: string | null
  timezone: string
  venueName: string | null
  allowReentry: boolean
  /** When the data was generated on the server (shown to the operator). */
  syncedAt: string
  ticketCount: number
}

export interface OfflineBundle {
  meta: OfflineMeta
  /** Ticket by SHA-256 of its QR token — the offline lookup index. */
  byHash: Record<string, OfflineTicket>
}

type Index = Record<string, OfflineMeta>

async function readJson<T>(key: string): Promise<T | null> {
  const { value } = await Preferences.get({ key })
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    // Corrupted entry — treat as absent rather than breaking the scanner.
    return null
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await Preferences.set({ key, value: JSON.stringify(value) })
}

async function readIndex(): Promise<Index> {
  return (await readJson<Index>(INDEX_KEY)) ?? {}
}

/** Metadata of every event with offline data, keyed by event id. */
export async function listOffline(): Promise<Index> {
  return readIndex()
}

export async function getOfflineMeta(
  eventId: string,
): Promise<OfflineMeta | null> {
  return (await readIndex())[eventId] ?? null
}

/** Full bundle (metadata + hash index) for one event, or null if not downloaded. */
export async function getOfflineBundle(
  eventId: string,
): Promise<OfflineBundle | null> {
  const meta = await getOfflineMeta(eventId)
  if (!meta) return null
  const byHash = await readJson<Record<string, OfflineTicket>>(
    ticketsKey(eventId),
  )
  if (!byHash) return null
  return { meta, byHash }
}

/**
 * Download (or refresh) the offline bundle for one event, page by page.
 * `onProgress` receives 0..1 so the UI can show a progress bar. The existing
 * data is replaced only once every page arrived — a failed download never
 * leaves a half-written bundle behind.
 */
export async function downloadOffline(
  eventId: string,
  onProgress?: (fraction: number) => void,
): Promise<OfflineMeta> {
  const byHash: Record<string, OfflineTicket> = {}
  let offset = 0
  let total = 0
  let meta: OfflineMeta | null = null

  for (;;) {
    const page = await fetchOfflineBundlePage(eventId, offset, PAGE_SIZE)
    total = page.total
    for (const t of page.tickets) byHash[t.tokenHash] = t

    meta = {
      eventId: page.event.id,
      title: page.event.title,
      startsAt: page.event.startsAt,
      endsAt: page.event.endsAt,
      timezone: page.event.timezone,
      venueName: page.event.venueName,
      allowReentry: page.event.allowReentry,
      syncedAt: page.generatedAt,
      ticketCount: 0,
    }

    offset += page.tickets.length
    onProgress?.(total > 0 ? Math.min(1, offset / total) : 1)
    // Empty page = done (also guards against a bad `total`).
    if (page.tickets.length === 0 || offset >= total) break
  }

  if (!meta) throw new Error('Prázdna odpoveď servera.')
  meta.ticketCount = Object.keys(byHash).length

  await writeJson(ticketsKey(eventId), byHash)
  const index = await readIndex()
  index[eventId] = meta
  await writeJson(INDEX_KEY, index)
  onProgress?.(1)
  return meta
}

/** Patch one cached ticket (used by offline scanning in block 3b). */
export async function updateOfflineTicket(
  eventId: string,
  tokenHash: string,
  patch: Partial<OfflineTicket>,
): Promise<void> {
  const byHash = await readJson<Record<string, OfflineTicket>>(
    ticketsKey(eventId),
  )
  if (!byHash?.[tokenHash]) return
  byHash[tokenHash] = { ...byHash[tokenHash], ...patch }
  await writeJson(ticketsKey(eventId), byHash)
}

/** Remove one event's offline data (frees space, and clears personal data). */
export async function deleteOffline(eventId: string): Promise<void> {
  await Preferences.remove({ key: ticketsKey(eventId) })
  const index = await readIndex()
  delete index[eventId]
  await writeJson(INDEX_KEY, index)
}

/**
 * Wipe every downloaded bundle AND the pending sync queue — called on sign-out.
 * Callers must warn first if the queue is not empty (those admissions are lost).
 */
export async function clearAllOffline(): Promise<void> {
  const index = await readIndex()
  for (const eventId of Object.keys(index)) {
    await Preferences.remove({ key: ticketsKey(eventId) })
  }
  await Preferences.remove({ key: INDEX_KEY })
  await clearQueue()
  // Conflict reports name the holders too — they must not outlive the session.
  await dismissConflicts()
}

/** Expiry moment for a bundle: 24 h after the event ends (or starts, if open-ended). */
export function expiresAt(meta: OfflineMeta): number {
  const end = Date.parse(meta.endsAt ?? meta.startsAt)
  return (Number.isNaN(end) ? Date.now() : end) + RETENTION_MS
}

/**
 * Drop bundles for events that ended more than 24 h ago. Returns the removed
 * event ids. Runs whenever the event list opens.
 */
export async function purgeExpiredOffline(now = Date.now()): Promise<string[]> {
  const index = await readIndex()
  const stale = Object.values(index).filter((m) => expiresAt(m) < now)
  for (const meta of stale) await deleteOffline(meta.eventId)
  return stale.map((m) => m.eventId)
}
