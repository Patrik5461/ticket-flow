import { useState } from 'react'
import {
  downloadOffline,
  deleteOffline,
  shouldWarnMultiDevice,
  type OfflineMeta,
} from '../lib/offline'
import { formatSynced, STALE_AFTER_MS } from '../lib/format'
import { AuthError } from '../lib/api'
import { OfflineNoticeModal } from './OfflineNotice'

/**
 * Offline strip under an event card: download / refresh / delete the local
 * ticket list, with progress and a clearly visible "last updated" stamp — door
 * staff must be able to tell how old their data is.
 */
export function OfflineRow({
  eventId,
  timezone,
  meta,
  onChange,
}: {
  eventId: string
  timezone: string
  meta: OfflineMeta | null
  onChange: () => void
}) {
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [notice, setNotice] = useState(false)

  const busy = progress !== null

  const run = async () => {
    if (busy) return
    setError(null)
    setDone(false)
    setProgress(0)
    try {
      await downloadOffline(eventId, setProgress)
      setDone(true)
      onChange()
      // Once per event: warn that offline devices can't see each other.
      if (await shouldWarnMultiDevice(eventId)) setNotice(true)
    } catch (e) {
      setError(
        e instanceof AuthError
          ? 'Vypršalo prihlásenie — prihlás sa znova.'
          : 'Sťahovanie zlyhalo. Skontroluj pripojenie.',
      )
    } finally {
      setProgress(null)
    }
  }

  const remove = async () => {
    if (busy) return
    await deleteOffline(eventId)
    setDone(false)
    onChange()
  }

  if (busy) {
    const pct = Math.round((progress ?? 0) * 100)
    return (
      <div className="offline-row">
        <div className="offline-info">Sťahujem offline dáta… {pct} %</div>
        <div className="progress" style={{ marginTop: 8 }}>
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }

  if (!meta) {
    return (
      <div className="offline-row">
        <div className="offline-info">
          {error ?? 'Bez offline dát — skener vyžaduje internet.'}
        </div>
        <button className="offline-btn" onClick={() => void run()}>
          ↓ Stiahnuť pre offline
        </button>
      </div>
    )
  }

  const stale = Date.now() - Date.parse(meta.syncedAt) > STALE_AFTER_MS

  return (
    <div className="offline-row">
      <div className="offline-info">
        <span className="offline-ok">
          {done ? '✓ Pripravené na offline' : '✓ Offline pripravené'}
        </span>
        <span className="offline-count">{meta.ticketCount} vstupeniek</span>
        <span className={stale ? 'offline-stale' : 'offline-when'}>
          {formatSynced(meta.syncedAt, timezone)}
        </span>
        {error && <span className="offline-stale">{error}</span>}
      </div>
      <div className="offline-actions">
        <button className="offline-btn" onClick={() => void run()}>
          ↻ Aktualizovať
        </button>
        <button className="offline-btn ghost" onClick={() => void remove()}>
          Zmazať
        </button>
      </div>
      {notice && <OfflineNoticeModal onClose={() => setNotice(false)} />}
    </div>
  )
}
