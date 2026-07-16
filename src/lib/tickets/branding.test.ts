import { describe, it, expect } from 'vitest'
import { parseHexColor, normalizeHexColor, detectImageKind } from './branding'

describe('parseHexColor', () => {
  it('parses #rrggbb and rrggbb', () => {
    expect(parseHexColor('#ff8800')).toEqual({ r: 255, g: 136, b: 0 })
    expect(parseHexColor('4f46e5')).toEqual({ r: 79, g: 70, b: 229 })
  })
  it('rejects invalid input', () => {
    expect(parseHexColor('#fff')).toBeNull()
    expect(parseHexColor('nope')).toBeNull()
    expect(parseHexColor(null)).toBeNull()
    expect(parseHexColor(undefined)).toBeNull()
  })
})

describe('normalizeHexColor', () => {
  it('lowercases and adds the hash', () => {
    expect(normalizeHexColor('4F46E5')).toBe('#4f46e5')
    expect(normalizeHexColor('#FF8800')).toBe('#ff8800')
  })
  it('returns null for invalid', () => {
    expect(normalizeHexColor('xyz')).toBeNull()
  })
})

describe('detectImageKind', () => {
  it('detects PNG', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(detectImageKind(png)).toBe('png')
  })
  it('detects JPEG', () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    expect(detectImageKind(jpg)).toBe('jpg')
  })
  it('returns null for other bytes', () => {
    expect(detectImageKind(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull()
    expect(detectImageKind(new Uint8Array([]))).toBeNull()
  })
})
