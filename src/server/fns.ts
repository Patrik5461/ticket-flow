/**
 * Server functions — the RPC surface the client (loaders + forms) calls. Each
 * validates its input with zod before touching the domain service. All price and
 * capacity logic lives server-side in order-service.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  createOrder,
  getOrderView,
  getPublicEvent,
  listPublishedEvents,
  previewPricing,
  OrderError,
} from './order-service'
import { lookupCompanyByIco, normalizeIco } from '../lib/rpo'
import { joinWaitlist } from './waitlist'
import { serviceClient } from '../lib/supabase/server'

const cartItemsSchema = z
  .array(
    z.object({
      ticketTypeId: z.string().uuid(),
      quantity: z.number().int().min(0).max(100),
    }),
  )
  .max(50)

export const getEventFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => z.object({ slug: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    return getPublicEvent(data.slug)
  })

export const listEventsFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    return listPublishedEvents()
  },
)

export const previewPricingFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        slug: z.string().min(1),
        items: cartItemsSchema,
        couponCode: z.string().trim().min(1).max(64).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    return previewPricing(data.slug, data.items, data.couponCode)
  })

export const createOrderFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        slug: z.string().min(1),
        items: cartItemsSchema,
        buyer: z.object({
          email: z.string().email(),
          name: z.string().trim().max(120).optional(),
          phone: z.string().trim().max(40).optional(),
        }),
        couponCode: z.string().trim().min(1).max(64).optional().nullable(),
        answers: z
          .record(z.string(), z.array(z.record(z.string(), z.string())))
          .optional()
          .nullable(),
        billing: z
          .object({
            ico: z.string().trim().max(20).optional().nullable(),
            dic: z.string().trim().max(20).optional().nullable(),
            icDph: z.string().trim().max(20).optional().nullable(),
            name: z.string().trim().max(200).optional().nullable(),
            address: z.string().trim().max(300).optional().nullable(),
          })
          .optional()
          .nullable(),
        acceptTerms: z.boolean().refine((v) => v === true, {
          message: 'Musíte súhlasiť s obchodnými podmienkami.',
        }),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      return await createOrder({
        slug: data.slug,
        items: data.items,
        buyer: data.buyer,
        couponCode: data.couponCode,
        billing: data.billing,
        answers: data.answers,
      })
    } catch (e) {
      if (e instanceof OrderError) {
        return { error: e.message } as const
      }
      throw e
    }
  })

export const getOrderFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) =>
    z.object({ orderId: z.string().uuid(), token: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    return getOrderView(data.orderId, data.token)
  })

/** RPO company lookup by IČO for the "kúpiť na firmu" checkout option. */
export const lookupCompanyFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z.object({ ico: z.string().trim().min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    if (!normalizeIco(data.ico)) {
      return { error: 'Neplatné IČO.' } as const
    }
    const company = await lookupCompanyByIco(data.ico)
    if (!company) return { error: 'Firma sa nenašla v registri.' } as const
    return { company } as const
  })

/** Public waitlist signup: watch a (sold-out) ticket type for availability. */
export const joinWaitlistFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        slug: z.string().min(1),
        ticketTypeId: z.string().uuid(),
        email: z.string().trim().email().max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    return joinWaitlist(serviceClient(), data)
  })
