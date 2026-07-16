import { createFileRoute } from '@tanstack/react-router'
import { anonClient } from '../lib/supabase/server'
import { SITE_URL } from '../lib/site'

const STATIC_PATHS = [
  '/',
  '/cennik',
  '/ako-to-funguje',
  '/kontakt',
  '/obchodne-podmienky',
  '/gdpr',
  '/cookies',
]

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function urlTag(loc: string, lastmod?: string): string {
  return `  <url><loc>${xmlEscape(loc)}</loc>${
    lastmod ? `<lastmod>${lastmod}</lastmod>` : ''
  }</url>`
}

async function build(): Promise<string> {
  const urls = STATIC_PATHS.map((p) => urlTag(`${SITE_URL}${p}`))

  // Published events (public data via anon client).
  const { data } = await anonClient()
    .from('events')
    .select('slug')
    .eq('status', 'published')
    .order('starts_at', { ascending: false })
    .returns<{ slug: string }[]>()
  for (const e of data ?? []) {
    urls.push(urlTag(`${SITE_URL}/e/${e.slug}`))
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`
}

export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: async () =>
        new Response(await build(), {
          status: 200,
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        }),
    },
  },
})
