/**
 * Canonical public site URL, used for absolute URLs in SEO tags, sitemap, and
 * OG images. Overridable via VITE_SITE_URL; defaults to the production domain.
 */

const raw =
  (import.meta.env.VITE_SITE_URL as string | undefined) || 'https://ticketio.sk'

export const SITE_URL = raw.replace(/\/+$/, '')

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}
