import { describe, it, expect } from 'vitest'
import {
  escapeHtml,
  emailLayout,
  ticketsEmail,
  orderPendingEmail,
  refundEmail,
  eventCancelledEmail,
  eventChangedEmail,
  reminderEmail,
  bulkMessageEmail,
} from './templates'

describe('escapeHtml', () => {
  it('escapes HTML-significant characters', () => {
    expect(escapeHtml('<b>"A&B"</b>')).toBe(
      '&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;',
    )
  })
})

describe('emailLayout', () => {
  it('wraps content and escapes the heading', () => {
    const html = emailLayout({
      heading: 'Ahoj <script>',
      contentHtml: '<p>obsah</p>',
    })
    expect(html).toContain('Ticketio')
    expect(html).toContain('<p>obsah</p>')
    expect(html).toContain('Ahoj &lt;script&gt;')
    expect(html).not.toContain('<h1>Ahoj <script>')
  })
})

describe('templates', () => {
  it('ticketsEmail carries the event + tickets and escapes the title', () => {
    const { subject, html } = ticketsEmail({
      eventTitle: 'Rock & Roll',
      whenLabel: '14. 6. 2026',
      venue: 'Košice',
      orderRef: 'ABC12345',
      ticketsHtml: '<div>QR</div>',
    })
    expect(subject).toBe('Vstupenky — Rock & Roll')
    expect(html).toContain('Rock &amp; Roll')
    expect(html).toContain('<div>QR</div>')
    expect(html).toContain('ABC12345')
  })

  it('orderPendingEmail includes the pay button and total', () => {
    const { subject, html } = orderPendingEmail({
      eventTitle: 'Fest',
      whenLabel: '14. 6. 2026',
      orderRef: 'REF',
      totalLabel: '15,00 €',
      orderUrl: 'https://x/order/1?t=abc',
    })
    expect(subject).toContain('čaká na platbu')
    expect(html).toContain('15,00 €')
    expect(html).toContain('https://x/order/1?t=abc')
    expect(html).toContain('Zaplatiť')
  })

  it('refundEmail differs for full vs partial', () => {
    expect(
      refundEmail({
        eventTitle: 'E',
        orderRef: 'R',
        amountLabel: '5,00 €',
        full: true,
      }).html,
    ).toContain('plne refundovaná')
    expect(
      refundEmail({
        eventTitle: 'E',
        orderRef: 'R',
        amountLabel: '2,00 €',
        full: false,
      }).html,
    ).toContain('Časť')
  })

  it('eventCancelledEmail states cancellation + amount', () => {
    const { subject, html } = eventCancelledEmail({
      eventTitle: 'E',
      orderRef: 'R',
      amountLabel: '9,00 €',
    })
    expect(subject).toContain('zrušené')
    expect(html).toContain('9,00 €')
  })

  it('eventChangedEmail includes the changes block', () => {
    const { html } = eventChangedEmail({
      eventTitle: 'E',
      whenLabel: 'nový termín',
      changesHtml: '<li>termín</li>',
    })
    expect(html).toContain('<li>termín</li>')
  })

  it('reminderEmail links to the order', () => {
    const { subject, html } = reminderEmail({
      eventTitle: 'E',
      whenLabel: 'zajtra',
      orderUrl: 'https://x/o',
    })
    expect(subject).toContain('čoskoro')
    expect(html).toContain('https://x/o')
  })

  it('bulkMessageEmail escapes body and converts newlines to <br>', () => {
    const { subject, html } = bulkMessageEmail({
      eventTitle: 'E',
      subject: 'Dôležité',
      bodyText: 'riadok 1\nriadok 2 <b>',
    })
    expect(subject).toBe('Dôležité')
    expect(html).toContain('riadok 1<br/>riadok 2 &lt;b&gt;')
  })
})
