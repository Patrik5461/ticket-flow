import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getCheckinBoardFn } from '../server/dashboard'

export const Route = createFileRoute('/app/events/$eventId/checkin')({
  loader: async ({ params }) => {
    const res = await getCheckinBoardFn({ data: { eventId: params.eventId } })
    if ('error' in res) throw notFound()
    return res
  },
  component: CheckinPage,
})

// Minimal signature of jsQR's default export — avoids an `import()` type
// annotation (jsQR is loaded lazily, client-only, inside the camera effect).
type JsQRFn = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' },
) => { data: string } | null

type Outcome = 'ok' | 'already_used' | 'cancelled' | 'invalid'

interface ScanResult {
  result: Outcome
  holderName: string | null
  ticketType: string | null
  usedAt: string | null
  ref: string | null
}

// How long the big result banner stays up (and scanning pauses) after a decode.
const RESULT_HOLD_MS = 2500

const OUTCOME_UI: Record<
  Outcome,
  { label: string; cls: string; icon: string }
> = {
  ok: { label: 'Vstup povolený', cls: 'bg-green-600', icon: '✓' },
  already_used: { label: 'Už použitá', cls: 'bg-amber-500', icon: '!' },
  cancelled: { label: 'Zrušená vstupenka', cls: 'bg-red-600', icon: '✕' },
  invalid: { label: 'Neplatný kód', cls: 'bg-red-600', icon: '✕' },
}

