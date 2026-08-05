import { createFileRoute } from '@tanstack/react-router'
import {
  getUserIdFromRequest,
  organizerIdForUser,
} from '../lib/supabase/auth-request'
import { serviceClient } from '../lib/supabase/server'
import { readAllRows, readAllByKeys } from '../server/db-paging'
import { buildAttendeesCsv } from '../lib/attendees-csv'
import type { AttendeeRow } from '../lib/attendees-csv'

/**
 * Attendees CSV: one row per (non-cancelled) ticket with its custom-field answers
 * as columns. Authorized by session cookie to the event's organizer.
 */
export const Route = createFileRoute('/api/events/$eventId/attendees-csv')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const userId = await getUserIdFromRequest(request)
        if (!userId) return new Response('Neprihlásený.', { status: 401 })
        const organizerId = await organizerIdForUser(userId)
        if (!organizerId)
          return new Response('Bez organizátora.', { status: 403 })

        const db = serviceClient()
        const { data: event } = await db
          .from('events')
          .select('slug')
          .eq('id', params.eventId)
          .eq('organizer_id', organizerId)
          .maybeSingle<{ slug: string }>()
        if (!event) return new Response('Bez oprávnenia.', { status: 403 })

        // Paged: an attendee list for a sold-out hall runs well past the 1000-row
        // response cap, and the door staff would have got a file that stops
        // mid-alphabet without saying so. Ordered by id — paging needs a unique
        // key — and put back into arrival order afterwards.
        const rows = await readAllRows<{
          id: string
          created_at: string
          holder_name: string | null
          holder_email: string | null
          ticket_types: { name: string } | null
          orders: { buyer_email: string } | null
          seats: {
            sector: string
            row_label: string
            seat_number: string
          } | null
        }>(
          () =>
            db
              .from('tickets')
              .select(
                'id, created_at, holder_name, holder_email, ticket_types(name), orders(buyer_email), seats(sector, row_label, seat_number)',
              )
              .eq('event_id', params.eventId)
              .neq('status', 'cancelled')
              .order('id', { ascending: true })
              .returns<
                {
                  id: string
                  created_at: string
                  holder_name: string | null
                  holder_email: string | null
                  ticket_types: { name: string } | null
                  orders: { buyer_email: string } | null
                  seats: {
                    sector: string
                    row_label: string
                    seat_number: string
                  } | null
                }[]
              >(),
          'účastníci podujatia',
        )
        rows.sort((a, b) => a.created_at.localeCompare(b.created_at))

        // Answers (tolerant if the table doesn't exist yet). Chunked because the
        // ticket list is no longer capped at 1000 ids.
        const byTicket = new Map<string, Record<string, string>>()
        const answers = await readAllByKeys<{
          ticket_id: string
          field_label: string
          value: string | null
        }>(
          rows.map((t) => t.id),
          (chunk) =>
            db
              .from('ticket_answers')
              .select('ticket_id, field_label, value')
              .in('ticket_id', chunk)
              .order('id', { ascending: true })
              .returns<
                {
                  ticket_id: string
                  field_label: string
                  value: string | null
                }[]
              >(),
          'odpovede účastníkov',
        )
        for (const a of answers) {
          const m = byTicket.get(a.ticket_id) ?? {}
          m[a.field_label] = a.value ?? ''
          byTicket.set(a.ticket_id, m)
        }

        const attendees: AttendeeRow[] = rows.map((t) => ({
          ref: t.id.slice(0, 8).toUpperCase(),
          typeName: t.ticket_types?.name ?? '—',
          seat: t.seats
            ? `${t.seats.sector} · rad ${t.seats.row_label} · miesto ${t.seats.seat_number}`
            : null,
          holderName: t.holder_name,
          holderEmail: t.holder_email ?? t.orders?.buyer_email ?? null,
          answers: byTicket.get(t.id) ?? {},
        }))

        return new Response(buildAttendeesCsv(attendees), {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="ucastnici-${event.slug}.csv"`,
            'Cache-Control': 'no-store',
          },
        })
      },
    },
  },
})
