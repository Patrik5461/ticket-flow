import { describe, it, expect } from 'vitest'
import { renderSettlementPdf } from './pdf'

describe('renderSettlementPdf', () => {
  it('renders a PDF with Slovak diacritics without throwing (WinAnsi-safe)', async () => {
    const bytes = await renderSettlementPdf({
      organizer: {
        name: 'Košický kultúrny spolok, s.r.o.',
        ico: '12345678',
        dic: '2020202020',
        ic_dph: 'SK2020202020',
        iban: 'SK89 0200 0000 0000 0000 0000',
      },
      periodLabel: 'jún 2026',
      generatedLabel: '1. 7. 2026',
      grossCents: 123456,
      feeCents: 4938,
      refundedCents: 3500,
      netCents: 115018,
      orderCount: 2,
      lines: [
        {
          ref: 'D192F504',
          eventTitle: 'Letný festival — Košice',
          dateLabel: '14. 6. 2026',
          totalCents: 100000,
          feeCents: 4000,
          refundedCents: 0,
        },
        {
          ref: 'A1B2C3D4',
          eventTitle: 'Divadelné predstavenie „Ženský zákon“',
          dateLabel: '20. 6. 2026',
          totalCents: 23456,
          feeCents: 938,
          refundedCents: 3500,
        },
      ],
    })
    expect(bytes.length).toBeGreaterThan(1000)
    // PDF magic header: %PDF
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46])
  })

  it('paginates a large order list without throwing', async () => {
    const lines = Array.from({ length: 120 }, (_, i) => ({
      ref: `REF${i}`,
      eventTitle: 'Podujatie č. ' + i,
      dateLabel: '1. 6. 2026',
      totalCents: 1500,
      feeCents: 60,
      refundedCents: 0,
    }))
    const bytes = await renderSettlementPdf({
      organizer: { name: 'Org', ico: null, dic: null, ic_dph: null, iban: null },
      periodLabel: 'jún 2026',
      generatedLabel: '1. 7. 2026',
      grossCents: 180000,
      feeCents: 7200,
      refundedCents: 0,
      netCents: 172800,
      orderCount: 120,
      lines,
    })
    expect(bytes.length).toBeGreaterThan(1000)
  })
})
