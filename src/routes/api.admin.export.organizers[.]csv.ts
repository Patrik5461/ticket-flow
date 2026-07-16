import { createFileRoute } from '@tanstack/react-router'
import {
  getUserIdFromRequest,
  isPlatformAdminUser,
} from '../lib/supabase/auth-request'
import { buildOrganizersCsv, auditExport } from '../server/admin-export'

/** GET /api/admin/export/organizers.csv?from=&to= — platform admin. */
export const Route = createFileRoute('/api/admin/export/organizers.csv')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await getUserIdFromRequest(request)
        if (!userId || !(await isPlatformAdminUser(userId))) {
          return new Response('Nenájdené.', { status: 404 })
        }
        const sp = new URL(request.url).searchParams
        const from = sp.get('from')
        const to = sp.get('to')
        const { csv, count } = await buildOrganizersCsv({ from, to })
        await auditExport(userId, 'organizers', { from, to, count })
        return new Response(csv, {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="organizatori-${from ?? 'vsetci'}-${to ?? ''}.csv"`,
            'Cache-Control': 'no-store',
          },
        })
      },
    },
  },
})
