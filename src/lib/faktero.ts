/**
 * Invoice provider abstraction for platform-commission invoices. The concrete
 * provider is Faktero (env FAKTERO_API_KEY + FAKTERO_API_URL); without both,
 * invoicing reports itself as unconfigured and the caller leaves the settlement
 * alone rather than inventing an invoice reference. Server-only.
 *
 * The whole chain was run against the real API with a test key on 2026-08-05 —
 * create customer, issue, look up, send — rather than being read off the docs
 * page. What that settled, in the order it bites:
 *
 *   - An invoice is billed to a `customer_id`; customer data cannot be sent
 *     inline. The customer has to exist first, so createInvoice() creates one on
 *     demand and hands the id back for the caller to store.
 *   - `external_id` is undocumented on POST but is accepted and stored, on both
 *     customers and invoices — which is what makes findByExternalId work. So is
 *     `dic`, also undocumented.
 *   - Issuing is idempotent on `external_id`: the first POST answers 201, a
 *     repeat answers 200 with the same invoice id and number, and no second
 *     invoice appears. Verified, not assumed — but the reconciliation in
 *     settlement-invoicing.ts does not lean on it, so this staying true is not
 *     the only thing between an organizer and a double bill.
 *   - `GET /customers?external_id=…` accepts the parameter and ignores it,
 *     answering with the whole list. Looking a customer up by external_id over
 *     the API is therefore not possible, and we keep the mapping on our side.
 */

import { getEnv } from './env'

/** Ticketio is not a VAT payer — the commission is invoiced without DPH. */
const VAT_RATE = 0
/** Payment term for commission invoices. */
const DUE_DAYS = 7
/** Faktero wants a unit on every line; the commission is a single item. */
const UNIT = 'ks'

export interface InvoiceCustomer {
  name: string
  ico: string | null
  dic: string | null
  icDph: string | null
  email: string | null
  address: string | null
  /** Our organizer id — stored on the Faktero customer as external_id. */
  externalId: string
  /** Faktero customer id if we already created one, else null. */
  providerId: string | null
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
  /**
   * Provider invoice id. This is the handle every later call needs —
   * GET /invoices/{id}/pdf, POST /invoices/{id}/send, /mark-paid, /cancel —
   * so it is what gets stored, not the human invoice number.
   */
  id: string
  /** Invoice number as printed, e.g. "20260901". For people, not for calls. */
  number?: string
  /** Provider customer id, so the next invoice skips creating one. */
  customerId?: string
  /** When the provider already mailed it, if it says so. */
  sentAt?: string | null
}

export interface InvoiceProvider {
  createInvoice: (req: InvoiceRequest) => Promise<InvoiceResult>
  /**
   * Find an invoice previously created with this external_id, so a retry after
   * an uncertain failure adopts it instead of billing the organizer twice.
   * Resolves to null when the provider is sure there is none. Providers that
   * cannot answer the question leave the method off entirely — the caller then
   * knows not to retry rather than being told "not found".
   */
  findByExternalId?: (externalId: string) => Promise<InvoiceResult | null>
  /** Mail the finished invoice to the organizer. */
  sendInvoice?: (invoiceId: string, recipientEmail: string) => Promise<void>
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

/** Date-only string (YYYY-MM-DD) for `d`, read in Bratislava. */
function localDate(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Bratislava',
  }).format(d)
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Cents to the euro amount Faktero expects, without float drift. */
function euros(cents: number): number {
  return Number((cents / 100).toFixed(2))
}

export class FakteroClient implements InvoiceProvider {
  constructor(
    private apiKey: string,
    private apiUrl: string,
    private now: () => Date = () => new Date(),
  ) {}

