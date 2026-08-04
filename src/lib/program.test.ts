import { describe, expect, it } from 'vitest'

import { isEventCategory, categoryLabel } from './event-categories'
import { EVENTS_PAGE_SIZE, normalizePage, pageCount, pageRange } from './paging'

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

describe('normalizePage', () => {
  it('reads a page number out of the URL string', () => {
    expect(normalizePage('3')).toBe(3)
    expect(normalizePage(3)).toBe(3)
  })

  it('falls back to the first page on junk', () => {
    for (const bad of ['', 'abc', '-2', 0, -1, null, undefined, NaN, {}]) {
      expect(normalizePage(bad)).toBe(1)
    }
  })

  it('caps a page number nobody could have clicked to', () => {
    expect(normalizePage('999999999')).toBe(10_000)
  })
})

describe('pageRange', () => {
  it('starts the first page at row zero', () => {
    expect(pageRange(1, 24)).toEqual({ from: 0, to: 23 })
  })

  it('walks by whole pages', () => {
    expect(pageRange(2, 24)).toEqual({ from: 24, to: 47 })
    expect(pageRange(5, 10)).toEqual({ from: 40, to: 49 })
  })

  it('treats an impossible page as the first one', () => {
    expect(pageRange(0, 24)).toEqual({ from: 0, to: 23 })
    expect(pageRange(-4, 24)).toEqual({ from: 0, to: 23 })
  })
})

describe('pageCount', () => {
  it('counts a partial last page', () => {
    expect(pageCount(25, 24)).toBe(2)
    expect(pageCount(48, 24)).toBe(2)
    expect(pageCount(49, 24)).toBe(3)
  })

  it('never reports zero pages, so "1 z 1" always reads', () => {
    expect(pageCount(0, 24)).toBe(1)
    expect(pageCount(-5, 24)).toBe(1)
    expect(pageCount(10, 0)).toBe(1)
  })

  it('agrees with the page size the program actually uses', () => {
    expect(pageCount(EVENTS_PAGE_SIZE, EVENTS_PAGE_SIZE)).toBe(1)
    expect(pageCount(EVENTS_PAGE_SIZE + 1, EVENTS_PAGE_SIZE)).toBe(2)
  })
})
