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
    <div className="fixed inset-x-0 bottom-0 z-[100] border-t border-gray-200 bg-white/95 p-4 shadow-2xl backdrop-blur">
      <div className="mx-auto max-w-3xl text-sm text-gray-700">
        {!customizing ? (
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p>
              Používame cookies. Nutné sú vždy zapnuté; analytické a
              marketingové použijeme len s vaším súhlasom.{' '}
              <a href="/cookies" className="text-indigo-600 underline">
                Viac o cookies
              </a>
              .
            </p>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                onClick={() => save(false, false)}
                className="rounded-md border px-3 py-1.5 hover:bg-gray-50"
              >
                Odmietnuť
              </button>
              <button
                onClick={() => setCustomizing(true)}
                className="rounded-md border px-3 py-1.5 hover:bg-gray-50"
              >
                Nastaviť
              </button>
              <button
                onClick={() => save(true, true)}
                className="rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700"
              >
                Prijať všetko
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="font-semibold text-gray-900">
              Nastavenia cookies
            </div>
            <label className="flex items-start gap-2 opacity-70">
              <input type="checkbox" checked disabled className="mt-0.5" />
              <span>
                <strong>Nutné</strong> — potrebné pre chod stránky (prihlásenie,
                košík). Vždy aktívne.
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <strong>Analytické</strong> — meranie návštevnosti (Google
                Analytics).
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={marketing}
                onChange={(e) => setMarketing(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <strong>Marketingové</strong> — remarketing a konverzie (Meta
                Pixel).
              </span>
            </label>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button
                onClick={() => save(false, false)}
                className="rounded-md border px-3 py-1.5 hover:bg-gray-50"
              >
                Odmietnuť všetko
              </button>
              <button
                onClick={() => save(analytics, marketing)}
                className="rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700"
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
