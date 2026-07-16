import { describe, it, expect } from 'vitest'
import { eventChangesHtml } from './event-emails'
import type { EventChangeInput } from './event-emails'

const base: EventChangeInput = {
  oldStartsAt: '2026-08-01T18:00:00.000Z',
  newStartsAt: '2026-08-01T18:00:00.000Z',
  oldEndsAt: null,
  newEndsAt: null,
  oldVenueName: 'Amfiteáter',
  newVenueName: 'Amfiteáter',
  oldVenueAddress: 'Košice',
  newVenueAddress: 'Košice',
  timezone: 'Europe/Bratislava',
}

describe('eventChangesHtml', () => {
  it('returns null when nothing changed', () => {
    expect(eventChangesHtml(base)).toBeNull()
  })

  it('reports a date change', () => {
    const html = eventChangesHtml({
      ...base,
      newStartsAt: '2026-08-02T18:00:00.000Z',
    })
    expect(html).not.toBeNull()
    expect(html).toContain('Termín')
    expect(html).not.toContain('Miesto')
  })

  it('reports an end-time-only change as a date change', () => {
    const html = eventChangesHtml({
      ...base,
      newEndsAt: '2026-08-01T22:00:00.000Z',
    })
    expect(html).toContain('Termín')
  })

  it('reports a venue change', () => {
    const html = eventChangesHtml({ ...base, newVenueName: 'Steel Aréna' })
    expect(html).not.toBeNull()
    expect(html).toContain('Miesto')
    expect(html).toContain('Steel Aréna')
    expect(html).not.toContain('Termín')
  })

  it('reports both when date and venue change', () => {
    const html = eventChangesHtml({
      ...base,
      newStartsAt: '2026-08-05T18:00:00.000Z',
      newVenueAddress: 'Bratislava',
    })
    expect(html).toContain('Termín')
    expect(html).toContain('Miesto')
  })
})
