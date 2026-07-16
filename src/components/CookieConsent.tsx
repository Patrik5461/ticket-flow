import { useEffect, useState } from 'react'
import { readConsent, writeConsent, OPEN_CONSENT_EVENT } from '../lib/consent'

/**
 * Site-wide cookie consent banner. Shows until the visitor decides; can be
 * reopened via openConsentSettings() (e.g. from the /cookies page). Necessary
 * cookies are always on; analytics + marketing are opt-in and gate the trackers
 * in EventAnalytics. Renders nothing during SSR/first paint to avoid hydration
 * mismatch.
 */
export function CookieConsent() {
  const [visible, setVisible] = useState(false)
  const [customizing, setCustomizing] = useState(false)
  const [analytics, setAnalytics] = useState(true)
  const [marketing, setMarketing] = useState(true)

  useEffect(() => {
    if (!readConsent()) setVisible(true)
    const open = () => {
      const cur = readConsent()
      setAnalytics(cur?.analytics ?? true)
      setMarketing(cur?.marketing ?? true)
      setCustomizing(true)
      setVisible(true)
    }
    window.addEventListener(OPEN_CONSENT_EVENT, open)
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, open)
  }, [])

  if (!visible) return null

  const save = (a: boolean, m: boolean) => {
    writeConsent({ analytics: a, marketing: m })
    setVisible(false)
    setCustomizing(false)
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[100] border-t border-ink-800 p-4 shadow-2xl backdrop-blur-xl"
      style={{
        background: 'color-mix(in oklab, var(--color-ink-950) 90%, transparent)',
      }}
    >
      <div className="mx-auto max-w-3xl text-sm text-ink-300">
        {!customizing ? (
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p>
              Používame cookies. Nutné sú vždy zapnuté; analytické a
              marketingové použijeme len s vaším súhlasom.{' '}
              <a href="/cookies" className="text-accent underline">
                Viac o cookies
              </a>
              .
            </p>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                onClick={() => save(false, false)}
                className="rounded-md border border-ink-700 px-3 py-1.5 text-ink-200 transition hover:bg-ink-800"
              >
                Odmietnuť
              </button>
              <button
                onClick={() => setCustomizing(true)}
                className="rounded-md border border-ink-700 px-3 py-1.5 text-ink-200 transition hover:bg-ink-800"
              >
                Nastaviť
              </button>
              <button
                onClick={() => save(true, true)}
                className="rounded-md bg-accent px-3 py-1.5 font-semibold text-ink-950 transition hover:brightness-110"
              >
                Prijať všetko
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="font-display font-semibold text-ink-100">
              Nastavenia cookies
            </div>
            <label className="flex items-start gap-2 opacity-60">
              <input type="checkbox" checked disabled className="mt-0.5 accent-accent" />
              <span>
                <strong className="text-ink-100">Nutné</strong> — potrebné pre chod stránky (prihlásenie,
                košík). Vždy aktívne.
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
                className="mt-0.5 accent-accent"
              />
              <span>
                <strong className="text-ink-100">Analytické</strong> — meranie návštevnosti (Google
                Analytics).
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={marketing}
                onChange={(e) => setMarketing(e.target.checked)}
                className="mt-0.5 accent-accent"
              />
              <span>
                <strong className="text-ink-100">Marketingové</strong> — remarketing a konverzie (Meta
                Pixel).
              </span>
            </label>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button
                onClick={() => save(false, false)}
                className="rounded-md border border-ink-700 px-3 py-1.5 text-ink-200 transition hover:bg-ink-800"
              >
                Odmietnuť všetko
              </button>
              <button
                onClick={() => save(analytics, marketing)}
                className="rounded-md bg-accent px-3 py-1.5 font-semibold text-ink-950 transition hover:brightness-110"
              >
                Uložiť voľbu
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
