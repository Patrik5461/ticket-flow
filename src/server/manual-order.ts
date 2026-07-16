/**
 * Manual order server fn: an organizer records an on-site / bank-transfer sale.
 * Authorized for an owner/admin of the event's organizer (or a platform admin).
 * Exports only the server fn, so the handler's imports are stripped from the
 * client bundle.
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireEventManager, EventAuthzError } from './event-authz'
import { createManualOrder, OrderError } from './order-service'

export const createManualOrderFn = createServerFn({ method: 'POST' })
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
        buyer: z.object({
          email: z.string().email(),
          name: z.string().trim().max(120).optional(),
          phone: z.string().trim().max(40).optional(),
        }),
      })
      .parse(d),
  )
  .handler(
    async ({
      data,
    }): Promise<{ ok: true; orderId: string } | { error: string }> => {
      try {
        await requireEventManager(data.eventId)
        const res = await createManualOrder({
          eventId: data.eventId,
          items: data.items,
          buyer: data.buyer,
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
