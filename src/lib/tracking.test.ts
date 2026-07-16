import { describe, it, expect } from 'vitest'
import { ga4Snippet, metaPixelSnippet, purchaseSnippet } from './tracking'

describe('ga4Snippet', () => {
  it('configures the given measurement id', () => {
    const s = ga4Snippet('G-ABC123')
    expect(s).toContain('gtag')
    expect(s).toContain('"G-ABC123"')
  })
})

describe('metaPixelSnippet', () => {
  it('inits the pixel and tracks a PageView', () => {
    const s = metaPixelSnippet('99887766')
    expect(s).toContain('fbq(\'init\',"99887766")')
    expect(s).toContain("fbq('track','PageView')")
    expect(s).toContain('connect.facebook.net')
  })
})

describe('purchaseSnippet', () => {
  it('fires both GA4 and Pixel purchase with the value', () => {
    const s = purchaseSnippet({
      transactionId: 'ord-1',
      valueEur: 15.5,
      ga4: true,
      pixel: true,
    })
    expect(s).toContain("gtag('event','purchase'")
    expect(s).toContain('transaction_id:"ord-1"')
    expect(s).toContain('value:15.5')
    expect(s).toContain("fbq('track','Purchase'")
  })

  it('only includes the enabled providers, and guards a non-finite value', () => {
    const g = purchaseSnippet({
      transactionId: 'x',
      valueEur: NaN,
      ga4: true,
      pixel: false,
    })
    expect(g).toContain('gtag')
    expect(g).not.toContain('fbq')
    expect(g).toContain('value:0')
  })
})
