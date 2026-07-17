/**
 * POS server fns: on-site point-of-sale. createPosOrderFn records a cash/terminal
 * sale (no GoPay) and issues tickets; getPosReceiptFn returns a completed sale's
 * receipt + tickets for the staff print page. Both authorized for an owner/admin
 * of the event's organizer (or a platform admin).
 *
 * Exports only server fns, so the handlers' imports stay out of the client bundle.
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { serviceClient } from '../lib/supabase/server'
import { requireEventManager, EventAuthzError } from './event-authz'
import { createPosOrder, getPosReceipt, OrderError } from './order-service'
import type { PosReceiptView } from './order-service'

export const createPosOrderFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        items: z
          .array(
            z.object({
              ticketTypeId: z.string().uuid(),
              quantity: z.number().int().min(1).max(100),
            }),
          )
          .min(1)
          .max(50),
        paymentMethod: z.enum(['cash', 'terminal']),
        // Cents tendered in cash (required for cash, validated server-side).
        cashReceivedCents: z.number().int().min(0).max(10_000_000).nullish(),
        buyerEmail: z.string().email().max(200).nullish(),
      })
      .parse(d),
  )
  .handler(
    async ({
      data,
    }): Promise<{ ok: true; orderId: string } | { error: string }> => {
      try {
        await requireEventManager(data.eventId)
        const res = await createPosOrder({
          eventId: data.eventId,
          items: data.items,
          paymentMethod: data.paymentMethod,
          cashReceivedCents: data.cashReceivedCents ?? null,
          buyerEmail: data.buyerEmail ?? null,
        })
        return { ok: true as const, orderId: res.orderId }
      } catch (e) {
        if (e instanceof EventAuthzError || e instanceof OrderError) {
          return { error: e.message }
        }
        throw e
      }
    },
  )

export const getPosReceiptFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) =>
    z.object({ orderId: z.string().uuid() }).parse(d),
  )
  .handler(
    async ({ data }): Promise<PosReceiptView | { error: string }> => {
      try {
        // Authorize against the order's event before assembling the receipt.
        const { data: ord } = await serviceClient()
          .from('orders')
          .select('event_id')
          .eq('id', data.orderId)
          .maybeSingle<{ event_id: string }>()
        if (!ord) return { error: 'Doklad sa nenašiel.' }
        await requireEventManager(ord.event_id)

        const receipt = await getPosReceipt(data.orderId)
        if (!receipt) return { error: 'Doklad sa nenašiel.' }
        return receipt
      } catch (e) {
        if (e instanceof EventAuthzError) return { error: e.message }
        throw e
      }
    },
  )
