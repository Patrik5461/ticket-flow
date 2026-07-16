/**
 * Real dependencies for the waitlist worker. Free of admin.ts / getCurrentUser
 * so the /api/cron/process-waitlist route can import it.
 *
 * Server-only.
 */

import { serviceClient } from '../lib/supabase/server'
import { getEmailProvider } from '../lib/email'
import { getEnv } from '../lib/env'
import type { WaitlistDeps } from './waitlist'

export function realWaitlistDeps(): WaitlistDeps {
  const appUrl = getEnv().APP_URL
  return {
    db: serviceClient(),
    sendEmail: async (to, subject, html) => {
      await getEmailProvider().send({ to, subject, html })
    },
    buildLink: (slug, ticketTypeId) =>
      `${appUrl}/e/${slug}/checkout?items=${ticketTypeId}:1`,
    now: () => new Date().toISOString(),
    nowMs: () => Date.now(),
  }
}
