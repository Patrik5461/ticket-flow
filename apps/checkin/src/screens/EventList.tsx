import { useEffect, useState } from 'react'
import { loadEvents } from '../lib/events'
import { formatWhen } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { EventRow } from '../lib/types'

/** Screen 2 — the events this member can access. Tap one to open the scanner. */
export function EventList({ onPick }: { onPick: (event: EventRow) => void }) {
  const [events, setEvents] = useState<EventRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => {
    setError(null)
    loadEvents()
      .then(setEvents)
      .catch(() => setError('Nepodarilo sa načítať podujatia.'))
  }

  useEffect(refresh, [])

  return (
    <div className="screen safe">
      <header className="topbar">
        <span className="brand-mark" style={{ fontSize: 18 }}>
          ticket<span className="accent">io</span>
          <span className="brand-sub-inline">Scan</span>
        </span>
        <button className="linkbtn" onClick={() => void supabase.auth.signOut()}>
          Odhlásiť
        </button>
      </header>

      <main style={{ padding: '8px 16px 24px' }}>
        <h1 className="h1">Podujatia</h1>

        {error && (
          <div className="notice">
            {error}{' '}
            <button className="linkbtn" onClick={refresh}>
              Skúsiť znova
            </button>
          </div>
        )}

        {!events && !error && <p className="hint">Načítavam…</p>}

        {events && events.length === 0 && (
          <p className="hint">Zatiaľ nemáš prístup k žiadnemu podujatiu.</p>
        )}

        <ul className="list">
          {events?.map((e) => {
            const pct = e.total > 0 ? Math.round((e.checkedIn / e.total) * 100) : 0
            return (
              <li key={e.id}>
                <button className="event-card" onClick={() => onPick(e)}>
                  <div className="event-title">{e.title}</div>
                  <div className="event-meta">
                    {formatWhen(e.startsAt, e.timezone)}
                    {e.venueName ? ` · ${e.venueName}` : ''}
                  </div>
                  <div className="event-counts">
                    <span className="count-num">{e.checkedIn}</span>
                    <span className="count-total"> / {e.total} odbavených</span>
                    <span className="count-pct">{pct}%</span>
                  </div>
                  <div className="progress">
                    <div
                      className="progress-fill"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </main>
    </div>
  )
}
