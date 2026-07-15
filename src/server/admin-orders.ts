/**
 * Platform-admin order search + detail for support. Read-only (no mutations, no
 * audit). Guarded by requirePlatformAdmin. Search runs through the
 * admin_search_orders SQL function (PostgREST cannot ilike a uuid column).
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { serviceClient } from '../lib/supabase/server'
import { requirePlatformAdmin, runAdmin, AdminError } from './admin'
import type { OrderStatus } from '../lib/db-types'

export interface OrderSearchItem {
  id: string
  ref: string
  buyer_email: string
  buyer_name: string | null
  status: OrderStatus
  total_cents: number
  created_at: string
  paid_at: string | null
  event_id: string
  event_title: string
  organizer_id: string
  organizer_name: string
}

export const searchOrdersFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) =>
    z.object({ query: z.string().trim().min(2).max(200) }).parse(d),
  )
  .handler(async ({ data }): Promise<OrderSearchItem[] | { error: string }> => {
    return runAdmin(async () => {
      await requirePlatformAdmin()
      const { data: rows, error } = await serviceClient().rpc(
        'admin_search_orders',
        { p_q: data.query },
      )
      if (error) throw new AdminError('Vyhľadávanie zlyhalo.')
      return (rows ?? []) as OrderSearchItem[]
    })
  })

export interface OrderAdminDetail {
  order: {
    id: string
    ref: string
    status: OrderStatus
    buyer_email: string
    buyer_name: string | null
    buyer_phone: string | null
    subtotal_cents: number
    discount_cents: number
    total_cents: number
    fee_cents: number
    gopay_payment_id: string | null
    created_at: string
    paid_at: string | null
    expires_at: string | null
  }
  event: {
    id: string
    title: string
    slug: string
    timezone: string
    organizerId: string
    organizerName: string
  }
  items: { name: string; quantity: number; unit_price_cents: number }[]
  tickets: { total: number; valid: number; used: number; cancelled: number }
  payments: { state: string; created_at: string }[]
}

interface RawEvent {
  id: string
  title: string
  slug: string
  timezone: string
  organizer_id: string
  organizers: { name: string } | null
}

export const getOrderAdminFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => z.object({ orderId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<OrderAdminDetail | { error: string }> => {
    return runAdmin(async () => {
      await requirePlatformAdmin()
      const db = serviceClient()

      const { data: order } = await db
        .from('orders')
        .select('*')
        .eq('id', data.orderId)
        .maybeSingle<{
          id: string
          event_id: string
          status: OrderStatus
          buyer_email: string
          buyer_name: string | null
          buyer_phone: string | null
          subtotal_cents: number
          discount_cents: number
          total_cents: number
          fee_cents: number
          gopay_payment_id: string | null
          created_at: string
          paid_at: string | null
          expires_at: string | null
        }>()
      if (!order) throw new AdminError('Objednávka sa nenašla.')

      const [
        { data: event },
        { data: items },
        { data: tickets },
        { data: payments },
      ] = await Promise.all([
        db
          .from('events')
          .select('id, title, slug, timezone, organizer_id, organizers(name)')
          .eq('id', order.event_id)
          .maybeSingle<RawEvent>(),
        db
          .from('order_items')
          .select('quantity, unit_price_cents, ticket_types(name)')
          .eq('order_id', order.id)
          .returns<
            {
              quantity: number
              unit_price_cents: number
              ticket_types: { name: string } | null
            }[]
          >(),
        db
          .from('tickets')
          .select('status')
          .eq('order_id', order.id)
          .returns<{ status: 'valid' | 'used' | 'cancelled' }[]>(),
        db
          .from('payment_events')
          .select('state, created_at')
          .eq('order_id', order.id)
          .order('created_at', { ascending: true })
          .returns<{ state: string; created_at: string }[]>(),
      ])

      const t = tickets ?? []
      return {
        order: {
          id: order.id,
          ref: order.id.slice(0, 8).toUpperCase(),
          status: order.status,
          buyer_email: order.buyer_email,
          buyer_name: order.buyer_name,
          buyer_phone: order.buyer_phone,
          subtotal_cents: order.subtotal_cents,
          discount_cents: order.discount_cents,
          total_cents: order.total_cents,
          fee_cents: order.fee_cents,
          gopay_payment_id: order.gopay_payment_id,
          created_at: order.created_at,
          paid_at: order.paid_at,
          expires_at: order.expires_at,
        },
        event: {
          id: event?.id ?? order.event_id,
          title: event?.title ?? '—',
          slug: event?.slug ?? '',
          timezone: event?.timezone ?? 'Europe/Bratislava',
          organizerId: event?.organizer_id ?? '',
          organizerName: event?.organizers?.name ?? '—',
        },
        items: (items ?? []).map((i) => ({
          name: i.ticket_types?.name ?? '—',
          quantity: i.quantity,
          unit_price_cents: i.unit_price_cents,
        })),
        tickets: {
          total: t.length,
          valid: t.filter((x) => x.status === 'valid').length,
          used: t.filter((x) => x.status === 'used').length,
          cancelled: t.filter((x) => x.status === 'cancelled').length,
        },
        payments: payments ?? [],
      }
    })
  })
