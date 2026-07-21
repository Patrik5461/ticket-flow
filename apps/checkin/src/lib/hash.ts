/**
 * SHA-256 of a scanned QR string, hex-encoded — the only thing needed to match a
 * scan against the offline bundle. WKWebView / Android WebView both expose
 * WebCrypto in the app's secure context (capacitor:// and https:// schemes).
 */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