function CheckinPage() {
  const { eventId } = Route.useParams()
  const board = Route.useLoaderData()

  const [checkedIn, setCheckedIn] = useState(board.summary.checkedIn)
  const [total] = useState(board.summary.total)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [camError, setCamError] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // Guards so the RAF loop doesn't fire the same code repeatedly / while a
  // submission is in flight. Refs (not state) to stay readable inside the loop.
  const pausedUntilRef = useRef(0)
  const inFlightRef = useRef(false)
  const frameRef = useRef(0)
  const tickRef = useRef(0) // logical clock; avoids Date.now in the hot loop

  const fmtTime = useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat('sk-SK', {
        dateStyle: 'short',
        timeStyle: 'medium',
        timeZone: board.event.timezone,
      }).format(new Date(iso)),
    [board.event.timezone],
  )

  const submit = useCallback(
    async (qr: string) => {
      if (inFlightRef.current) return
      inFlightRef.current = true
      setBusy(true)
      try {
        const res = await fetch('/api/checkin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId, qr, deviceLabel: 'Webový skener' }),
        })
        if (!res.ok) {
          setResult({
            result: 'invalid',
            holderName: null,
            ticketType: null,
            usedAt: null,
            ref: null,
          })
          return
        }
        const data = (await res.json()) as ScanResult
        setResult(data)
        if (data.result === 'ok') setCheckedIn((n) => n + 1)
      } catch {
        setResult({
          result: 'invalid',
          holderName: null,
          ticketType: null,
          usedAt: null,
          ref: null,
        })
      } finally {
        inFlightRef.current = false
        setBusy(false)
        // Pause the camera loop briefly so the operator can read the banner.
        pausedUntilRef.current = tickRef.current + RESULT_HOLD_MS
      }
    },
    [eventId],
  )

  const submitManual = async (e: React.FormEvent) => {
    e.preventDefault()
    const code = manual.trim()
    if (!code || busy) return
    await submit(code)
    setManual('')
  }

  // Camera lifecycle: start on mount, tear down on unmount. jsQR is imported
  // client-only (SSR-safe — this effect never runs on the server).
  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    let lastTs = 0

    async function start() {
      if (
        typeof navigator === 'undefined' ||
        !(navigator.mediaDevices as MediaDevices | undefined)?.getUserMedia
      ) {
        setCamError('Kamera nie je v tomto prehliadači dostupná.')
        return
      }
      let jsQR: JsQRFn
      try {
        jsQR = ((await import('jsqr')) as { default: JsQRFn }).default
      } catch {
        setCamError('Nepodarilo sa načítať dekodér QR.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })
      } catch {
        setCamError(
          'Prístup ku kamere bol zamietnutý. Použite ručné zadanie kódu nižšie.',
        )
        return
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      await video.play().catch(() => {})
      setScanning(true)

      const canvas = canvasRef.current!
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!

      const loop = (ts: number) => {
        frameRef.current = requestAnimationFrame(loop)
        // Advance the logical clock by real elapsed ms so pause windows work
        // without calling Date.now() every frame.
        if (lastTs) tickRef.current += ts - lastTs
        lastTs = ts

        if (tickRef.current < pausedUntilRef.current) return
        if (inFlightRef.current) return
        if (video.readyState !== video.HAVE_ENOUGH_DATA) return

        const w = video.videoWidth
        const h = video.videoHeight
        if (!w || !h) return
        canvas.width = w
        canvas.height = h
        ctx.drawImage(video, 0, 0, w, h)
        const img = ctx.getImageData(0, 0, w, h)
        const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' })
        if (code && code.data) {
          // inFlight + the post-result pause window (set in submit) prevent the
          // same code being re-submitted on every frame while it sits in view.
          void submit(code.data)
        }
      }
      frameRef.current = requestAnimationFrame(loop)
    }

    void start()
    return () => {
      cancelled = true
      cancelAnimationFrame(frameRef.current)
      if (stream) stream.getTracks().forEach((t) => t.stop())
      setScanning(false)
    }
  }, [submit])

  const banner = result ? OUTCOME_UI[result.result] : null

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div>
        <Link
          to="/app/events/$eventId"
          params={{ eventId }}
          className="text-sm text-indigo-600 hover:underline"
        >
          ← Späť na podujatie
        </Link>
        <h1 className="mt-2 text-2xl font-bold">
          Check-in — {board.event.title}
        </h1>
      </div>

      {/* Counter */}
      <div className="flex items-center justify-between rounded-lg border bg-white p-4">
        <span className="text-sm text-gray-500">Odbavených</span>
        <span className="text-2xl font-bold tabular-nums">
          {checkedIn}
          <span className="text-base font-normal text-gray-400">
            {' '}
            / {total}
          </span>
        </span>
      </div>

      {/* Camera + result overlay */}
      <div className="relative overflow-hidden rounded-lg border bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className="aspect-square w-full object-cover"
        />
        <canvas ref={canvasRef} className="hidden" />
        {!scanning && !camError && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
            Spúšťam kameru…
          </div>
        )}
        {/* Aiming frame */}
        {scanning && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-2/3 w-2/3 rounded-lg border-4 border-white/60" />
          </div>
        )}
        {banner && (
          <div
            className={`absolute inset-0 flex flex-col items-center justify-center text-center text-white ${banner.cls}`}
          >
            <div className="text-6xl font-black leading-none">
              {banner.icon}
            </div>
            <div className="mt-3 text-2xl font-bold">{banner.label}</div>
            {result?.holderName && (
              <div className="mt-2 text-lg">{result.holderName}</div>
            )}
            {result?.ticketType && (
              <div className="text-sm text-white/80">{result.ticketType}</div>
            )}
            {result?.result === 'already_used' && result.usedAt && (
              <div className="mt-2 text-sm text-white/90">
                Prvý sken: {fmtTime(result.usedAt)}
              </div>
            )}
            {result?.ref && (
              <div className="mt-2 font-mono text-xs text-white/70">
                {result.ref}
              </div>
            )}
          </div>
        )}
      </div>

      {camError && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          {camError}
        </p>
      )}

      {/* Manual fallback */}
      <form onSubmit={submitManual} className="space-y-2">
        <label className="text-sm font-medium text-gray-700">
          Ručné zadanie kódu
        </label>
        <div className="flex gap-2">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="TIK.…"
            className="w-full rounded-md border px-3 py-2 font-mono text-sm"
          />
          <button
            type="submit"
            disabled={busy || !manual.trim()}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Overiť
          </button>
        </div>
        <p className="text-xs text-gray-400">
          Naskenujte QR kód vstupenky kamerou, alebo zadajte jeho text ručne.
        </p>
      </form>
    </div>
  )
}
