import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning'
import { checkinScan, AuthError } from '../lib/api'
import { supabase } from '../lib/supabase'
import { formatTime } from '../lib/format'
import type { EventRow, Outcome, ScanResult } from '../lib/types'

// Same hold for every outcome (success and error) — matches the web scanner.
const RESULT_HOLD_MS = 3000

const OUTCOME: Record<Outcome, { label: string; color: string; icon: string }> = {
  ok: { label: 'Vstup povolený', color: 'var(--ok)', icon: '✓' },
  already_used: { label: 'Už použitá', color: 'var(--warn)', icon: '!' },
  cancelled: { label: 'Zrušená vstupenka', color: 'var(--bad)', icon: '✕' },
  invalid: { label: 'Neplatný kód', color: 'var(--bad)', icon: '✕' },
}

const isNative = Capacitor.isNativePlatform()

/** Screen 3 — the scanner. */
export function Scanner({ event, onBack }: { event: EventRow; onBack: () => void }) {
  const [checkedIn, setCheckedIn] = useState(event.checkedIn)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [remainingMs, setRemainingMs] = useState(0)
  const [paused, setPaused] = useState(false)
  const [camError, setCamError] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState(false)

  const haltRef = useRef(false)
  const pausedRef = useRef(false)
  const remRef = useRef(0)
  const inFlightRef = useRef(false)

  const showResult = useCallback((data: ScanResult) => {
    haltRef.current = true
    pausedRef.current = false
    setPaused(false)
    remRef.current = RESULT_HOLD_MS
    setRemainingMs(RESULT_HOLD_MS)
    setResult(data)
    if (data.result === 'ok') setCheckedIn((n) => n + 1)
  }, [])

  const submit = useCallback(
    async (qr: string) => {
      if (inFlightRef.current || haltRef.current) return
      inFlightRef.current = true
      setBusy(true)
      try {
        showResult(await checkinScan(event.id, qr))
      } catch (e) {
        if (e instanceof AuthError) {
          // Session gone → back to login.
          void supabase.auth.signOut()
          return
        }
        // Network/offline etc. — online-only in Block 2 (offline lands in Block 3).
        showResult({
          result: 'invalid',
          holderName: null,
          ticketType: null,
          usedAt: null,
          ref: null,
          seat: null,
        })
      } finally {
        inFlightRef.current = false
        setBusy(false)
      }
    },
    [event.id, showResult],
  )

  const dismiss = useCallback(() => {
    haltRef.current = false
    pausedRef.current = false
    setPaused(false)
    setResult(null)
    setRemainingMs(0)
  }, [])

  const togglePause = useCallback(() => {
    pausedRef.current = !pausedRef.current
    setPaused(pausedRef.current)
  }, [])

  // Auto-return countdown (2s ok / 4s error), pausable via ref.
  useEffect(() => {
    if (!result) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = now - last
      last = now
      if (!pausedRef.current) {
        remRef.current = Math.max(0, remRef.current - dt)
        setRemainingMs(remRef.current)
        if (remRef.current <= 0) {
          dismiss()
          return
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [result, dismiss])

  // Native continuous scanning behind a transparent webview. The camera stream
  // is never stopped between scans — decoding is gated by haltRef — so scanning
  // resumes instantly and never freezes across cycles.
  useEffect(() => {
    if (!isNative) return
    let listenerRemove: (() => void) | undefined
    async function start() {
      try {
        const perm = await BarcodeScanner.requestPermissions()
        if (perm.camera !== 'granted' && perm.camera !== 'limited') {
          setCamError('Kamera nie je povolená. Povoľ ju v nastaveniach zariadenia.')
          return
        }
        document.documentElement.classList.add('scanning')
        const handle = await BarcodeScanner.addListener(
          'barcodesScanned',
          (ev) => {
            if (haltRef.current || inFlightRef.current) return
            const raw = ev.barcodes[0]?.rawValue
            if (raw) void submit(raw)
          },
        )
        listenerRemove = () => void handle.remove()
        await BarcodeScanner.startScan()
      } catch {
        setCamError('Skener sa nepodarilo spustiť.')
      }
    }
    void start()
    return () => {
      document.documentElement.classList.remove('scanning')
      listenerRemove?.()
      void BarcodeScanner.stopScan().catch(() => {})
    }
  }, [submit])

  const submitManual = async (e: React.FormEvent) => {
    e.preventDefault()
    const code = manual.trim()
    if (!code || busy) return
    await submit(code)
    setManual('')
  }

  const banner = result ? OUTCOME[result.result] : null
  const holdTotal = RESULT_HOLD_MS

  return (
    <div className="screen scanner">
      {/* Top chrome: counter + back. Sits over the live camera on device. */}
      <header className="scan-top">
        <button className="chip" onClick={onBack}>
          ← Podujatia
        </button>
        <span className="chip counter">
          <b>{checkedIn}</b> / {event.total}
        </span>
      </header>

      {/* Viewfinder guide (device) or manual entry (web/dev). */}
      <div className="scan-body">
        {isNative ? (
          camError ? (
            <p className="notice">{camError}</p>
          ) : (
            <div className="viewfinder" />
          )
        ) : (
          <form onSubmit={submitManual} className="manual">
            <p className="hint">
              Na zariadení sa spustí natívna kamera. Vo vývoji zadaj kód ručne:
            </p>
            <input
              className="field"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="TIK.…"
              autoCapitalize="none"
              autoCorrect="off"
            />
            <button
              type="submit"
              className="btn-primary"
              style={{ width: '100%', minHeight: 56, marginTop: 12 }}
              disabled={busy || !manual.trim()}
            >
              Overiť
            </button>
          </form>
        )}
      </div>

      <p className="scan-hint">{event.title}</p>

      {/* Fullscreen colour response. */}
      {banner && result && (
        <div className="result" style={{ background: banner.color }}>
          <div className="result-center">
            <div className="result-icon">{banner.icon}</div>
            <div className="result-label">{banner.label}</div>
            {result.holderName && <div className="result-name">{result.holderName}</div>}
            {result.ticketType && <div className="result-type">{result.ticketType}</div>}
            {result.seat && <div className="result-seat">🪑 {result.seat}</div>}
            {result.result === 'already_used' && result.usedAt && (
              <div className="result-sub">
                Prvý sken: {formatTime(result.usedAt, event.timezone)}
              </div>
            )}
            {result.ref && <div className="result-ref">{result.ref}</div>}
          </div>

          <div className="result-controls">
            <div className="result-countdown">
              {paused
                ? 'Pozastavené'
                : `Automaticky pokračujem o ${Math.ceil(remainingMs / 1000)} s`}
            </div>
            <div className="countbar">
              <div
                className="countbar-fill"
                style={{
                  width: `${(remainingMs / holdTotal) * 100}%`,
                  opacity: paused ? 0.4 : 1,
                }}
              />
            </div>
            <button
              className="result-btn primary"
              onClick={dismiss}
              style={{ color: banner.color }}
            >
              Skenovať ďalší
            </button>
            <button className="result-btn ghost" onClick={togglePause}>
              {paused ? '▶ Pokračovať v odpočte' : '⏸ Zostať'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
