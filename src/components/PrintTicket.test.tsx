// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PrintTicket } from './PrintTicket'
import type { PrintTicketData } from './PrintTicket'
import { PRINT_FORMATS } from '../lib/print-formats'

const format = PRINT_FORMATS.zebra79x152

const ticket = (over: Partial<PrintTicketData> = {}): PrintTicketData => ({
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  ref: 'AAAAAAAA',
  typeName: 'VIP',
  qrDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  unitPriceCents: 2500,
  ...over,
})

const event = {
  title: 'Letný festival 2026',
  venueName: 'Amfiteáter Košice',
  whenLabel: 'pondelok 20. júla 2026, 20:00',
}

function renderTickets(tickets: PrintTicketData[]) {
  return render(
    <div id="print-tickets">
      {tickets.map((t) => (
        <PrintTicket
          key={t.id}
          event={event}
          ticket={t}
          orderRef="ORD12345"
          format={format}
        />
      ))}
    </div>,
  )
}

describe('PrintTicket (Zebra 79 × 152 mm)', () => {
  afterEach(cleanup)

  it('carries everything staff and the gate need', () => {
    renderTickets([ticket()])

    expect(screen.getByText('Letný festival 2026')).toBeDefined()
    expect(screen.getByText('pondelok 20. júla 2026, 20:00')).toBeDefined()
    expect(screen.getByText('Amfiteáter Košice')).toBeDefined()
    expect(screen.getByText('VIP')).toBeDefined()
    expect(screen.getByText('25,00 €')).toBeDefined()
    expect(screen.getByText('AAAAAAAA')).toBeDefined()
    expect(screen.getByText('Objednávka ORD12345')).toBeDefined()
  })

  it('is exactly one label page in size, with the padding inside', () => {
    renderTickets([ticket()])
    const page = screen.getByTestId('print-ticket')
    expect(page.style.width).toBe('79mm')
    expect(page.style.height).toBe('152mm')
    expect(page.style.padding).toBe('5mm')
    // The class the print CSS targets for the page break.
    expect(page.classList.contains('print-ticket')).toBe(true)
  })

  it('prints the QR at 40 mm — above the 25 mm floor and 1:1 at 203 dpi', () => {
    renderTickets([ticket()])
    const qr = screen.getByTestId('print-ticket-qr')
    expect(qr.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=')
    for (const value of [qr.style.width, qr.style.height]) {
      expect(value).toMatch(/^(\d+)mm$/)
      expect(Number(value.replace('mm', ''))).toBeGreaterThanOrEqual(25)
      expect(value).toBe('40mm')
    }
  })

  it('renders one page per ticket when several are printed at once', () => {
    renderTickets([
      ticket({ id: 't1', ref: 'REF00001' }),
      ticket({ id: 't2', ref: 'REF00002', typeName: 'Štandard', unitPriceCents: 1500 }),
      ticket({ id: 't3', ref: 'REF00003' }),
    ])

    const pages = screen.getAllByTestId('print-ticket')
    expect(pages).toHaveLength(3)
    // Each page has its own QR and its own reference — no shared/duplicated QR.
    expect(screen.getAllByTestId('print-ticket-qr')).toHaveLength(3)
    expect(screen.getByText('REF00002')).toBeDefined()
    expect(screen.getByText('15,00 €')).toBeDefined()
  })

  it('clamps a very long event title instead of pushing content off the label', () => {
    renderTickets([ticket()])
    cleanup()
    render(
      <PrintTicket
        event={{
          ...event,
          title:
            'Medzinárodný multižánrový hudobný a divadelný festival pod holým nebom 2026 — jubilejný ročník',
        }}
        ticket={ticket()}
        orderRef="ORD12345"
        format={format}
      />,
    )
    const title = screen.getByTitle(/Medzinárodný multižánrový/)
    expect(title.style.overflow).toBe('hidden')
    expect(title.style.webkitLineClamp).toBe('2')
    // A long unbroken word must wrap rather than widen the label.
    expect(title.style.overflowWrap).toBe('anywhere')
  })

  it('survives a missing venue without leaving an empty line', () => {
    render(
      <PrintTicket
        event={{ ...event, venueName: null }}
        ticket={ticket()}
        orderRef="ORD12345"
        format={format}
      />,
    )
    expect(screen.queryByText('Amfiteáter Košice')).toBeNull()
    expect(screen.getByTestId('print-ticket')).toBeDefined()
  })
})
