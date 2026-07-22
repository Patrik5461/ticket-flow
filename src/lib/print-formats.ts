/**
 * Print formats for the POS print page.
 *
 * All three share one CSS generator — the formats differ only in page geometry
 * and in WHICH document they print:
 *   - `receipt`: one sales receipt listing every ticket (80 mm roll, A4),
 *   - `tickets`: one admission ticket PER PAGE (Zebra 79 × 152 mm labels).
 *
 * Keeping the geometry in data (rather than in a third copy of the component)
 * means a new label size is a new entry here, nothing else.
 */

export type PrintFormatId = 'thermal80' | 'zebra79x152' | 'a4'

/** What the format prints: the sales receipt, or one page per ticket. */
export type PrintDocument = 'receipt' | 'tickets'

export interface PrintFormat {
  id: PrintFormatId
  label: string
  document: PrintDocument
  /** CSS `size` value for the @page rule. */
  pageSize: string
  /** CSS `margin` value for the @page rule. */
  pageMargin: string
  /** Width the printed content is laid out at. */
  contentWidth: string
  /** Fixed page height — only for per-ticket formats. */
  pageHeight?: string
  /** Padding inside the ticket (page margin is 0 for label printers). */
  contentPadding?: string
  fontSize: string
}

export const PRINT_FORMATS: Record<PrintFormatId, PrintFormat> = {
  thermal80: {
    id: 'thermal80',
    label: 'Termálna 80 mm',
    document: 'receipt',
    pageSize: '80mm auto',
    pageMargin: '3mm',
    contentWidth: '74mm',
    fontSize: '12px',
  },
  zebra79x152: {
    id: 'zebra79x152',
    label: 'Zebra 79 × 152 mm',
    document: 'tickets',
    // Label stock: the printer feeds an exact 79 × 152 mm portrait page and the
    // page margin must be zero — padding lives inside the ticket instead.
    pageSize: '79mm 152mm',
    pageMargin: '0',
    contentWidth: '79mm',
    pageHeight: '152mm',
    contentPadding: '5mm',
    fontSize: '11px',
  },
  a4: {
    id: 'a4',
    label: 'A4',
    document: 'receipt',
    pageSize: 'A4',
    pageMargin: '14mm',
    contentWidth: '100%',
    fontSize: '14px',
  },
}

export const PRINT_FORMAT_LIST: PrintFormat[] = [
  PRINT_FORMATS.thermal80,
  PRINT_FORMATS.zebra79x152,
  PRINT_FORMATS.a4,
]

/**
 * The @media print rules for one format.
 *
 * Receipt formats keep the original visibility trick (hide everything, reveal
 * the receipt, pin it to the corner) — it is proven and prints a single flowing
 * document. Per-ticket formats cannot use it: an absolutely positioned block
 * does not paginate reliably, so instead the surrounding chrome is removed from
 * the layout entirely and the ticket pages flow normally, each one a fixed-size
 * block that forces a page break after itself.
 */
export function printCss(format: PrintFormat): string {
  const page = `@page { size: ${format.pageSize}; margin: ${format.pageMargin}; }`

  if (format.document === 'receipt') {
    return `
@media print {
  ${page}
  body { background: #fff; }
  body * { visibility: hidden; }
  #pos-receipt, #pos-receipt * { visibility: visible; }
  #pos-receipt {
    position: absolute; left: 0; top: 0;
    width: ${format.contentWidth}; font-size: ${format.fontSize}; color: #000;
  }
  #print-tickets { display: none !important; }
  .no-print { display: none !important; }
}`
  }

  return `
@media print {
  ${page}
  html, body {
    background: #fff !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  .print-wrap {
    background: #fff !important;
    margin: 0 !important;
    padding: 0 !important;
    min-height: 0 !important;
  }
  .no-print { display: none !important; }
  #pos-receipt { display: none !important; }
  #print-tickets { display: block !important; }
  .print-ticket {
    width: ${format.contentWidth};
    height: ${format.pageHeight};
    padding: ${format.contentPadding};
    font-size: ${format.fontSize};
    color: #000;
    margin: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    /* Nothing may spill onto a second page. */
    overflow: hidden;
    page-break-inside: avoid;
    break-inside: avoid;
    page-break-after: always;
    break-after: page;
  }
  /* No trailing blank page after the last ticket. */
  .print-ticket:last-child {
    page-break-after: auto;
    break-after: auto;
  }
}`
}
