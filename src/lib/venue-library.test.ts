import { describe, expect, it } from 'vitest'
import {
  filterVenues,
  foldText,
  isLibraryVenue,
  splitVenues,
  venueMatches,
} from './venue-library'
import type { VenueOption } from './venue-library'

const venue = (over: Partial<VenueOption> = {}): VenueOption => ({
  id: 'v1',
  name: 'Steel Aréna',
  address: 'Nerudova 12, Košice',
  readOnly: false,
  ...over,
})

describe('isLibraryVenue', () => {
  it('is true only for an ownerless public hall', () => {
    expect(isLibraryVenue({ organizerId: null, isPublic: true })).toBe(true)
  })

  it('is false for an own venue, even one flagged public', () => {
    expect(isLibraryVenue({ organizerId: 'org1', isPublic: false })).toBe(false)
    // An organizer's own row stays theirs to edit whatever the flag says.
    expect(isLibraryVenue({ organizerId: 'org1', isPublic: true })).toBe(false)
  })

  it('is false for an ownerless row that is not published', () => {
    expect(isLibraryVenue({ organizerId: null, isPublic: false })).toBe(false)
  })
})

describe('foldText', () => {
  it('strips diacritics and case', () => {
    expect(foldText('Košice')).toBe('kosice')
    expect(foldText('Divadlo P. O. Hviezdoslava')).toBe(
      'divadlo p. o. hviezdoslava',
    )
  })
})

describe('venueMatches', () => {
  it('matches the name without diacritics', () => {
    expect(venueMatches(venue(), 'arena')).toBe(true)
  })

  it('matches the address too', () => {
    expect(venueMatches(venue(), 'kosice')).toBe(true)
    expect(venueMatches(venue(), 'nerudova')).toBe(true)
  })

  it('requires every term, in any order', () => {
    expect(venueMatches(venue(), 'kosice steel')).toBe(true)
    expect(venueMatches(venue(), 'steel bratislava')).toBe(false)
  })

  it('matches everything on an empty or blank query', () => {
    expect(venueMatches(venue(), '')).toBe(true)
    expect(venueMatches(venue(), '   ')).toBe(true)
  })

  it('does not crash on a venue with no address', () => {
    expect(venueMatches(venue({ address: null }), 'steel')).toBe(true)
    expect(venueMatches(venue({ address: null }), 'kosice')).toBe(false)
  })
})

describe('filterVenues / splitVenues', () => {
  const list = [
    venue({ id: 'own1', name: 'Naša sála', address: 'Trnava' }),
    venue({ id: 'pub1', name: 'Steel Aréna', readOnly: true }),
    venue({
      id: 'pub2',
      name: 'Zimný štadión',
      address: 'Trnava',
      readOnly: true,
    }),
  ]

  it('filters across both groups', () => {
    expect(filterVenues(list, 'trnava').map((v) => v.id)).toEqual([
      'own1',
      'pub2',
    ])
  })

  it('splits own venues from library halls, preserving order', () => {
    const { own, library } = splitVenues(list)
    expect(own.map((v) => v.id)).toEqual(['own1'])
    expect(library.map((v) => v.id)).toEqual(['pub1', 'pub2'])
  })
})
