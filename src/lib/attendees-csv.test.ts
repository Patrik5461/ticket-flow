import { describe, it, expect } from 'vitest'
import { buildAttendeesCsv } from './attendees-csv'

describe('buildAttendeesCsv', () => {
  it('emits base columns + a column per distinct answer label, quoting when needed', () => {
    const csv = buildAttendeesCsv([
      {
        ref: 'AAAA1111',
        typeName: 'VIP',
        seat: 'A · rad 1 · miesto 5',
        holderName: 'Jana Nováková',
        holderEmail: 'jana@x.sk',
        answers: { Veľkosť: 'M', Poznámka: 'bez; mäsa' },
      },
      {
        ref: 'BBBB2222',
        typeName: 'Standard',
        seat: null,
        holderName: null,
        holderEmail: 'peter@x.sk',
        answers: { Veľkosť: 'L' },
      },
    ])
    const lines = csv.replace('﻿', '').split('\r\n')
    expect(lines[0]).toBe('Číslo;Typ;Sedadlo;Meno;E-mail;Veľkosť;Poznámka')
    // note quoting for the ';' in the note, and empty cell for the missing label
    expect(lines[1]).toBe(
      'AAAA1111;VIP;A · rad 1 · miesto 5;Jana Nováková;jana@x.sk;M;"bez; mäsa"',
    )
    expect(lines[2]).toBe('BBBB2222;Standard;;;peter@x.sk;L;')
  })

  it('starts with a UTF-8 BOM', () => {
    const csv = buildAttendeesCsv([])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })
})
