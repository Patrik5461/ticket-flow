/**
 * Global admin search across organizers, events, and orders. Reuses the existing
 * admin_search_orders RPC (buyer email / order ref / GoPay id) and adds
 * organizer-name and event-title lookups. requirePlatformAdmin.
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { serviceClient } from '../lib/supabase/server'
import { requirePlatformAdmin, runAdmin, AdminError } from './admin'
import type { OrderSearchItem } from './admin-orders'

export interface GlobalSearchResult {
  organizers: { id: string; name: string; slug: string; status: string }[]
  events: {
    id: string
    title: string
    slug: string
    status: string
    organizerName: string
  }[]
  orders: OrderSearchItem[]
}

export const globalSearchFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) =>
    z.object({ query: z.string().trim().min(2).max(200) }).parse(d),
  )
  .handler(
    async ({ data }): Promise<GlobalSearchResult | { error: string }> => {
      return runAdmin(async () => {
        await requirePlatformAdmin()
        const db = serviceClient()
        const like = `%${data.query}%`

        const [orderRes, orgRes, evRes] = await Promise.all([
          db.rpc('admin_search_orders', { p_q: data.query }),
          db
            .from('organizers')
            .select('id, name, slug, status')
            .ilike('name', like)
            .order('name', { ascending: true })
            .limit(10)
            .returns<
              { id: string; name: string; slug: string; status: string }[]
            >(),
          db
            .from('events')
            .select('id, title, slug, status, organizers(name)')
            .ilike('title', like)
            .order('starts_at', { ascending: false })
            .limit(10)
            .returns<
              {
                id: string
                title: string
                slug: string
                status: string
                organizers: { name: string } | null
              }[]
            >(),
        ])

        if (orderRes.error) throw new AdminError('Vyhľadávanie zlyhalo.')

        return {
          organizers: orgRes.data ?? [],
          events: (evRes.data ?? []).map((e) => ({
            id: e.id,
            title: e.title,
            slug: e.slug,
            status: e.status,
            organizerName: e.organizers?.name ?? '—',
          })),
          orders: (orderRes.data ?? []) as OrderSearchItem[],
        }
      })
    },
  )
