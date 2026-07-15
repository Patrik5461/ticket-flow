/**
 * Server-side ticket PDF. Uses pdf-lib (SSR-safe) + the QR PNG. One page per
 * ticket. Client-side "download as image/PDF" flows, if added later, must use a
 * dynamic client-only import per CLAUDE.md — this module is the server path.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { qrPngBytes } from './qr-image'

export interface TicketPdfData {
  eventTitle: string
  venue?: string | null
  startsAtLabel: string
  ticketTypeName: string
  holderName?: string | null
  /** Short human ref, e.g. ticket id prefix. */
  ticketRef: string
  /** The signed QR token (TIK.{id}.{sig}). */
  qrToken: string
}

const A6 = { width: 297.64, height: 419.53 } // A6 portrait in points

export async function renderTicketPdf(data: TicketPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([A6.width, A6.height])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const margin = 24
  const dark = rgb(0.09, 0.09, 0.11)
  const muted = rgb(0.45, 0.45, 0.5)

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

  line('TICKETIO', 10, bold, muted, 10)
  line(truncate(data.eventTitle, 30), 18, bold, dark, 4)
  if (data.venue) line(truncate(data.venue, 40), 10, font, muted, 2)
  line(data.startsAtLabel, 10, font, muted, 14)

  line(data.ticketTypeName, 13, bold, dark, 2)
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
