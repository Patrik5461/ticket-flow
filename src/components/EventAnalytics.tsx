import { useEffect, useState } from 'react'
import { ga4Snippet, metaPixelSnippet, purchaseSnippet } from '../lib/tracking'
import { readConsent, CONSENT_EVENT } from '../lib/consent'
import type { ConsentState } from '../lib/consent'

/**
 * Per-event analytics: injects GA4 (analytics consent) / Meta Pixel (marketing
 * consent) on an event's public pages, only after the visitor consents to that
 * category. The consent UI itself is the site-wide CookieConsent banner; this
 * component just reacts to the stored decision and (re)loads trackers. Fires a
 * Purchase conversion once per order on the paid order page.
 */
export function EventAnalytics({
  ga4Id,
  pixelId,
  purchase,
}: {
  ga4Id?: string | null
  pixelId?: string | null
  purchase?: { transactionId: string; valueEur: number } | null
}) {
  const [consent, setConsent] = useState<ConsentState | null>(null)

  useEffect(() => {
    const sync = () => setConsent(readConsent())
    sync()
    window.addEventListener(CONSENT_EVENT, sync)
    return () => window.removeEventListener(CONSENT_EVENT, sync)
  }, [])

  useEffect(() => {
    if (!consent) return
    const w = window as unknown as Record<string, boolean>

    const gaOn = Boolean(ga4Id) && consent.analytics
    const pixelOn = Boolean(pixelId) && consent.marketing

    if (gaOn && !w.__tioGaLoaded) {
      w.__tioGaLoaded = true
      const loader = document.createElement('script')
      loader.async = true
      loader.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id!)}`
      document.head.appendChild(loader)
      const cfg = document.createElement('script')
      cfg.text = ga4Snippet(ga4Id!)
      document.head.appendChild(cfg)
    }
    if (pixelOn && !w.__tioPixelLoaded) {
      w.__tioPixelLoaded = true
      const px = document.createElement('script')
      px.text = metaPixelSnippet(pixelId!)
      document.head.appendChild(px)
    }

    // Purchase: once per order (dedupe across reloads), for whichever loaded.
    if (purchase && (gaOn || pixelOn)) {
      const key = `ticketio_purchase_${purchase.transactionId}`
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, '1')
        const p = document.createElement('script')
        p.text = purchaseSnippet({
          transactionId: purchase.transactionId,
          valueEur: purchase.valueEur,
          ga4: gaOn,
          pixel: pixelOn,
        })
        document.head.appendChild(p)
      }
    }
  }, [consent, ga4Id, pixelId, purchase])

  return null
}
