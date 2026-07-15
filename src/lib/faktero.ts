/**
 * Invoice provider abstraction for platform-commission invoices. The concrete
 * provider is Faktero (env FAKTERO_API_KEY + FAKTERO_API_URL); without both, a
 * log-only provider is used so the flow works end to end in dev without any
 * external call. Server-only.
 *
 * NOTE: the Faktero request/response shape below is a best-effort mapping and
 * must be reconciled with Faktero's API docs once credentials are available — it
 * is never exercised until the env vars are set.
 */

import { getEnv } from './env'

export interface InvoiceCustomer {
  name: string
  ico: string | null
  dic: string | null
  icDph: string | null
  email: string | null
  address: string | null
}

export interface InvoiceRequest {
  /** Who the invoice is billed to (the organizer). */
  customer: InvoiceCustomer
  /** Human period label, e.g. "jún 2026". */
  periodLabel: string
  /** Commission amount in cents (EUR). */
  amountCents: number
  /** Free-text description of the line item. */
  description: string
  /** Idempotency hint (e.g. settlement id) so retries don't double-invoice. */
  externalId: string
}

export interface InvoiceResult {
  /** Provider invoice id / number, stored on the settlement. */
  id: string
}

export interface InvoiceProvider {
  createInvoice: (req: InvoiceRequest) => Promise<InvoiceResult>
}

/** Dev/no-config provider: logs the invoice instead of calling out. */
export class LogInvoiceProvider implements InvoiceProvider {
  async createInvoice(req: InvoiceRequest): Promise<InvoiceResult> {
    console.log(
      `[invoice:log] ${req.customer.name} (IČO ${req.customer.ico ?? '—'}) — ` +
        `${(req.amountCents / 100).toFixed(2)} EUR — ${req.description}`,
    )
    return { id: `LOG-${req.externalId}` }
  }
}

/** Faktero REST provider. Shape TBD against Faktero docs (see file note). */
export class FakteroClient implements InvoiceProvider {
  constructor(
    private apiKey: string,
    private apiUrl: string,
  ) {}

  async createInvoice(req: InvoiceRequest): Promise<InvoiceResult> {
    const res = await fetch(`${this.apiUrl.replace(/\/$/, '')}/invoices`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        external_id: req.externalId,
        client: {
          name: req.customer.name,
          ico: req.customer.ico,
          dic: req.customer.dic,
          ic_dph: req.customer.icDph,
          email: req.customer.email,
          address: req.customer.address,
        },
        currency: 'EUR',
        items: [
          {
            name: req.description,
            unit_price: req.amountCents / 100,
            quantity: 1,
          },
        ],
        note: `Provízia platformy Ticketio — ${req.periodLabel}`,
      }),
    })
    if (!res.ok) {
      throw new Error(
        `Faktero createInvoice failed: ${res.status} ${await res.text()}`,
      )
    }
    const json = (await res.json()) as { id?: string | number; number?: string }
    return { id: String(json.id ?? json.number ?? req.externalId) }
  }
}

let provider: InvoiceProvider | null = null

export function getInvoiceProvider(): InvoiceProvider {
  if (!provider) {
    const env = getEnv()
    provider =
      env.FAKTERO_API_KEY && env.FAKTERO_API_URL
        ? new FakteroClient(env.FAKTERO_API_KEY, env.FAKTERO_API_URL)
        : new LogInvoiceProvider()
  }
  return provider
}
