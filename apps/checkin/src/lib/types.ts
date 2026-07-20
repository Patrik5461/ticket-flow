export type Outcome = 'ok' | 'already_used' | 'cancelled' | 'invalid'

/** Response shape of POST /api/checkin (mirrors the server's CheckinResponse). */
export interface ScanResult {
  result: Outcome
  holderName: string | null
  ticketType: string | null
  usedAt: string | null
  ref: string | null
  seat: string | null
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
