/**
 * Pure branding helpers — no DB, no IO. Used by the ticket PDF renderer and the
 * dashboard settings validation.
 */

export interface RgbColor {
  r: number
  g: number
  b: number
}

/** Parse `#rrggbb` (or `rrggbb`) into 0–255 components, or null if invalid. */
export function parseHexColor(hex: string | null | undefined): RgbColor | null {
  if (typeof hex !== 'string') return null
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** Normalize a hex color to `#rrggbb` lowercase, or null if invalid. */
export function normalizeHexColor(
  hex: string | null | undefined,
): string | null {
  const c = parseHexColor(hex)
  if (!c) return null
  const h = (v: number) => v.toString(16).padStart(2, '0')
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`
}

export type ImageKind = 'png' | 'jpg'

/** Detect PNG/JPEG from magic bytes; null for anything else. */
export function detectImageKind(bytes: Uint8Array): ImageKind | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png'
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'jpg'
  }
  return null
}
