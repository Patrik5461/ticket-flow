/**
 * Sending queued offline admissions to the server.
 *
 * Replays each queued scan through the existing, idempotent POST /api/checkin.
 * An entry leaves the queue ONLY after the server has answered for it — if the
 * connection dies mid-run the remainder stays queued and the next attempt picks
 * up where this one stopped. Nothing is ever dropped silently.
 *
 * Conflicts (the ticket was admitted online or on another device in the
 * meantime) are collected and surfaced to the operator, and they are persisted,
 * so an app restart cannot hide them.
 *
 * Known trade-off: delivery is at-least-once. If the server commits a scan but
 * the response is lost, the entry stays queued and gets replayed — the replay
 * then reads as `already_used` (reported as a conflict) or, with re-entry on, as
 * one extra entry. Losing an admission would be worse than reporting one twice.
 */
import { Preferences } from '@capacitor/preferences'
import { AuthError, checkinScan } from './api'
import { readQueue, removeFromQueue, queueCount } from './queue'
import type { ScanOutcome } from './types'

const CONFLICTS_KEY = 'offline.conflicts'

export interface SyncConflict {
  eventId: string
  ticketId: string
  ref: string | null
  holderName: string | null
  /** What the server said instead of admitting: already_used / cancelled / invalid. */
  result: ScanOutcome
  /** When this device admitted the holder offline. */
  scannedAt: string
}

export interface SyncState {
  running: boolean
  /** Admissions still waiting to be sent. */
  pending: number
  progress: { done: number; total: number } | null
  lastSyncAt: string | null
  conflicts: SyncConflict[]
  /** Set when the run stopped early (connection lost, session expired). */
  error: string | null
}

let state: SyncState = {
  running: false,
  pending: 0,
  progress: null,
  lastSyncAt: null,
  conflicts: [],
  error: null,
}

const listeners = new Set<() => void>()

function set(patch: Partial<SyncState>): void {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function getSyncState(): SyncState {
  return state
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

async function loadConflicts(): Promise<SyncConflict[]> {
  const { value } = await Preferences.get({ key: CONFLICTS_KEY })
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as SyncConflict[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function saveConflicts(conflicts: SyncConflict[]): Promise<void> {
  if (!conflicts.length) {
    await Preferences.remove({ key: CONFLICTS_KEY })
    return
  }
  await Preferences.set({
    key: CONFLICTS_KEY,
    value: JSON.stringify(conflicts),
  })
}

/** Operator acknowledged the conflict report. */
export async function dismissConflicts(): Promise<void> {
  await saveConflicts([])
  set({ conflicts: [] })
}

/** Re-read pending count + stored conflicts (on mount / after scanning). */
export async function refreshSyncState(): Promise<void> {
  set({ pending: await queueCount(), conflicts: await loadConflicts() })
}

/**
 * Send everything queued. Safe to call concurrently — a second call while a run
 * is in flight is a no-op.
 */
export async function runSync(): Promise<SyncState> {
  if (state.running) return state

  const queue = await readQueue()
  if (queue.length === 0) {
    set({ pending: 0 })
    return state
  }

  set({ running: true, error: null, progress: { done: 0, total: queue.length } })

  const accepted: string[] = []
  const found: SyncConflict[] = []
  let error: string | null = null

  for (const entry of queue) {
    try {
      const res = await checkinScan(entry.eventId, entry.qr)
      accepted.push(entry.id)
      // 'ok' = admitted, 'reentry' = admitted again (re-entry mode on).
      // Anything else means the ticket was consumed elsewhere.
      if (res.result !== 'ok' && res.result !== 'reentry') {
        found.push({
          eventId: entry.eventId,
          ticketId: entry.ticketId,
          ref: entry.ref,
          holderName: entry.holderName,
          result: res.result,
          scannedAt: entry.scannedAt,
        })
      }
      set({ progress: { done: accepted.length, total: queue.length } })
    } catch (e) {
      // Never sign out here — that would wipe the queue we are trying to save.
      error =
        e instanceof AuthError
          ? 'Vypršalo prihlásenie — prihlás sa znova, skeny zostávajú vo fronte.'
          : 'Spojenie sa prerušilo — zvyšok zostáva vo fronte.'
      break
    }
  }

  // Only entries the server actually answered for.
  await removeFromQueue(accepted)
  const conflicts = [...(await loadConflicts()), ...found]
  await saveConflicts(conflicts)

  set({
    running: false,
    progress: null,
    pending: await queueCount(),
    conflicts,
    lastSyncAt: accepted.length ? new Date().toISOString() : state.lastSyncAt,
    error,
  })
  return state
}

/**
 * Sync automatically: once at start-up and again whenever the device regains
 * connectivity. Returns a cleanup function.
 */
export function startAutoSync(): () => void {
  const attempt = () => {
    if (navigator.onLine) void runSync()
  }
  void refreshSyncState().then(attempt)
  window.addEventListener('online', attempt)
  return () => window.removeEventListener('online', attempt)
}
