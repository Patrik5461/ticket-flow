export type Outcome = 'ok' | 'already_used' | 'cancelled' | 'invalid' | 'reentry'

/** Response shape of POST /api/checkin (mirrors the server's CheckinResponse). */
export interface ScanResult {
  result: Outcome
  holderName: string | null
  ticketType: string | null
  usedAt: string | null
  ref: string | null
  seat: string | null
  /** For `reentry`: how many times admitted (this entry included). */
  entryCount?: number
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
