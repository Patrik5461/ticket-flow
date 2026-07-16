import { ConsoleEmailProvider } from './console'
import { ResendEmailProvider } from './resend'
import { getEnv } from '../env'
import type { EmailProvider } from './provider'

export type { EmailProvider, EmailMessage, EmailAttachment } from './provider'

let provider: EmailProvider | null = null

/**
 * Resolve the active email provider: Resend when RESEND_API_KEY is set, otherwise
 * the dev console provider (so the full flow runs without an email vendor).
 */
export function getEmailProvider(): EmailProvider {
  if (!provider) {
    const env = getEnv()
    provider = env.RESEND_API_KEY
      ? new ResendEmailProvider(env.RESEND_API_KEY, env.EMAIL_FROM)
      : new ConsoleEmailProvider()
  }
  return provider
}
