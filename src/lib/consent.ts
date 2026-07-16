/**
 * Cookie consent: three categories (necessary always on, analytics, marketing).
 * Stored in localStorage; components react via a window event. The parse/migrate
 * logic is pure (parseConsent) so it can be unit-tested without a browser.
 */

export interface ConsentState {
  analytics: boolean
  marketing: boolean
  ts: number
}

export const CONSENT_KEY = 'ticketio_consent_v2'
const LEGACY_KEY = 'ticketio_consent'
/** Fired after consent changes so trackers can (re)evaluate. */
export const CONSENT_EVENT = 'ticketio-consent-changed'
/** Fired to (re)open the consent settings panel from anywhere. */
export const OPEN_CONSENT_EVENT = 'ticketio-open-consent'

/** Pure: derive consent from the stored JSON + the legacy granted/denied flag. */
export function parseConsent(
  raw: string | null,
  legacy: string | null,
): ConsentState | null {
  if (raw) {
    try {
      const p = JSON.parse(raw) as Partial<ConsentState>
      if (
        typeof p.analytics === 'boolean' &&
        typeof p.marketing === 'boolean'
      ) {
        return {
          analytics: p.analytics,
          marketing: p.marketing,
          ts: typeof p.ts === 'number' ? p.ts : 0,
        }
      }
    } catch {
      // fall through to legacy / null
    }
  }
  if (legacy === 'granted') return { analytics: true, marketing: true, ts: 0 }
  if (legacy === 'denied') return { analytics: false, marketing: false, ts: 0 }
  return null
}

export function readConsent(): ConsentState | null {
  if (typeof localStorage === 'undefined') return null
  return parseConsent(
    localStorage.getItem(CONSENT_KEY),
    localStorage.getItem(LEGACY_KEY),
  )
}

export function writeConsent(c: {
  analytics: boolean
  marketing: boolean
}): void {
  if (typeof localStorage === 'undefined') return
  const state: ConsentState = {
    analytics: c.analytics,
    marketing: c.marketing,
    ts: Date.now(),
  }
  localStorage.setItem(CONSENT_KEY, JSON.stringify(state))
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT))
}

export function openConsentSettings(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OPEN_CONSENT_EVENT))
  }
}
