import { describe, it, expect } from 'vitest'
import { alphaLabel, generateSeats, sectorsOf } from './seating'

describe('alphaLabel', () => {
  it('produces spreadsheet-style letters', () => {
    expect(alphaLabel(0)).toBe('A')
    expect(alphaLabel(25)).toBe('Z')
    expect(alphaLabel(26)).toBe('AA')
    expect(alphaLabel(27)).toBe('AB')
  })
})

describe('generateSeats', () => {
  it('generates rows × seats with alpha rows and left→right numbering', () => {
    const seats = generateSeats({ sector: 'P', rows: 2, seatsPerRow: 3 })
    expect(seats).toHaveLength(6)
    expect(seats[0]).toMatchObject({
      sector: 'P',
      level: 'main',
      row_label: 'A',
      seat_number: '1',
      seat_type: 'standard',
    })
    expect(seats.map((s) => s.row_label)).toEqual([
      'A',
      'A',
      'A',
      'B',
      'B',
      'B',
    ])
    expect(seats.slice(0, 3).map((s) => s.seat_number)).toEqual(['1', '2', '3'])
    // x increases across a row, y increases across rows
    expect(seats[1].x).toBeGreaterThan(seats[0].x)
    expect(seats[3].y).toBeGreaterThan(seats[0].y)
  })

  it('honours numeric row labels and custom starts', () => {
    const seats = generateSeats({
      sector: 'B',
      rows: 2,
      seatsPerRow: 2,
      rowLabelStyle: 'numeric',
      rowLabelStart: '5',
      seatNumberStart: 10,
    })
    expect(seats.map((s) => s.row_label)).toEqual(['5', '5', '6', '6'])
    expect(seats.slice(0, 2).map((s) => s.seat_number)).toEqual(['10', '11'])
  })

  it('rtl direction puts seat #1 on the right (largest x)', () => {
    const seats = generateSeats({
      sector: 'B',
      rows: 1,
      seatsPerRow: 3,
      seatNumberDir: 'rtl',
    })
    const seat1 = seats.find((s) => s.seat_number === '1')!
    const seat3 = seats.find((s) => s.seat_number === '3')!
    expect(seat1.x).toBeGreaterThan(seat3.x)
  })

  it('alpha rows wrap past Z to AA', () => {
    const seats = generateSeats({ sector: 'X', rows: 27, seatsPerRow: 1 })
    expect(seats[25].row_label).toBe('Z')
    expect(seats[26].row_label).toBe('AA')
  })

  it('sectorsOf lists distinct sectors sorted', () => {
    expect(
      sectorsOf([{ sector: 'B' }, { sector: 'A' }, { sector: 'A' }]),
    ).toEqual(['A', 'B'])
  })
})
