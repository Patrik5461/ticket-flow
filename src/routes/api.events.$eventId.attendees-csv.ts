import { createFileRoute } from '@tanstack/react-router'
import {
  getUserIdFromRequest,
  organizerIdForUser,
} from '../lib/supabase/auth-request'
import { serviceClient } from '../lib/supabase/server'
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

        const { data: tickets } = await db
          .from('tickets')
          .select(
            'id, holder_name, holder_email, ticket_types(name), orders(buyer_email), seats(sector, row_label, seat_number)',
          )
          .eq('event_id', params.eventId)
          .neq('status', 'cancelled')
          .order('created_at', { ascending: true })
          .returns<
            {
              id: string
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
          >()
        const rows = tickets ?? []

        // Answers (tolerant if the table doesn't exist yet).
        const byTicket = new Map<string, Record<string, string>>()
        if (rows.length > 0) {
          const { data: answers } = await db
            .from('ticket_answers')
            .select('ticket_id, field_label, value')
            .in(
              'ticket_id',
              rows.map((t) => t.id),
            )
            .returns<
              { ticket_id: string; field_label: string; value: string | null }[]
            >()
          for (const a of answers ?? []) {
            const m = byTicket.get(a.ticket_id) ?? {}
            m[a.field_label] = a.value ?? ''
            byTicket.set(a.ticket_id, m)
          }
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
