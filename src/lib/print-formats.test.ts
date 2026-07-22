import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  DEFAULT_PRINT_FORMAT,
  PRINT_FORMATS,
  PRINT_FORMAT_LIST,
  PRINT_FORMAT_STORAGE_KEY,
  isPrintFormatId,
  printCss,
  readStoredPrintFormat,
  storePrintFormat,
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

describe('remembering the operator’s format', () => {
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('falls back to the 80 mm roll when nothing is stored', () => {
    expect(readStoredPrintFormat()).toBe('thermal80')
    expect(DEFAULT_PRINT_FORMAT).toBe('thermal80')
  })

  it('restores every one of the three formats', () => {
    for (const id of ['thermal80', 'zebra79x152', 'a4'] as const) {
      storePrintFormat(id)
      expect(store.get(PRINT_FORMAT_STORAGE_KEY)).toBe(id)
      expect(readStoredPrintFormat()).toBe(id)
    }
  })

  it('ignores an unknown or corrupted stored value', () => {
    for (const bogus of ['zebra80x100', '', 'null', '{"id":"a4"}']) {
      store.set(PRINT_FORMAT_STORAGE_KEY, bogus)
      expect(readStoredPrintFormat()).toBe('thermal80')
    }
  })

  it('survives storage being unavailable (private mode)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('SecurityError')
      },
    })
    expect(readStoredPrintFormat()).toBe('thermal80')
    expect(() => storePrintFormat('a4')).not.toThrow()
  })

  it('is a no-op on the server, where there is no localStorage', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(readStoredPrintFormat()).toBe('thermal80')
    expect(() => storePrintFormat('zebra79x152')).not.toThrow()
  })

  it('only accepts known ids', () => {
    expect(isPrintFormatId('a4')).toBe(true)
    expect(isPrintFormatId('zebra79x152')).toBe(true)
    expect(isPrintFormatId('letter')).toBe(false)
    expect(isPrintFormatId(null)).toBe(false)
    expect(isPrintFormatId(42)).toBe(false)
  })
})
