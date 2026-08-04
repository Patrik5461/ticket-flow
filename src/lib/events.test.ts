import { describe, expect, it } from 'vitest'

import { isEventCategory, categoryLabel } from './event-categories'
import { isUpcoming, upcomingEvents } from './events'

const NOW = Date.parse('2026-08-04T12:00:00Z')

describe('isUpcoming', () => {
  it('keeps an event that has not started', () => {
    expect(isUpcoming({ starts_at: '2026-09-01T18:00:00Z' }, NOW)).toBe(true)
  })

  it('keeps an event that is running right now', () => {
    expect(
      isUpcoming(
        { starts_at: '2026-08-04T10:00:00Z', ends_at: '2026-08-04T23:00:00Z' },
        NOW,
      ),
    ).toBe(true)
  })

  it('drops an event that has ended', () => {
    expect(
      isUpcoming(
        { starts_at: '2026-07-29T20:00:00Z', ends_at: '2026-07-30T01:00:00Z' },
        NOW,
      ),
    ).toBe(false)
  })

  it('treats a missing end as ending when it starts', () => {
    expect(isUpcoming({ starts_at: '2026-08-04T11:59:00Z' }, NOW)).toBe(false)
  })

  it('drops a row with an unparseable date rather than showing it', () => {
    expect(isUpcoming({ starts_at: 'not a date' }, NOW)).toBe(false)
  })
})

describe('upcomingEvents', () => {
  it('returns only future events, soonest first', () => {
    const rows = [
      { id: 'c', starts_at: '2026-11-25T18:00:00Z' },
      { id: 'past', starts_at: '2026-07-01T18:00:00Z' },
      { id: 'a', starts_at: '2026-08-10T18:00:00Z' },
      { id: 'b', starts_at: '2026-09-05T18:00:00Z' },
    ]
    expect(upcomingEvents(rows, NOW).map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('is empty when everything is over', () => {
    expect(
      upcomingEvents([{ starts_at: '2026-01-01T18:00:00Z' }], NOW),
    ).toEqual([])
  })
})

describe('event categories', () => {
  it('accepts a known slug and rejects anything else', () => {
    expect(isEventCategory('koncert')).toBe(true)
    expect(isEventCategory('KONCERT')).toBe(false)
    expect(isEventCategory('')).toBe(false)
    expect(isEventCategory(null)).toBe(false)
  })

  it('labels known slugs and stays quiet about the rest', () => {
    expect(categoryLabel('sport')).toBe('Šport')
    expect(categoryLabel('nope')).toBeNull()
    expect(categoryLabel(null)).toBeNull()
  })
})
