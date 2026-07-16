/**
 * Email provider abstraction. The concrete provider (SMTP, Resend, Postmark, …)
 * is swapped later; the app only depends on this interface.
 */

export interface EmailAttachment {
  filename: string
  content: Uint8Array
  contentType: string
}

export interface EmailMessage {
  to: string
  subject: string
  html: string
  attachments?: EmailAttachment[]
}

export interface EmailProvider {
  send: (message: EmailMessage) => Promise<void>
}
