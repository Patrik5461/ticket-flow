/**
 * Minimal GoPay REST client (inline gateway). Server-only.
 *
 * Never trust a webhook payload — always re-read payment state from the API
 * (getPaymentStatus) before acting on it.
 *
 * Docs: https://doc.gopay.com/  (REST API)
 */

import { getEnv, isGoPayConfigured } from './env'

const BASE_URLS = {
  sandbox: 'https://gw.sandbox.gopay.com/api',
  production: 'https://gate.gopay.cz/api',
} as const

export type GoPayState =
  | 'CREATED'
  | 'PAID'
  | 'CANCELED'
  | 'TIMEOUTED'
  | 'AUTHORIZED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | (string & {})

export interface GoPayPayment {
  id: number
  state: GoPayState
  amount: number
  currency: string
  order_number?: string
  gw_url?: string
}

export interface CreatePaymentInput {
  amountCents: number
  orderNumber: string
  description: string
  buyer: { email: string; name?: string | null }
  items: { name: string; amountCents: number; count: number }[]
  returnUrl: string
  notificationUrl: string
}

function baseUrl(): string {
  return BASE_URLS[getEnv().GOPAY_ENV]
}

function assertConfigured(): void {
  if (!isGoPayConfigured()) {
    throw new Error(
      'GoPay nie je nakonfigurovaný (chýba GOPAY_GOID / GOPAY_CLIENT_ID / GOPAY_CLIENT_SECRET).',
    )
  }
}

async function accessToken(): Promise<string> {
  const env = getEnv()
  const basic = Buffer.from(
    `${env.GOPAY_CLIENT_ID}:${env.GOPAY_CLIENT_SECRET}`,
  ).toString('base64')

  const res = await fetch(`${baseUrl()}/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials&scope=payment-create',
  })

  if (!res.ok) {
    throw new Error(`GoPay OAuth failed: ${res.status} ${await res.text()}`)
  }
  const json = (await res.json()) as { access_token: string }
  return json.access_token
}

export async function createPayment(
  input: CreatePaymentInput,
): Promise<GoPayPayment> {
  assertConfigured()
  const env = getEnv()
  const token = await accessToken()

  const body = {
    payer: {
      default_payment_instrument: 'PAYMENT_CARD',
      contact: {
        email: input.buyer.email,
        ...(input.buyer.name ? { first_name: input.buyer.name } : {}),
      },
    },
    target: { type: 'ACCOUNT', goid: Number(env.GOPAY_GOID) },
    amount: input.amountCents,
    currency: 'EUR',
    order_number: input.orderNumber,
    order_description: input.description,
    items: input.items.map((i) => ({
      name: i.name,
      amount: i.amountCents,
      count: i.count,
    })),
    callback: {
      return_url: input.returnUrl,
      notification_url: input.notificationUrl,
    },
    lang: 'SK',
  }

  const res = await fetch(`${baseUrl()}/payments/payment`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    throw new Error(`GoPay createPayment failed: ${res.status} ${await res.text()}`)
  }
  return (await res.json()) as GoPayPayment
}

export async function getPaymentStatus(paymentId: string): Promise<GoPayPayment> {
  assertConfigured()
  const token = await accessToken()
  const res = await fetch(`${baseUrl()}/payments/payment/${paymentId}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`GoPay getStatus failed: ${res.status} ${await res.text()}`)
  }
  return (await res.json()) as GoPayPayment
}