  private async get(path: string): Promise<any> {
    const res = await fetch(`${this.apiUrl.replace(/\/$/, '')}${path}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`Faktero GET ${path} failed: ${res.status} ${text}`)
    }
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`Faktero GET ${path}: odpoveď nie je JSON: ${text}`)
    }
  }

  private async post(path: string, body: unknown): Promise<any> {
    const res = await fetch(`${this.apiUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`Faktero POST ${path} failed: ${res.status} ${text}`)
    }
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`Faktero POST ${path}: odpoveď nie je JSON: ${text}`)
    }
  }

  /** Create the Faktero customer for an organizer and return its id. */
  private async createCustomer(c: InvoiceCustomer): Promise<string> {
    const json = await this.post('/customers', {
      name: c.name,
      ico: c.ico,
      dic: c.dic,
      ic_dph: c.icDph,
      email: c.email,
      // organizers.address is one free-text field; Faktero splits street/city/
      // zip and accepts them individually, so the whole thing goes to street
      // rather than being guessed apart.
      street: c.address,
      country: 'SK',
      external_id: c.externalId,
    })
    const id = json?.data?.id ?? json?.id
    if (!id) {
      throw new Error(
        `Faktero POST /customers: v odpovedi chýba id: ${JSON.stringify(json).slice(0, 200)}`,
      )
    }
    return String(id)
  }

  /**
   * Scan the invoice list for one carrying `externalId`.
   *
   * The filter has to be done here: GET /invoices accepts external_id, limit,
   * page and per_page and ignores all of them, answering with a bare
   * `{ data: [...] }` and no pagination metadata. Whether that list is capped
   * server-side cannot be told from one invoice, so treat a miss as "probably
   * not there" rather than proof — the caller only uses this to avoid a second
   * invoice, never to conclude that money was billed.
   */
  async findByExternalId(externalId: string): Promise<InvoiceResult | null> {
    const json = await this.get('/invoices')
    const rows: any[] = Array.isArray(json?.data) ? json.data : []
    const hit = rows.find(
      (r) =>
        r?.external_id === externalId || r?.original_external_id === externalId,
    )
    if (!hit) return null
    return {
      id: String(hit.id),
      number: hit.invoice_number ? String(hit.invoice_number) : undefined,
      customerId: hit.customer_id ? String(hit.customer_id) : undefined,
      sentAt: hit.sent_at ? String(hit.sent_at) : null,
    }
  }

  async sendInvoice(invoiceId: string, recipientEmail: string): Promise<void> {
    await this.post(`/invoices/${invoiceId}/send`, {
      recipient_email: recipientEmail,
    })
  }

  async createInvoice(req: InvoiceRequest): Promise<InvoiceResult> {
    const customerId =
      req.customer.providerId ?? (await this.createCustomer(req.customer))

    const issueDate = localDate(this.now())
    const json = await this.post('/invoices', {
      customer_id: customerId,
      issue_date: issueDate,
      due_date: addDays(issueDate, DUE_DAYS),
      currency: 'EUR',
      items: [
        {
          name: req.description,
          quantity: 1,
          unit: UNIT,
          unit_price: euros(req.amountCents),
          vat_rate: VAT_RATE,
        },
      ],
      notes: `Provízia platformy Ticketio — ${req.periodLabel}`,
      external_id: req.externalId,
    })
    const d = json?.data ?? json
    if (!d?.id) {
      throw new Error(
        `Faktero POST /invoices: v odpovedi chýba id: ${JSON.stringify(json).slice(0, 200)}`,
      )
    }
    return {
      id: String(d.id),
      number: d.invoice_number ? String(d.invoice_number) : undefined,
      customerId,
    }
  }
}

/** Whether both Faktero env vars are set, i.e. invoicing can really run. */
export function isInvoicingConfigured(): boolean {
  const env = getEnv()
  return Boolean(env.FAKTERO_API_KEY && env.FAKTERO_API_URL)
}

let provider: InvoiceProvider | null = null

export function getInvoiceProvider(): InvoiceProvider {
  if (!provider) {
    const env = getEnv()
    provider = isInvoicingConfigured()
      ? new FakteroClient(env.FAKTERO_API_KEY, env.FAKTERO_API_URL)
      : new LogInvoiceProvider()
  }
  return provider
}
