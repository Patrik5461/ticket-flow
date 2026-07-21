import { dismissConflicts, runSync, type SyncConflict } from '../lib/sync'
import { useOnline, useSync } from '../lib/use-sync'
import { formatAge } from '../lib/format'

const CONFLICT_REASON: Record<string, string> = {
  already_used: 'medzitým už použitá inde',
  cancelled: 'vstupenka bola zrušená',
  invalid: 'server ju neuznal',
  unknown: 'server ju nepozná',
}

/**
 * Connectivity + queue status, with the conflict report.
 *
 * A conflict means the offline device admitted someone whose ticket had already
 * been used online or on another phone. That must never be swallowed — the
 * report names the tickets and stays until the operator acknowledges it.
 */
export function SyncBar() {
  const online = useOnline()
  const { running, pending, progress, lastSyncAt, conflicts, error } = useSync()

  const idle = online && pending === 0 && !running && !error
  if (idle && conflicts.length === 0) return null

  return (
    <div className="sync-wrap">
      <div className="sync-bar">
        <span className={online ? 'sync-dot online' : 'sync-dot offline'} />
        <span className="sync-text">
          {running
            ? `Odosielam ${progress?.done ?? 0} / ${progress?.total ?? 0}…`
            : !online
              ? pending > 0
                ? `Offline · ${pending} čaká na odoslanie`
                : 'Offline · skenuje sa z lokálnych dát'
              : pending > 0
                ? `${pending} skenov čaká na odoslanie`
                : lastSyncAt
                  ? `Odoslané ${formatAge(lastSyncAt)}`
                  : 'Online'}
        </span>
        {online && pending > 0 && !running && (
          <button className="offline-btn" onClick={() => void runSync()}>
            ↑ Synchronizovať
          </button>
        )}
      </div>

      {error && <div className="sync-error">{error}</div>}

      {conflicts.length > 0 && (
        <div className="sync-conflicts">
          <div className="sync-conflicts-title">
            Pri synchronizácii:{' '}
            {conflicts.length === 1
              ? '1 vstupenka bola už použitá inde'
              : `${conflicts.length} vstupeniek bolo už použitých inde`}
          </div>
          <ul className="sync-conflict-list">
            {conflicts.map((c: SyncConflict, i: number) => (
              <li key={`${c.ticketId}-${i}`}>
                <span className="mono">{c.ref ?? c.ticketId.slice(0, 8)}</span>
                {c.holderName ? ` · ${c.holderName}` : ''}
                <span className="sync-conflict-reason">
                  {' '}
                  — {CONFLICT_REASON[c.result] ?? c.result}
                </span>
              </li>
            ))}
          </ul>
          <button
            className="offline-btn"
            onClick={() => void dismissConflicts()}
          >
            Rozumiem
          </button>
        </div>
      )}
    </div>
  )
}
