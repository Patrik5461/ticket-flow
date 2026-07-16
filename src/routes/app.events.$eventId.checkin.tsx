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
  { label: string; color: string; icon: string }
> = {
  ok: { label: 'Vstup povolený', color: '#16a34a', icon: '✓' },
  already_used: { label: 'Už použitá', color: '#ea580c', icon: '!' },
  cancelled: { label: 'Zrušená vstupenka', color: '#dc2626', icon: '✕' },
  invalid: { label: 'Neplatný kód', color: '#dc2626', icon: '✕' },
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
  const pausedUntilRef = useRef(0)
  const inFlightRef = useRef(false)
  const frameRef = useRef(0)
  const tickRef = useRef(0)

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
    <>
      {/* Fullscreen response overlay — the whole viewport flashes green/orange/red
          so the operator can read it in direct sunlight without looking closely. */}
      {banner && (
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center px-6 text-center text-white animate-fade-up"
          style={{ background: banner.color }}
        >
          <div
            className="font-black leading-none"
            style={{ fontSize: 'clamp(8rem, 30vw, 18rem)' }}
          >
            {banner.icon}
          </div>
          <div
            className="mt-4 font-display font-bold uppercase tracking-tight"
            style={{ fontSize: 'clamp(2rem, 7vw, 4rem)' }}
          >
            {banner.label}
          </div>
          {result?.holderName && (
            <div
              className="mt-4 font-semibold"
              style={{ fontSize: 'clamp(1.25rem, 4vw, 2rem)' }}
            >
              {result.holderName}
            </div>
          )}
          {result?.ticketType && (
            <div
              className="opacity-90"
              style={{ fontSize: 'clamp(1rem, 3vw, 1.5rem)' }}
            >
              {result.ticketType}
            </div>
          )}
          {result?.result === 'already_used' && result.usedAt && (
            <div className="mt-4 text-lg opacity-90">
              Prvý sken: {fmtTime(result.usedAt)}
            </div>
          )}
          {result?.ref && (
            <div className="mt-4 font-mono text-sm opacity-75">{result.ref}</div>
          )}
        </div>
      )}

      <div className="mx-auto max-w-lg space-y-5">
        <div>
          <Link
            to="/app/events/$eventId"
            params={{ eventId }}
            className="text-sm font-medium transition hover:underline"
            style={{ color: 'var(--color-accent)' }}
          >
            ← Späť na podujatie
          </Link>
          <h1 className="mt-2 font-display text-2xl font-bold text-ink-100">
            Check-in
          </h1>
          <p className="text-sm text-ink-400">{board.event.title}</p>
        </div>

        {/* Big counter — dominates the screen so the operator sees it at a glance */}
        <div
          className="rounded-2xl p-6"
          style={{
            background: 'var(--gradient-card)',
            border: '1px solid var(--color-ink-700)',
            boxShadow: 'var(--shadow-glow)',
          }}
        >
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium uppercase tracking-widest text-ink-400">
              Odbavených
            </span>
            <span className="text-xs text-ink-500">
              {total > 0 ? Math.round((checkedIn / total) * 100) : 0}%
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span
              className="font-display font-black tabular-nums leading-none"
              style={{
                fontSize: 'clamp(3rem, 12vw, 5rem)',
                color: 'var(--color-accent)',
              }}
            >
              {checkedIn}
            </span>
            <span className="font-display text-2xl font-bold text-ink-500">
              / {total}
            </span>
          </div>
          <div
            className="mt-4 h-2 overflow-hidden rounded-full"
            style={{ background: 'var(--color-ink-800)' }}
          >
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${total > 0 ? Math.min(100, (checkedIn / total) * 100) : 0}%`,
                background:
                  'linear-gradient(90deg, var(--color-accent-dim), var(--color-accent))',
              }}
            />
          </div>
        </div>

        {/* Camera preview */}
        <div
          className="relative overflow-hidden rounded-2xl"
          style={{
            border: '1px solid var(--color-ink-700)',
            background: '#000',
          }}
        >
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
          {scanning && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className="h-2/3 w-2/3 rounded-2xl"
                style={{
                  border: '3px solid var(--color-accent)',
                  boxShadow:
                    '0 0 0 9999px rgba(0,0,0,0.35), inset 0 0 30px rgba(74,222,128,0.35)',
                }}
              />
            </div>
          )}
        </div>

        {camError && (
          <p
            className="rounded-lg p-3 text-sm"
            style={{
              border: '1px solid rgba(234, 179, 8, 0.35)',
              background: 'rgba(234, 179, 8, 0.1)',
              color: '#fcd34d',
            }}
          >
            {camError}
          </p>
        )}

        {/* Manual fallback */}
        <form onSubmit={submitManual} className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-widest text-ink-400">
            Ručné zadanie kódu
          </label>
          <div className="flex gap-2">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="TIK.…"
              className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2.5 font-mono text-sm text-ink-100 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
            <button
              type="submit"
              disabled={busy || !manual.trim()}
              className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Overiť
            </button>
          </div>
          <p className="text-xs text-ink-500">
            Naskenujte QR kód vstupenky kamerou, alebo zadajte jeho text ručne.
          </p>
        </form>
      </div>
    </>
  )
}
