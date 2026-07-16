import { describe, it, expect } from 'vitest'
import { parseGuestlist } from './guestlist'

describe('parseGuestlist', () => {
  it('parses name + email with Slovak headers', () => {
    const csv = 'Meno,E-mail\nJana Nováková,jana@x.sk\nPeter,peter@y.sk\n'
    const r = parseGuestlist(csv)
    expect(r.skipped).toBe(0)
    expect(r.guests).toEqual([
      { name: 'Jana Nováková', email: 'jana@x.sk' },
      { name: 'Peter', email: 'peter@y.sk' },
    ])
  })

  it('handles English headers and missing names', () => {
    const csv = 'email\na@x.sk\nb@x.sk\n'
    const r = parseGuestlist(csv)
    expect(r.guests).toEqual([
      { name: null, email: 'a@x.sk' },
      { name: null, email: 'b@x.sk' },
    ])
  })

  it('lowercases + de-duplicates emails and skips invalid rows', () => {
    const csv = 'meno,email\nA,Jana@X.sk\nB,jana@x.sk\nC,notanemail\nD,\n'
    const r = parseGuestlist(csv)
    expect(r.guests).toEqual([{ name: 'A', email: 'jana@x.sk' }])
    expect(r.skipped).toBe(3) // duplicate + invalid + empty
  })

  it('skips every row when there is no email column', () => {
    const csv = 'meno,telefon\nA,0900\nB,0901\n'
    const r = parseGuestlist(csv)
    expect(r.guests).toEqual([])
    expect(r.skipped).toBe(2)
  })

  it('imports 100 valid contacts', () => {
    const rows = Array.from(
      { length: 100 },
      (_, i) => `Meno ${i},user${i}@x.sk`,
    )
    const csv = 'meno,email\n' + rows.join('\n')
    const r = parseGuestlist(csv)
    expect(r.guests).toHaveLength(100)
    expect(r.skipped).toBe(0)
  })
})
