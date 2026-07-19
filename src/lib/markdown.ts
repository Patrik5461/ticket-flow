/**
 * Minimal, safe Markdown parser for CMS content blocks. It parses a supported
 * subset — headings (#, ##, ###), paragraphs, unordered/ordered lists,
 * **bold**, *italic* / _italic_, and [links](url) — into a typed token tree.
 *
 * Safety: the parser never produces HTML. It emits structured tokens that the
 * renderer maps to React elements, so raw HTML in the source is treated as
 * plain text (React escapes it) and cannot inject markup. Link hrefs are
 * allow-listed (http/https/mailto + relative/anchor); anything else (e.g.
 * javascript:) is dropped and the label rendered as text. Pure + testable.
 */

export type MdInline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: MdInline[] }
  | { type: 'em'; children: MdInline[] }
  | { type: 'link'; href: string; children: MdInline[] }

export type MdBlock =
  | { type: 'heading'; level: 1 | 2 | 3; children: MdInline[] }
  | { type: 'paragraph'; children: MdInline[] }
  | { type: 'list'; ordered: boolean; items: MdInline[][] }

/** Allow only safe href schemes. Returns null for anything else. */
export function sanitizeHref(raw: string): string | null {
  const href = raw.trim()
  if (/^(https?:\/\/|mailto:)/i.test(href)) return href
  if (/^[/#]/.test(href)) return href // relative path or in-page anchor
  return null
}

function parseInline(text: string): MdInline[] {
  const nodes: MdInline[] = []
  let buf = ''
  let i = 0
  const flush = () => {
    if (buf) {
      nodes.push({ type: 'text', value: buf })
      buf = ''
    }
  }

  while (i < text.length) {
    const rest = text.slice(i)

    // [label](href)
    const link = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest)
    if (link) {
      const href = sanitizeHref(link[2])
      if (href) {
        flush()
        nodes.push({ type: 'link', href, children: parseInline(link[1]) })
      } else {
        buf += link[1] // unsafe href → keep only the visible label
      }
      i += link[0].length
      continue
    }

    // **bold**
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2)
      if (end !== -1) {
        flush()
        nodes.push({
          type: 'strong',
          children: parseInline(text.slice(i + 2, end)),
        })
        i = end + 2
        continue
      }
    }

    // *italic* or _italic_
    const ch = text[i]
    if (ch === '*' || ch === '_') {
      const end = text.indexOf(ch, i + 1)
      if (end > i + 1) {
        flush()
        nodes.push({
          type: 'em',
          children: parseInline(text.slice(i + 1, end)),
        })
        i = end + 1
        continue
      }
    }

    buf += text[i]
    i++
  }

  flush()
  return nodes
}

export function parseMarkdown(md: string): MdBlock[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MdBlock[] = []
  let para: string[] = []
  let i = 0

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: 'paragraph', children: parseInline(para.join(' ')) })
      para = []
    }
  }

  while (i < lines.length) {
    const trimmed = lines[i].trim()

    if (trimmed === '') {
      flushPara()
      i++
      continue
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed)
    if (heading) {
      flushPara()
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        children: parseInline(heading[2].trim()),
      })
      i++
      continue
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushPara()
      const items: MdInline[][] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(parseInline(lines[i].trim().replace(/^[-*]\s+/, '')))
        i++
      }
      blocks.push({ type: 'list', ordered: false, items })
      continue
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushPara()
      const items: MdInline[][] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(parseInline(lines[i].trim().replace(/^\d+\.\s+/, '')))
        i++
      }
      blocks.push({ type: 'list', ordered: true, items })
      continue
    }

    para.push(trimmed)
    i++
  }

  flushPara()
  return blocks
}
