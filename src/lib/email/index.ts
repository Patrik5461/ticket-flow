import { ConsoleEmailProvider } from './console'
import type { EmailProvider } from './provider'

export type { EmailProvider, EmailMessage, EmailAttachment } from './provider'

let provider: EmailProvider | null = null

/**
 * Resolve the active email provider. Currently always the dev console provider;
 * swap the construction here when a real vendor is wired up.
 */
export function getEmailProvider(): EmailProvider {
  if (!provider) {
    provider = new ConsoleEmailProvider()
  }
  return provider
}
