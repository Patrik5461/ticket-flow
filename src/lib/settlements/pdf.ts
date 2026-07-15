/**
 * Server-side settlement protocol PDF (pdf-lib, SSR-safe). A4, one header block
 * plus a paginated order table whose totals reconcile to the settlement row.
 *
 * StandardFonts.Helvetica uses WinAnsi, which cannot encode Slovak diacritics, so
 * all text is stripped of combining marks first (č→c, š→s, …). Amounts are shown
 * with an "EUR" suffix rather than the € glyph for the same reason.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { PDFFont, PDFPage } from 'pdf-lib'

export interface SettlementPdfLine {
  ref: string
  eventTitle: string
  dateLabel: string
  totalCents: number
  feeCents: number
  refundedCents: number
}

export interface SettlementPdfData {
  organizer: {
    name: string
    ico: string | null
    dic: string | null
    ic_dph: string | null
    iban: string | null
  }
  periodLabel: string
  generatedLabel: string
  grossCents: number
  feeCents: number
  refundedCents: number
  netCents: number
  orderCount: number
  lines: SettlementPdfLine[]
}

const A4 = { width: 595.28, height: 841.89 }
const MARGIN = 48

/** Strip combining diacritics so WinAnsi (Helvetica) can encode Slovak text. */
function ascii(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '')
}
function eur(cents: number): string {
  return `${(cents / 100).toFixed(2)} EUR`
}

export async function renderSettlementPdf(
  data: SettlementPdfData,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const dark = rgb(0.09, 0.09, 0.11)
  const muted = rgb(0.45, 0.45, 0.5)

  let page = doc.addPage([A4.width, A4.height])
  let y = A4.height - MARGIN

  const text = (
    s: string,
    x: number,
    size: number,
    f: PDFFont = font,
    color = dark,
  ) => page.drawText(ascii(s), { x, y, size, font: f, color })

  // Header
  page.drawText('TICKETIO', {
    x: MARGIN,
    y,
    size: 10,
    font: bold,
    color: muted,
  })
  y -= 26
  text('Vyuctovanie pre organizatora', MARGIN, 20, bold)
  y -= 20
  text(`Obdobie: ${data.periodLabel}`, MARGIN, 11, font, muted)
  y -= 14
  text(`Vygenerovane: ${data.generatedLabel}`, MARGIN, 11, font, muted)
  y -= 28

  // Organizer block
  text(data.organizer.name, MARGIN, 13, bold)
  y -= 16
  const idBits = [
    data.organizer.ico ? `ICO: ${data.organizer.ico}` : null,
    data.organizer.dic ? `DIC: ${data.organizer.dic}` : null,
    data.organizer.ic_dph ? `IC DPH: ${data.organizer.ic_dph}` : null,
  ].filter(Boolean)
  if (idBits.length) {
    text(idBits.join('   '), MARGIN, 10, font, muted)
    y -= 14
  }
  if (data.organizer.iban) {
    text(`IBAN: ${data.organizer.iban}`, MARGIN, 10, font, muted)
    y -= 14
  }
  y -= 14

  // Summary box
  const sumRow = (label: string, value: string, strong = false) => {
    const f = strong ? bold : font
    text(label, MARGIN, 11, f)
    const v = ascii(value)
    page.drawText(v, {
      x: A4.width - MARGIN - f.widthOfTextAtSize(v, 11),
      y,
      size: 11,
      font: f,
      color: dark,
    })
    y -= 16
  }
  sumRow(`Pocet objednavok`, String(data.orderCount))
  sumRow('Hrube trzby', eur(data.grossCents))
  sumRow('Provizia platformy', eur(data.feeCents))
  sumRow('Refundacie', eur(data.refundedCents))
  y -= 4
  page.drawLine({
    start: { x: MARGIN, y: y + 8 },
    end: { x: A4.width - MARGIN, y: y + 8 },
    thickness: 0.5,
    color: muted,
  })
  sumRow('Netto pre organizatora', eur(data.netCents), true)
  y -= 18

  // Orders table
  text('Objednavky', MARGIN, 12, bold)
  y -= 18

  const cols = {
    ref: MARGIN,
    event: MARGIN + 70,
    date: MARGIN + 250,
    total: MARGIN + 330,
    fee: MARGIN + 410,
    refunded: MARGIN + 470,
  }
  const header = (p: PDFPage, yy: number) => {
    const h = (s: string, x: number) =>
      p.drawText(ascii(s), { x, y: yy, size: 8, font: bold, color: muted })
    h('Cislo', cols.ref)
    h('Podujatie', cols.event)
    h('Datum', cols.date)
    h('Suma', cols.total)
    h('Provizia', cols.fee)
    h('Refund', cols.refunded)
  }
  header(page, y)
  y -= 14

  for (const l of data.lines) {
    if (y < MARGIN + 40) {
      page = doc.addPage([A4.width, A4.height])
      y = A4.height - MARGIN
      header(page, y)
      y -= 14
    }
    const cell = (s: string, x: number, f: PDFFont = font) =>
      page.drawText(ascii(s), { x, y, size: 8, font: f, color: dark })
    cell(l.ref, cols.ref)
    cell(
      l.eventTitle.length > 28 ? `${l.eventTitle.slice(0, 27)}…` : l.eventTitle,
      cols.event,
    )
    cell(l.dateLabel, cols.date)
    cell(eur(l.totalCents), cols.total)
    cell(eur(l.feeCents), cols.fee)
    cell(l.refundedCents > 0 ? eur(l.refundedCents) : '—', cols.refunded)
    y -= 13
  }

  return doc.save()
}
