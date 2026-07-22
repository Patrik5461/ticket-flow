import { describe, it, expect } from 'vitest'
import {
  PRINT_FORMATS,
  PRINT_FORMAT_LIST,
  printCss,
} from './print-formats'

describe('print formats', () => {
  it('offers exactly the three supported formats, thermal first', () => {
    expect(PRINT_FORMAT_LIST.map((f) => f.id)).toEqual([
      'thermal80',
      'zebra79x152',
      'a4',
    ])
    expect(PRINT_FORMATS.zebra79x152.label).toBe('Zebra 79 × 152 mm')
  })

  it('Zebra is an exact 79 × 152 mm portrait page with no page margin', () => {
    const zebra = PRINT_FORMATS.zebra79x152
    // Width before height = portrait; a label printer must not add margins of
    // its own, the padding lives inside the ticket.
    expect(zebra.pageSize).toBe('79mm 152mm')
    expect(zebra.pageMargin).toBe('0')
    expect(zebra.contentWidth).toBe('79mm')
    expect(zebra.pageHeight).toBe('152mm')
    expect(zebra.contentPadding).toBe('5mm')

    const css = printCss(zebra)
    expect(css).toContain('@page { size: 79mm 152mm; margin: 0; }')
  })

  it('prints one ticket per page and no trailing blank label', () => {
    const css = printCss(PRINT_FORMATS.zebra79x152)
    expect(css).toContain('page-break-after: always')
    expect(css).toContain('break-after: page')
    // The last ticket must not force an extra empty page.
    expect(css).toMatch(/\.print-ticket:last-child\s*{[^}]*page-break-after: auto/)
    // Nothing may spill over the fixed height.
    expect(css).toContain('overflow: hidden')
    expect(css).toContain('height: 152mm')
  })

  it('per-ticket printing hides the receipt, and vice versa', () => {
    const zebra = printCss(PRINT_FORMATS.zebra79x152)
    expect(zebra).toContain('#pos-receipt { display: none !important; }')
    expect(zebra).toContain('#print-tickets { display: block !important; }')

    for (const id of ['thermal80', 'a4'] as const) {
      const css = printCss(PRINT_FORMATS[id])
      expect(css).toContain('#print-tickets { display: none !important; }')
      expect(css).toContain('#pos-receipt, #pos-receipt * { visibility: visible; }')
    }
  })

  it('keeps the existing receipt formats byte-for-byte in geometry', () => {
    expect(printCss(PRINT_FORMATS.thermal80)).toContain(
      '@page { size: 80mm auto; margin: 3mm; }',
    )
    expect(printCss(PRINT_FORMATS.thermal80)).toContain('width: 74mm')
    expect(printCss(PRINT_FORMATS.a4)).toContain(
      '@page { size: A4; margin: 14mm; }',
    )
  })

  it('hides the on-screen controls in every format', () => {
    for (const f of PRINT_FORMAT_LIST) {
      expect(printCss(f)).toContain('.no-print { display: none !important; }')
    }
  })
})
