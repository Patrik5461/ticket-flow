import type { EmailMessage, EmailProvider } from './provider'

/**
 * Dev provider: logs the message instead of sending. Lets the full order flow run
 * end-to-end without an email vendor configured.
 */
export class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[email] would send', {
      to: message.to,
      subject: message.subject,
      attachments: message.attachments?.map((a) => `${a.filename} (${a.content.length}B)`),
    })
  }
}
