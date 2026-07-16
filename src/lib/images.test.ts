import { describe, it, expect } from 'vitest'
import { detectCoverMime, coverExt } from './images'

describe('detectCoverMime', () => {
  it('detects PNG/JPEG/WebP', () => {
    expect(
      detectCoverMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])),
    ).toBe('image/png')
    expect(detectCoverMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'image/jpeg',
    )
    expect(
      detectCoverMime(
        new Uint8Array([
          0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
        ]),
      ),
    ).toBe('image/webp')
  })
  it('rejects other/short input', () => {
    expect(detectCoverMime(new Uint8Array([0x47, 0x49, 0x46]))).toBeNull()
    expect(detectCoverMime(new Uint8Array([]))).toBeNull()
  })
})

describe('coverExt', () => {
  it('maps mime to extension', () => {
    expect(coverExt('image/png')).toBe('png')
    expect(coverExt('image/jpeg')).toBe('jpg')
    expect(coverExt('image/webp')).toBe('webp')
  })
})
