/**
 * Load an organizer's branding (accent color + logo bytes) for ticket rendering.
 * Tolerant: returns empty branding if the columns/bucket don't exist yet or the
 * logo can't be fetched, so ticket PDFs always render.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { detectImageKind  } from '../lib/tickets/branding'
import type {ImageKind} from '../lib/tickets/branding';

export interface OrganizerBrand {
  color: string | null
  logo: { bytes: Uint8Array; kind: ImageKind } | null
}

const EMPTY: OrganizerBrand = { color: null, logo: null }

export async function loadOrganizerBrand(
  db: SupabaseClient,
  organizerId: string,
): Promise<OrganizerBrand> {
  try {
    const { data, error } = await db
      .from('organizers')
      .select('brand_color, brand_logo_url')
      .eq('id', organizerId)
      .maybeSingle<{
        brand_color: string | null
        brand_logo_url: string | null
      }>()
    if (error || !data) return EMPTY

    let logo: OrganizerBrand['logo'] = null
    if (data.brand_logo_url) {
      try {
        const res = await fetch(data.brand_logo_url)
        if (res.ok) {
          const bytes = new Uint8Array(await res.arrayBuffer())
          const kind = detectImageKind(bytes)
          if (kind) logo = { bytes, kind }
        }
      } catch {
        // Network/storage hiccup — render without the logo.
      }
    }
    return { color: data.brand_color, logo }
  } catch {
    // Columns not present yet (migration not applied) — degrade gracefully.
    return EMPTY
  }
}
