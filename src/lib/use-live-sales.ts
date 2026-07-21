/**
 * Live sales data for the organizer dashboard.
 *
 * Primary transport is an EventSource against our own server (see
 * server/sales-stream.ts for why it is SSE and not Supabase realtime). If the
 * stream cannot be established or drops — a proxy that buffers, a captive
 * portal, a flaky mobile connection — the hook falls back to polling the same
 * snapshot through a normal server fn, so the user is never left without
 * updates. It keeps retrying the stream with exponential backoff and switches
 * back the moment it works again.
 *
 * The connection is closed while the tab is hidden and on unmount, so a
 * forgotten tab does not hold a stream open.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getSalesSnapshotFn } from '../server/dashboard'
import type { SalesSnapshot } from '../server/sales-live'

export type LiveMode = 'live' | 'polling' | 'connecting'

export interface LiveSales {
  snapshot: SalesSnapshot | null
  mode: LiveMode
  /** When the last update arrived (client clock), for "Aktualizované pred X". */
  updatedAt: number | null
}

/** Polling cadence once the stream has been given up on. */
const POLL_MS = 30_000
/** Stream retry backoff: 5 s, 15 s, 45 s, capped at 2 min. */
const RETRY_MS = [5_000, 15_000, 45_000, 120_000]
/** Consecutive stream failures tolerated before switching to polling. */
const FAILURES_BEFORE_FALLBACK = 2

export function useLiveSales(
  eventId: string,
  onChange?: () => void,
): LiveSales {
  const [snapshot, setSnapshot] = useState<SalesSnapshot | null>(null)
  const [mode, setMode] = useState<LiveMode>('connecting')
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)

  // Kept in refs so the effect below can be set up once and never torn down by
  // a state change (which would reconnect the stream on every update).
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const lastSignature = useRef<string | null>(null)

  const apply = useCallback((next: SalesSnapshot) => {
    setSnapshot(next)
    setUpdatedAt(Date.now())
    // Only tell the page to reload its lists when the numbers actually moved.
    const signature = [
      next.grossCents,
      next.feeCents,
      next.paidOrderCount,
      next.ticketCount,
      next.checkedIn,
    ].join(':')
    if (lastSignature.current !== null && lastSignature.current !== signature) {
      onChangeRef.current?.()
    }
    lastSignature.current = signature
  }, [])

  useEffect(() => {
    let cancelled = false
    let source: EventSource | null = null
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let failures = 0

    const stopStream = () => {
      source?.close()
      source = null
    }
    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
    }

    const pollOnce = async () => {
      try {
        const res = await getSalesSnapshotFn({ data: { eventId } })
        if (!cancelled && !('error' in res)) apply(res)
      } catch {
        /* keep the previous numbers; the next tick may succeed */
      }
    }

    const startPolling = () => {
      if (cancelled || pollTimer) return
      setMode('polling')
      void pollOnce()
      pollTimer = setInterval(() => void pollOnce(), POLL_MS)
    }

    const scheduleRetry = () => {
      if (cancelled || retryTimer) return
      const delay = RETRY_MS[Math.min(failures - 1, RETRY_MS.length - 1)]
      retryTimer = setTimeout(() => {
        retryTimer = null
        startStream()
      }, delay)
    }

    const startStream = () => {
      if (cancelled || source || document.hidden) return
      if (typeof EventSource === 'undefined') {
        startPolling()
        return
      }
      const es = new EventSource(
        `/api/events/${encodeURIComponent(eventId)}/sales-stream`,
      )
      source = es

      es.addEventListener('snapshot', (ev: MessageEvent<string>) => {
        if (cancelled) return
        try {
          apply(JSON.parse(ev.data) as SalesSnapshot)
        } catch {
          return
        }
        // A frame arrived: the stream works, so stop polling and reset backoff.
        failures = 0
        stopPolling()
        setMode('live')
      })

      es.onerror = () => {
        // EventSource retries on its own, but a 401/403/429 closes it for good
        // and a buffering proxy can leave it "open" yet silent — so we drive the
        // recovery ourselves rather than trusting it.
        stopStream()
        failures += 1
        if (failures >= FAILURES_BEFORE_FALLBACK) startPolling()
        scheduleRetry()
      }
    }

    // Don't hold a connection open behind a hidden tab; resync on return.
    const onVisibility = () => {
      if (document.hidden) {
        stopStream()
        stopPolling()
      } else {
        void pollOnce()
        startStream()
      }
    }

    startStream()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      stopStream()
      stopPolling()
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [eventId, apply])

  return { snapshot, mode, updatedAt }
}
