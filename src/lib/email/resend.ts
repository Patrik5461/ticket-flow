/**
 * Resend transactional email provider. Server-only.
 *
 * API: POST https://api.resend.com/emails (Bearer RESEND_API_KEY), JSON body with
 * base64-encoded attachments. `from` must be an address on a Resend-verified
 * domain (see README for SPF/DKIM).
 */

import type { EmailMessage, EmailProvider } from './provider'

const RESEND_URL = 'https://api.resend.com/emails'

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

export class ResendEmailProvider implements EmailProvider {
  constructor(
    private apiKey: string,
    private from: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const body = {
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      ...(message.attachments && message.attachments.length > 0
        ? {
            attachments: message.attachments.map((a) => ({
              filename: a.filename,
              content: toBase64(a.content),
            })),
          }
        : {}),
    }

    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      throw new Error(`Resend send failed: ${res.status} ${await res.text()}`)
    }
  }
}
