import { Fragment } from 'react'
import { parseMarkdown } from '../lib/markdown'
import type { MdInline, MdBlock } from '../lib/markdown'

/**
 * Renders CMS Markdown as React elements. Security lives in the parser
 * (src/lib/markdown.ts): tokens carry only safe hrefs and no HTML, and here we
 * map tokens to elements without ever using dangerouslySetInnerHTML — so source
 * markup cannot inject anything.
 */

function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

function renderInline(nodes: MdInline[]): React.ReactNode {
  return nodes.map((n, i) => {
    switch (n.type) {
      case 'text':
        return <Fragment key={i}>{n.value}</Fragment>
      case 'strong':
        return (
          <strong key={i} className="font-semibold text-ink-100">
            {renderInline(n.children)}
          </strong>
        )
      case 'em':
        return <em key={i}>{renderInline(n.children)}</em>
      case 'link':
        return (
          <a
            key={i}
            href={n.href}
            className="text-accent underline"
            {...(isExternal(n.href)
              ? { target: '_blank', rel: 'noopener noreferrer' }
              : {})}
          >
            {renderInline(n.children)}
          </a>
        )
    }
  })
}

function renderBlock(block: MdBlock, key: number): React.ReactNode {
  switch (block.type) {
    case 'heading': {
      const cls = 'mt-8 mb-2 font-display font-semibold text-ink-100'
      if (block.level === 1)
        return (
          <h2 key={key} className={`${cls} text-2xl`}>
            {renderInline(block.children)}
          </h2>
        )
      if (block.level === 2)
        return (
          <h2 key={key} className={`${cls} text-lg`}>
            {renderInline(block.children)}
          </h2>
        )
      return (
        <h3 key={key} className={`${cls} text-base`}>
          {renderInline(block.children)}
        </h3>
      )
    }
    case 'paragraph':
      return <p key={key}>{renderInline(block.children)}</p>
    case 'list': {
      const items = block.items.map((it, i) => (
        <li key={i}>{renderInline(it)}</li>
      ))
      return block.ordered ? (
        <ol key={key} className="list-decimal space-y-1 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={key} className="list-disc space-y-1 pl-5">
          {items}
        </ul>
      )
    }
  }
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source)
  return <>{blocks.map((b, i) => renderBlock(b, i))}</>
}
