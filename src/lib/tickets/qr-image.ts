/**
 * QR image generation. Server-side (uses the `qrcode` lib, SSR-safe). We do NOT
 * use jsPDF / html2canvas here (see CLAUDE.md) — those are client-only.
 */

import QRCode from 'qrcode'

const OPTS = { errorCorrectionLevel: 'M', margin: 1, width: 320 } as const

/** PNG as a data: URL, for inlining directly in an email body or <img src>. */
export function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, OPTS)
}

/** PNG bytes, for embedding into a PDF or as an attachment. */
export async function qrPngBytes(text: string): Promise<Uint8Array> {
  const buf = await QRCode.toBuffer(text, { ...OPTS, type: 'png' })
  return new Uint8Array(buf)
}
