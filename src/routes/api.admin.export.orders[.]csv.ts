import { createFileRoute } from '@tanstack/react-router'
import {
  getUserIdFromRequest,
  isPlatformAdminUser,
} from '../lib/supabase/auth-request'
import { buildOrdersCsv, auditExport } from '../server/admin-export'

/** GET /api/admin/export/orders.csv?from=YYYY-MM-DD&to=YYYY-MM-DD — platform admin. */
export const Route = createFileRoute('/api/admin/export/orders.csv')({
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
        const { csv, count } = await buildOrdersCsv({ from, to })
        await auditExport(userId, 'orders', { from, to, count })
        return new Response(csv, {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="objednavky-${from ?? 'vsetky'}-${to ?? ''}.csv"`,
            'Cache-Control': 'no-store',
          },
        })
      },
    },
  },
})
