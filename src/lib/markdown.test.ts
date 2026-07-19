import { describe, it, expect } from 'vitest'
import { parseMarkdown, sanitizeHref } from './markdown'

describe('sanitizeHref', () => {
  it('allows http/https/mailto and relative/anchor', () => {
    expect(sanitizeHref('https://ticketio.sk')).toBe('https://ticketio.sk')
    expect(sanitizeHref('http://x.sk')).toBe('http://x.sk')
    expect(sanitizeHref('mailto:a@b.sk')).toBe('mailto:a@b.sk')
    expect(sanitizeHref('/cennik')).toBe('/cennik')
    expect(sanitizeHref('#sekcia')).toBe('#sekcia')
  })

  it('rejects javascript: and other schemes', () => {
    expect(sanitizeHref('javascript:alert(1)')).toBeNull()
    expect(sanitizeHref('  javascript:alert(1)')).toBeNull()
    expect(sanitizeHref('data:text/html,<script>')).toBeNull()
    expect(sanitizeHref('vbscript:x')).toBeNull()
  })
})

describe('parseMarkdown', () => {
  it('parses headings by level', () => {
    const b = parseMarkdown('# A\n## B\n### C')
    expect(b).toEqual([
      { type: 'heading', level: 1, children: [{ type: 'text', value: 'A' }] },
      { type: 'heading', level: 2, children: [{ type: 'text', value: 'B' }] },
      { type: 'heading', level: 3, children: [{ type: 'text', value: 'C' }] },
    ])
  })

  it('groups lines into paragraphs split by blank lines', () => {
    const b = parseMarkdown('one\ntwo\n\nthree')
    expect(b).toHaveLength(2)
    expect(b[0]).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', value: 'one two' }],
    })
    expect(b[1]).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', value: 'three' }],
    })
  })

  it('parses unordered and ordered lists', () => {
    const ul = parseMarkdown('- a\n- b')
    expect(ul[0]).toEqual({
      type: 'list',
      ordered: false,
      items: [[{ type: 'text', value: 'a' }], [{ type: 'text', value: 'b' }]],
    })
    const ol = parseMarkdown('1. a\n2. b')
    expect(ol[0].type).toBe('list')
    expect((ol[0] as { ordered: boolean }).ordered).toBe(true)
  })

  it('parses bold and italic', () => {
    const b = parseMarkdown('a **bold** and *it* here')
    expect(b[0]).toEqual({
      type: 'paragraph',
      children: [
        { type: 'text', value: 'a ' },
        { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
        { type: 'text', value: ' and ' },
        { type: 'em', children: [{ type: 'text', value: 'it' }] },
        { type: 'text', value: ' here' },
      ],
    })
  })

  it('parses safe links and keeps only the label for unsafe hrefs', () => {
    const safe = parseMarkdown('see [site](https://x.sk)')
    expect(safe[0]).toEqual({
      type: 'paragraph',
      children: [
        { type: 'text', value: 'see ' },
        {
          type: 'link',
          href: 'https://x.sk',
          children: [{ type: 'text', value: 'site' }],
        },
      ],
    })

    const unsafe = parseMarkdown('[click](javascript:alert)')
    // No link node — label survives as plain text, href is dropped.
    expect(JSON.stringify(unsafe)).not.toContain('javascript')
    expect(unsafe[0]).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', value: 'click' }],
    })
  })

  it('never emits raw HTML — angle brackets stay as text', () => {
    const b = parseMarkdown('<script>alert(1)</script>')
    expect(b[0]).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', value: '<script>alert(1)</script>' }],
    })
  })
})
