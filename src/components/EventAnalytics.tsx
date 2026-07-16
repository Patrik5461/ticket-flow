import { useEffect, useState } from 'react'
import { ga4Snippet, metaPixelSnippet, purchaseSnippet } from '../lib/tracking'

/**
 * Per-event analytics: injects GA4 / Meta Pixel on an event's public pages, but
 * only after cookie consent. Renders a simple consent bar until the visitor
 * decides. Fires a Purchase conversion once per order on the paid order page.
 *
 * Consent is stored in localStorage ('ticketio_consent' = granted|denied). The
 * full cookie policy / categorised consent lands in Phase 10.
 */
const CONSENT_KEY = 'ticketio_consent'

export function EventAnalytics({
  ga4Id,
  pixelId,
  purchase,
}: {
  ga4Id?: string | null
  pixelId?: string | null
  purchase?: { transactionId: string; valueEur: number } | null
}) {
  const hasTracking = Boolean(ga4Id || pixelId)
  const [consent, setConsent] = useState<'granted' | 'denied' | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem(CONSENT_KEY)
    if (stored === 'granted' || stored === 'denied') setConsent(stored)
  }, [])

  useEffect(() => {
    if (consent !== 'granted' || !hasTracking) return
    const w = window as unknown as Record<string, boolean>
    if (!w.__ticketioTrackingLoaded) {
      w.__ticketioTrackingLoaded = true
      if (ga4Id) {
        const loader = document.createElement('script')
        loader.async = true
        loader.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id)}`
        document.head.appendChild(loader)
        const cfg = document.createElement('script')
        cfg.text = ga4Snippet(ga4Id)
        document.head.appendChild(cfg)
      }
      if (pixelId) {
        const px = document.createElement('script')
        px.text = metaPixelSnippet(pixelId)
        document.head.appendChild(px)
      }
    }

    // Purchase: once per order (dedupe across reloads).
    if (purchase) {
      const key = `ticketio_purchase_${purchase.transactionId}`
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, '1')
        const p = document.createElement('script')
        p.text = purchaseSnippet({
          transactionId: purchase.transactionId,
          valueEur: purchase.valueEur,
          ga4: Boolean(ga4Id),
          pixel: Boolean(pixelId),
        })
        document.head.appendChild(p)
      }
    }
  }, [consent, hasTracking, ga4Id, pixelId, purchase])

  const decide = (value: 'granted' | 'denied') => {
    localStorage.setItem(CONSENT_KEY, value)
    setConsent(value)
  }

  if (!hasTracking || consent !== null) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white/95 p-4 shadow-lg backdrop-blur">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-sm sm:flex-row sm:justify-between">
        <p className="text-gray-700">
          Používame analytické cookies, aby sme zlepšovali predaj vstupeniek.
          Súhlasíte?
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => decide('denied')}
            className="rounded-md border px-3 py-1.5 text-gray-700 hover:bg-gray-50"
          >
            Odmietnuť
          </button>
          <button
            onClick={() => decide('granted')}
            className="rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700"
          >
            Súhlasím
          </button>
        </div>
      </div>
    </div>
  )
}
