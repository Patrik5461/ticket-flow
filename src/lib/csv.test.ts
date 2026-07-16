import { describe, it, expect } from 'vitest'
import { toCsv, csvCell } from './csv'

describe('csvCell', () => {
  it('quotes cells with delimiter, quote, or newline', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a;b')).toBe('"a;b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"')
  })
})

describe('toCsv', () => {
  it('starts with a BOM, uses ; and CRLF', () => {
    const out = toCsv(['A', 'B'], [['1', '2']])
    expect(out.charCodeAt(0)).toBe(0xfeff)
    expect(out.slice(1)).toBe('A;B\r\n1;2')
  })
  it('quotes fields needing it', () => {
    expect(toCsv(['X'], [['a;b']]).slice(1)).toBe('X\r\n"a;b"')
  })
})
