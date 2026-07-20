import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { API_BASE } from './env'
import { accessToken } from './supabase'
import type { ScanResult } from './types'

const INVALID: ScanResult = {
  result: 'invalid',
  holderName: null,
  ticketType: null,
  usedAt: null,
  ref: null,
  seat: null,
}

export class AuthError extends Error {}

interface Raw {
  status: number
  body: unknown
}

/**
 * On device the webview would be blocked by CORS calling ticketio.sk (the
 * endpoint sends no CORS headers), so use CapacitorHttp (native HTTP, no CORS).
 * On web/dev fall back to fetch. Supabase endpoints DO send CORS, so the
 * Supabase client keeps using normal fetch — only this call needs the bridge.
 */
async function postCheckin(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Raw> {
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.post({ url, headers, data: body })
    return { status: res.status, body: res.data }
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

/**
 * Check in one scanned QR via the existing server endpoint, authenticated with
 * the Supabase access token (Bearer). The endpoint is idempotent and returns
 * 200 for every recognised attempt (ok / already_used / cancelled / invalid);
 * anything else surfaces as an invalid scan. A 401 means the session is gone.
 */
export async function checkinScan(
  eventId: string,
  qr: string,
): Promise<ScanResult> {
  const token = await accessToken()
  if (!token) throw new AuthError('NO_SESSION')

  const { status, body } = await postCheckin(
    `${API_BASE}/api/checkin`,
    {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    { eventId, qr, deviceLabel: 'Ticketio Scan' },
  )

  if (status === 401) throw new AuthError('UNAUTHORIZED')
  if (status < 200 || status >= 300) return INVALID
  return body as ScanResult
}
