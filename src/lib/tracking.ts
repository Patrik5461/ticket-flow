/**
 * Analytics snippet builders (GA4 + Meta Pixel). Pure string generators, so they
 * are unit-testable; the EventAnalytics component injects them as <script> tags on
 * an event's public pages after cookie consent.
 */

/** Inline GA4 config (the gtag.js loader is added as a separate <script src>). */
export function ga4Snippet(measurementId: string): string {
  return (
    `window.dataLayer=window.dataLayer||[];` +
    `function gtag(){dataLayer.push(arguments);}window.gtag=gtag;` +
    `gtag('js',new Date());gtag('config',${JSON.stringify(measurementId)});`
  )
}

/** Full Meta Pixel init (loads fbevents.js itself) + a PageView. */
export function metaPixelSnippet(pixelId: string): string {
  return (
    `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?` +
    `n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;` +
    `n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;` +
    `t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}` +
    `(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');` +
    `fbq('init',${JSON.stringify(pixelId)});fbq('track','PageView');`
  )
}

/** Purchase conversion for GA4 and/or Meta Pixel. Value is in EUR (major units). */
export function purchaseSnippet(args: {
  transactionId: string
  valueEur: number
  ga4: boolean
  pixel: boolean
}): string {
  const value = Number.isFinite(args.valueEur) ? args.valueEur : 0
  const parts: string[] = []
  if (args.ga4) {
    parts.push(
      `if(window.gtag)gtag('event','purchase',{transaction_id:${JSON.stringify(args.transactionId)},value:${value},currency:'EUR'});`,
    )
  }
  if (args.pixel) {
    parts.push(
      `if(window.fbq)fbq('track','Purchase',{value:${value},currency:'EUR'});`,
    )
  }
  return parts.join('')
}
