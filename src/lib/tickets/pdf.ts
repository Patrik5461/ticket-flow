/**
 * Server-side ticket PDF. Uses pdf-lib (SSR-safe) + the QR PNG. One page per
 * ticket. Client-side "download as image/PDF" flows, if added later, must use a
 * dynamic client-only import per CLAUDE.md — this module is the server path.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { qrPngBytes } from './qr-image'
import { parseHexColor } from './branding'
import type { ImageKind } from './branding'

export interface TicketPdfData {
  eventTitle: string
  venue?: string | null
  startsAtLabel: string
  ticketTypeName: string
  holderName?: string | null
  /** Numbered seat label, e.g. "Sektor A · rad 3 · miesto 12". */
  seatLabel?: string | null
  /** Short human ref, e.g. ticket id prefix. */
  ticketRef: string
  /** The signed QR token (TIK.{id}.{sig}). */
  qrToken: string
  /** Organizer accent color as `#rrggbb`; falls back to the default wordmark. */
  brandColor?: string | null
  /** Organizer logo drawn in the header instead of the TICKETIO wordmark. */
  logo?: { bytes: Uint8Array; kind: ImageKind } | null
}

const A6 = { width: 297.64, height: 419.53 } // A6 portrait in points

export async function renderTicketPdf(
  data: TicketPdfData,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([A6.width, A6.height])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const margin = 24
  const dark = rgb(0.09, 0.09, 0.11)
  const muted = rgb(0.45, 0.45, 0.5)
  const brand = parseHexColor(data.brandColor)
  const accent = brand
    ? rgb(brand.r / 255, brand.g / 255, brand.b / 255)
    : muted

  let y = A6.height - margin

  const line = (
    text: string,
    size: number,
    f = font,
    color = dark,
    gap = 6,
  ) => {
    page.drawText(text, { x: margin, y: y - size, size, font: f, color })
    y -= size + gap
  }

  // Accent bar across the top when a brand color is set.
  if (brand) {
    page.drawRectangle({
      x: 0,
      y: A6.height - 6,
      width: A6.width,
      height: 6,
      color: accent,
    })
  }

  // Header: organizer logo if provided, otherwise the TICKETIO wordmark.
  let headerDrawn = false
  if (data.logo) {
    try {
      const img =
        data.logo.kind === 'png'
          ? await doc.embedPng(data.logo.bytes)
          : await doc.embedJpg(data.logo.bytes)
      const maxW = 130
      const maxH = 46
      const scale = Math.min(maxW / img.width, maxH / img.height, 1)
      const w = img.width * scale
      const h = img.height * scale
      page.drawImage(img, { x: margin, y: y - h, width: w, height: h })
      y -= h + 12
      headerDrawn = true
    } catch {
      // Corrupt/unsupported image — fall back to the wordmark below.
    }
  }
  if (!headerDrawn) line('TICKETIO', 10, bold, accent, 10)
  line(truncate(data.eventTitle, 30), 18, bold, dark, 4)
  if (data.venue) line(truncate(data.venue, 40), 10, font, muted, 2)
  line(data.startsAtLabel, 10, font, muted, 14)

  line(data.ticketTypeName, 13, bold, dark, 2)
  if (data.seatLabel) line(`Sedadlo: ${data.seatLabel}`, 11, bold, dark, 2)
  if (data.holderName) line(data.holderName, 11, font, dark, 2)

  // QR centered below.
  const png = await doc.embedPng(await qrPngBytes(data.qrToken))
  const qrSize = 180
  page.drawImage(png, {
    x: (A6.width - qrSize) / 2,
    y: margin + 34,
    width: qrSize,
    height: qrSize,
  })

  page.drawText(data.ticketRef, {
    x: margin,
    y: margin + 12,
    size: 8,
    font,
    color: muted,
  })

  return doc.save()
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}
