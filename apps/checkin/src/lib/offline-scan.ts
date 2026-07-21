/**
 * Offline check-in: decide a scan from the downloaded bundle instead of the
 * server, then record it locally and queue it for sync.
 *
 * Verification is by digest — SHA-256 of the scanned string must match a
 * `tokenHash` in the bundle. The device holds no qr_secret, so a code that is
 * not in the bundle cannot be distinguished from one sold after the download.
 * It is therefore reported as `unknown` ("verify online"), never as `invalid`:
 * telling door staff a genuine late-sale ticket is a forgery would be worse
 * than telling them to check.
 *
 * `evaluateOffline` is pure so the whole decision table is unit-testable.
 */
import { sha256Hex } from './hash'
import { getOfflineBundle, updateOfflineTicket } from './offline'
import { enqueueScan } from './queue'
import { deviceLabel } from './device'
import type { OfflineTicket, ScanResult } from './types'

/** Thrown when there is no network AND no downloaded data for the event. */
export class NoOfflineDataError extends Error {}

export interface OfflineEval {
  response: ScanResult
  /** Fields to persist on the cached ticket, or null if nothing changed. */
  patch: Partial<OfflineTicket> | null
  /** Whether this admission must be sent to the server later. */
  enqueue: boolean
}

/**
 * The offline decision table. Mirrors the server's checkInTicket, including
 * Phase 23 re-entry: with `allowReentry` an already-used ticket is admitted
 * again as `reentry` (numbered, showing the previous entry time) instead of
 * being refused as `already_used`.
 */
export function evaluateOffline(args: {
  ticket: OfflineTicket | undefined
  allowReentry: boolean
  nowIso: string
}): OfflineEval {
  const { ticket, allowReentry, nowIso } = args

  if (!ticket) {
    return {
      response: {
        result: 'unknown',
        holderName: null,
        ticketType: null,
        usedAt: null,
        ref: null,
        seat: null,
        offline: true,
      },
      patch: null,
      enqueue: false,
    }
  }

  const base = {
    holderName: ticket.holderName,
    ticketType: ticket.ticketType,
    ref: ticket.id.slice(0, 8).toUpperCase(),
    seat: ticket.seat,
    offline: true as const,
  }

  if (ticket.status === 'cancelled') {
    return {
      response: { ...base, result: 'cancelled', usedAt: ticket.usedAt },
      patch: null,
      enqueue: false,
    }
  }

  if (ticket.status === 'valid') {
    return {
      response: { ...base, result: 'ok', usedAt: nowIso },
      patch: { status: 'used', usedAt: nowIso, entryCount: ticket.entryCount + 1 },
      enqueue: true,
    }
  }

  // Already used.
  if (!allowReentry) {
    return {
      response: { ...base, result: 'already_used', usedAt: ticket.usedAt },
      patch: null,
      enqueue: false,
    }
  }

  return {
    response: {
      ...base,
      result: 'reentry',
      // The PREVIOUS entry — displayed as "naposledy o …".
      usedAt: ticket.usedAt,
      entryCount: ticket.entryCount + 1,
    },
    // Ticket stays 'used'; only the entry counter and last-entry time move, so
    // the checked-in total can never be counted twice.
    patch: { usedAt: nowIso, entryCount: ticket.entryCount + 1 },
    enqueue: true,
  }
}

/**
 * Verify one scanned QR against the downloaded bundle, persist the outcome and
 * queue it for sync. Throws NoOfflineDataError when nothing was downloaded for
 * this event — the caller shows the "download data or go online" message.
 */
export async function scanOffline(
  eventId: string,
  qr: string,
  now: () => string = () => new Date().toISOString(),
): Promise<ScanResult> {
  const bundle = await getOfflineBundle(eventId)
  if (!bundle) throw new NoOfflineDataError()

  const code = qr.trim()
  const tokenHash = await sha256Hex(code)
  const ticket = bundle.byHash[tokenHash]

  const { response, patch, enqueue } = evaluateOffline({
    ticket,
    allowReentry: bundle.meta.allowReentry,
    nowIso: now(),
  })

  if (ticket && patch) await updateOfflineTicket(eventId, tokenHash, patch)
  if (ticket && enqueue) {
    await enqueueScan({
      id: crypto.randomUUID(),
      eventId,
      ticketId: ticket.id,
      ref: response.ref,
      holderName: ticket.holderName,
      qr: code,
      scannedAt: now(),
      deviceLabel: await deviceLabel(),
    })
  }

  return response
}
