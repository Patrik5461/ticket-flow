/**
 * Server-Sent Events stream of the live sales snapshot.
 *
 * WHY SSE AND NOT SUPABASE REALTIME IN THE BROWSER: this app's auth is
 * cookie-based (httpOnly) and the browser deliberately holds no Supabase token.
 * A browser postgres_changes subscription would connect anonymously and RLS
 * would hand it nothing, so making it work would mean exposing an access token
 * to JavaScript — a token with the user's full RLS rights over every table.
 * Instead the browser opens an EventSource against our own server, authorized by
 * the SAME cookie and the SAME organizer/event ownership checks as everything
 * else, and the server does the reading.
 *
 * WHY POLLING THE DB AND NOT A SERVER-SIDE REALTIME SUBSCRIPTION: for a few
 * dozen concurrent organizers a shared 4-second aggregate query per WATCHED
 * EVENT is both cheaper and far simpler than maintaining a persistent websocket
 * to Supabase with its own reconnect/fan-out logic. All viewers of one event
 * share a single poller, so ten people watching one event cost one query per
 * tick. If this ever needs sub-second latency the source can be swapped without
 * touching the client.
 *
 * Server-only.
 */
import type { SalesSnapshot } from './sales-live'
import { snapshotSignature } from './sales-live'

/** How often a watched event is re-read. */
export const POLL_MS = 4000
/** Comment line keeping proxies (nginx / HAProxy) from idling the connection out. */
export const HEARTBEAT_MS = 20000
/**
 * Streams are recycled instead of living forever; EventSource reconnects on its
 * own, so this is invisible to the user but bounds server-side resources.
 */
export const MAX_STREAM_MS = 15 * 60 * 1000
/** Guard against a runaway client opening tabs without bound. */
export const MAX_STREAMS_PER_ORGANIZER = 5

export interface StreamDeps {
  resolveUserId: (request: Request) => Promise<string | null>
  organizerIdForUser: (userId: string) => Promise<string | null>
  /** Null = the event does not belong to this organizer. */
  loadSnapshot: (
    eventId: string,
    organizerId: string,
  ) => Promise<SalesSnapshot | null>
  /** Overridable for tests. */
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
}

// ---------------------------------------------------------------------------
// One poller per watched event, shared by every subscriber of that event.
// ---------------------------------------------------------------------------

type Subscriber = (snapshot: SalesSnapshot) => void

interface Watch {
  subscribers: Set<Subscriber>
  timer: unknown
  lastSignature: string | null
}

const watches = new Map<string, Watch>()
const perOrganizer = new Map<string, number>()

/** Test seam — drops all state between cases. */
export function resetStreamState(): void {
  for (const w of watches.values()) globalThis.clearInterval(w.timer as never)
  watches.clear()
  perOrganizer.clear()
}

export function activeStreamCount(organizerId?: string): number {
  if (organizerId) return perOrganizer.get(organizerId) ?? 0
  let total = 0
  for (const n of perOrganizer.values()) total += n
  return total
}

function subscribe(
  eventId: string,
  organizerId: string,
  deps: StreamDeps,
  onSnapshot: Subscriber,
  /**
   * Signature of the snapshot the caller already sent to this subscriber. It
   * seeds a NEW watch so the first tick does not re-send identical numbers.
   */
  seedSignature: string,
): () => void {
  const key = `${organizerId}:${eventId}`
  const setTimer = deps.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms))
  const clearTimer = deps.clearInterval ?? ((h) => globalThis.clearInterval(h as never))

  let watch = watches.get(key)
  if (!watch) {
    const created: Watch = {
      subscribers: new Set(),
      timer: null,
      lastSignature: seedSignature,
    }
    created.timer = setTimer(() => {
      void (async () => {
        const snapshot = await deps.loadSnapshot(eventId, organizerId)
        // Ownership revoked mid-stream (event moved/deleted) — drop everyone.
        if (!snapshot) {
          for (const s of created.subscribers) s({ ...EMPTY, at: new Date().toISOString() })
          return
        }
        const signature = snapshotSignature(snapshot)
        if (signature === created.lastSignature) return
        created.lastSignature = signature
        for (const s of created.subscribers) s(snapshot)
      })()
    }, POLL_MS)
    watches.set(key, created)
    watch = created
  }

  watch.subscribers.add(onSnapshot)
  perOrganizer.set(organizerId, (perOrganizer.get(organizerId) ?? 0) + 1)

  return () => {
    const current = watches.get(key)
    if (current) {
      current.subscribers.delete(onSnapshot)
      // Last viewer left — stop reading the database for this event.
      if (current.subscribers.size === 0) {
        clearTimer(current.timer)
        watches.delete(key)
      }
    }
    const left = (perOrganizer.get(organizerId) ?? 1) - 1
    if (left <= 0) perOrganizer.delete(organizerId)
    else perOrganizer.set(organizerId, left)
  }
}

const EMPTY: SalesSnapshot = {
  grossCents: 0,
  feeCents: 0,
  netCents: 0,
  paidOrderCount: 0,
  ticketCount: 0,
  checkedIn: 0,
  at: '',
}

const json = (body: unknown, status: number) => Response.json(body, { status })

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function handleSalesStream(
  request: Request,
  eventId: string,
  deps: StreamDeps,
): Promise<Response> {
  const userId = await deps.resolveUserId(request)
  if (!userId) return json({ error: 'Neprihlásený.' }, 401)

  const organizerId = await deps.organizerIdForUser(userId)
  if (!organizerId) return json({ error: 'Bez organizátora.' }, 403)

  // Ownership is checked before a single byte is streamed.
  const first = await deps.loadSnapshot(eventId, organizerId)
  if (!first) return json({ error: 'Bez oprávnenia.' }, 403)

  if (activeStreamCount(organizerId) >= MAX_STREAMS_PER_ORGANIZER) {
    return json({ error: 'Príliš veľa otvorených spojení.' }, 429)
  }

  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | undefined
  let heartbeat: ReturnType<typeof globalThis.setInterval> | undefined
  let lifetime: ReturnType<typeof globalThis.setTimeout> | undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const send = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          closed = true
        }
      }
      const cleanup = () => {
        if (closed) return
        closed = true
        unsubscribe?.()
        if (heartbeat) globalThis.clearInterval(heartbeat)
        if (lifetime) globalThis.clearTimeout(lifetime)
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }

      // Reconnect delay the browser should use (also applied after MAX_STREAM_MS).
      send(`retry: 5000\n\n`)
      send(sseFrame('snapshot', first))

      unsubscribe = subscribe(
        eventId,
        organizerId,
        deps,
        (snapshot) => send(sseFrame('snapshot', snapshot)),
        snapshotSignature(first),
      )

      heartbeat = globalThis.setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS)
      lifetime = globalThis.setTimeout(cleanup, MAX_STREAM_MS)

      // The browser navigating away / closing the tab aborts the request.
      request.signal.addEventListener('abort', cleanup)
    },
    cancel() {
      unsubscribe?.()
      if (heartbeat) globalThis.clearInterval(heartbeat)
      if (lifetime) globalThis.clearTimeout(lifetime)
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform',
      Connection: 'keep-alive',
      // Tells nginx not to buffer this response (SSE would arrive in chunks).
      'X-Accel-Buffering': 'no',
    },
  })
}
