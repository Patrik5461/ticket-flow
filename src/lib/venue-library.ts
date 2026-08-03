/**
 * Shared venue library — pure helpers for the venue picker.
 *
 * A library hall belongs to no organizer (`organizerId` null) and carries
 * `isPublic`. Every organizer may read it and use its seat map; nobody may edit
 * it. Anything else is the organizer's own venue and is fully editable.
 *
 * The picker has to cope with ~460 library halls, so filtering happens here —
 * against the name AND the address, diacritics-insensitive, because nobody
 * types "Košice" with the accent when they are searching.
 */

export interface VenueOption {
  id: string
  name: string
  address: string | null
  /** True for library halls: read-only for every organizer. */
  readOnly: boolean
}

/**
 * True when a venue row is a shared library hall. This is the single definition
 * of "public hall" — both the server (building VenueRow) and any client check
 * go through it, so the two can never drift apart.
 */
export function isLibraryVenue(v: {
  organizerId: string | null
  isPublic: boolean
}): boolean {
  return v.isPublic && v.organizerId === null
}

/** Case- and diacritics-insensitive comparison key. */
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/**
 * Does this venue match the query? Every whitespace-separated term must appear
 * somewhere in the name or the address, so "kosice steel" finds "Steel Aréna,
 * Nerudova 12, Košice" whichever order the user types.
 */
export function venueMatches(v: VenueOption, query: string): boolean {
  const terms = foldText(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const haystack = foldText(`${v.name} ${v.address ?? ''}`)
  return terms.every((t) => haystack.includes(t))
}

export function filterVenues<T extends VenueOption>(
  venues: T[],
  query: string,
): T[] {
  return venues.filter((v) => venueMatches(v, query))
}

/**
 * Split into the two option groups the picker renders: "Moje miesta" first,
 * "Verejné haly" second. Order within each group is preserved (the server
 * already sorts by name).
 */
export function splitVenues<T extends VenueOption>(
  venues: T[],
): { own: T[]; library: T[] } {
  return {
    own: venues.filter((v) => !v.readOnly),
    library: venues.filter((v) => v.readOnly),
  }
}
