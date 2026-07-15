import { createFileRoute } from '@tanstack/react-router'
import { buildSalesData } from '../server/sales-data'
import {
  getUserIdFromRequest,
  organizerIdForUser,
} from '../lib/supabase/auth-request'
import type { OrderStatus } from '../lib/db-types'

const STATUS_SK: Record<OrderStatus, string> = {
  pending: 'Čaká na platbu',
  paid: 'Zaplatené',
  expired: 'Expirované',
  cancelled: 'Zrušené',
  refunded: 'Vrátené',
}

// Excel-friendly CSV: UTF-8 BOM (diacritics) + ';' delimiter (SK/EU list separator)
// + comma decimals. Fields with ; " or newline are quoted.
function cell(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export const Route = createFileRoute('/api/events/$eventId/sales-csv')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const userId = await getUserIdFromRequest(request)
        if (!userId) {
          return new Response('Neprihlásený.', { status: 401 })
        }
        const organizerId = await organizerIdForUser(userId)
        if (!organizerId) {
          return new Response('Bez organizátora.', { status: 403 })
        }

        const data = await buildSalesData(params.eventId, organizerId)
        if (!data) {
          return new Response('Bez oprávnenia.', { status: 403 })
        }

        const status = new URL(request.url).searchParams.get('status')
        const orders =
          status && status !== 'all'
            ? data.orders.filter((o) => o.status === status)
            : data.orders

        const fmtDate = (iso: string) =>
          new Intl.DateTimeFormat('sk-SK', {
            dateStyle: 'short',
            timeStyle: 'short',
            timeZone: data.event.timezone,
          }).format(new Date(iso))

        const header = [
          'Číslo objednávky',
          'Dátum',
          'E-mail',
          'Meno',
          'Typy vstupeniek',
          'Suma (EUR)',
          'Stav',
        ]
        const rows = orders.map((o) =>
          [
            o.ref,
            fmtDate(o.created_at),
            o.buyer_email,
            o.buyer_name ?? '',
            o.itemsLabel,
            (o.total_cents / 100).toFixed(2).replace('.', ','),
            STATUS_SK[o.status],
          ]
            .map(cell)
            .join(';'),
        )
        const csv = '﻿' + [header.map(cell).join(';'), ...rows].join('\r\n')

        return new Response(csv, {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="predaj-${data.event.slug}.csv"`,
            'Cache-Control': 'no-store',
          },
        })
      },
    },
  },
})
