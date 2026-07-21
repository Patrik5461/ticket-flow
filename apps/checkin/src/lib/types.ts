export type Outcome = 'ok' | 'already_used' | 'cancelled' | 'invalid' | 'reentry'

/**
 * What the scanner can display: the server outcomes plus two states that exist
 * only offline.
 *  - `unknown`  — validly scanned, but not in the downloaded data (most likely
 *                 sold after the last sync). NOT a forgery: "verify online".
 *  - `no_data`  — no network and nothing downloaded for this event.
 */
export type ScanOutcome = Outcome | 'unknown' | 'no_data'

/** Response shape of POST /api/checkin (mirrors the server's CheckinResponse). */
export interface ScanResult {
  result: ScanOutcome
  holderName: string | null
  ticketType: string | null
  usedAt: string | null
  ref: string | null
  seat: string | null
  /** For `reentry`: how many times admitted (this entry included). */
  entryCount?: number
  /** True when the verdict came from local data, not from the server. */
  offline?: boolean
}

/** One ticket in the offline bundle (mirrors the server's OfflineTicket). */
export interface OfflineTicket {
  id: string
  /** SHA-256 (hex) of the whole QR token — the device never gets qr_secret. */
  tokenHash: string
  holderName: string | null
  ticketType: string | null
  seat: string | null
  status: 'valid' | 'used' | 'cancelled'
  usedAt: string | null
  entryCount: number
}

export interface OfflineEventMeta {
  id: string
  title: string
  startsAt: string
  endsAt: string | null
  timezone: string
  venueName: string | null
  allowReentry: boolean
}

/** Response shape of GET /api/offline-bundle. */
export interface OfflineBundlePage {
  event: OfflineEventMeta
  generatedAt: string
  total: number
  offset: number
  limit: number
  tickets: OfflineTicket[]
}

export interface EventRow {
  id: string
  title: string
  startsAt: string
  timezone: string
  venueName: string | null
  checkedIn: number
  total: number
}
