import { createFileRoute, Outlet } from '@tanstack/react-router'

/**
 * Layout route for a single event. It only renders the matched child route
 * (the event detail lives in app.events.$eventId.index.tsx; sales, check-in,
 * guestlist, manual-order, pos and pos-summary are its siblings). Without this
 * Outlet the parent's own component would render for every child URL, which is
 * why /pos, /sales, … previously showed the event detail instead of their page.
 * Each child route loads its own data, so the layout needs no loader.
 */
export const Route = createFileRoute('/app/events/$eventId')({
  component: EventLayout,
})

function EventLayout() {
  return <Outlet />
}
