import { createFileRoute } from '@tanstack/react-router'
import { anonClient } from '../lib/supabase/server'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Naive word-wrap into at most `maxLines` lines of ~`perLine` chars. */
function wrap(text: string, perLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > perLine) {
      if (cur) lines.push(cur)
      cur = w
      if (lines.length === maxLines - 1) break
    } else {
      cur = (cur + ' ' + w).trim()
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur)
  const rest = words.slice(lines.join(' ').split(/\s+/).length)
  if (rest.length && lines.length) lines[lines.length - 1] += '…'
  return lines
}

function svg(title: string, subtitle: string): string {
  const lines = wrap(title, 22, 3)
  const tspans = lines
    .map((l, i) => `<tspan x="80" dy="${i === 0 ? 0 : 84}">${esc(l)}</tspan>`)
    .join('')
  const startY = 300 - (lines.length - 1) * 42
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#111827"/>
      <stop offset="1" stop-color="#4f46e5"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <text x="80" y="120" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="34" font-weight="700" fill="#c7d2fe" letter-spacing="2">TICKETIO</text>
  <text y="${startY}" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="72" font-weight="800" fill="#ffffff">${tspans}</text>
  <text x="80" y="560" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="30" fill="#e0e7ff">${esc(subtitle)}</text>
</svg>`
}

/**
 * Generated OG image fallback for events without a cover. Returns a branded SVG
 * with the event title. Public data via anon client.
 */
export const Route = createFileRoute('/api/og/$slug')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { data: event } = await anonClient()
          .from('events')
          .select('title, venue_name')
          .eq('slug', params.slug)
          .eq('status', 'published')
          .maybeSingle<{ title: string; venue_name: string | null }>()

        const title = event?.title ?? 'Podujatie'
        const subtitle = event?.venue_name ?? 'Vstupenky online'
        return new Response(svg(title, subtitle), {
          status: 200,
          headers: {
            'Content-Type': 'image/svg+xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        })
      },
    },
  },
})
