-- Take the SECURITY DEFINER functions off the public REST surface.
--
-- Postgres grants EXECUTE to PUBLIC on every new function, so a migration that
-- does not revoke it publishes the function: PostgREST exposes it at
-- /rest/v1/rpc/<name> and the anon key that ships in the browser bundle is
-- enough to call it. Twenty of ours were reachable that way, and being
-- SECURITY DEFINER they ran with the owner's rights — RLS and column grants do
-- not apply to what happens inside them, and none of them checks the caller.
--
-- What that allowed, concretely: admin_search_orders returned buyer e-mails and
-- names across every organizer; reserve_ticket_capacity moved sold_count on any
-- ticket type, so an event could be sold out without a single sale; the
-- settlement writers rewrote payout figures.
--
-- Authorization for these lives one layer up, in src/server/*, which talks to
-- the database with the service_role key. service_role bypasses this grant
-- entirely, so revoking here changes nothing for the app. The pg_cron bridges
-- (jobs 1-8) run as `postgres`, the owner, and are likewise unaffected.
--
-- Left callable on purpose:
--   is_org_member, organizer_is_active — evaluated inside RLS policies as the
--     querying role. Revoking these would make the policies fail and hide
--     public event data (the cross-table RLS trap in CLAUDE.md).
--   is_platform_admin — returns a boolean about the caller only.
--   organizer_inherit_fee — trigger function; not callable over REST.
--   public_event_cities — SECURITY INVOKER, called with the anon client.

revoke execute on function public.admin_search_orders(text)
  from public, anon, authenticated;

revoke execute on function public.bump_support_usage(integer, integer, integer)
  from public, anon, authenticated;

revoke execute on function public.claim_seats(uuid, uuid[], uuid, integer)
  from public, anon, authenticated;

revoke execute on function public.generate_previous_month_settlements()
  from public, anon, authenticated;

revoke execute on function public.generate_settlement_range(
  uuid, timestamptz, timestamptz, text, uuid, uuid)
  from public, anon, authenticated;

revoke execute on function public.generate_settlements(date)
  from public, anon, authenticated;

revoke execute on function public.increment_coupon_use(uuid)
  from public, anon, authenticated;

revoke execute on function public.mark_seats_sold(uuid)
  from public, anon, authenticated;

revoke execute on function public.recompute_settlement(uuid)
  from public, anon, authenticated;

revoke execute on function public.release_expired_orders()
  from public, anon, authenticated;

revoke execute on function public.release_pending_order(uuid)
  from public, anon, authenticated;

revoke execute on function public.release_seats_for_order(uuid)
  from public, anon, authenticated;

revoke execute on function public.release_ticket_capacity(uuid, integer)
  from public, anon, authenticated;

revoke execute on function public.reserve_ticket_capacity(uuid, integer)
  from public, anon, authenticated;

revoke execute on function public.schedule_reminder_jobs()
  from public, anon, authenticated;

revoke execute on function public.trigger_email_processing()
  from public, anon, authenticated;

revoke execute on function public.trigger_invoice_issuing()
  from public, anon, authenticated;

revoke execute on function public.trigger_refund_processing()
  from public, anon, authenticated;

revoke execute on function public.trigger_waitlist_processing()
  from public, anon, authenticated;

revoke execute on function public.trigger_webhook_processing()
  from public, anon, authenticated;

-- Spell out the grant the app actually relies on. It is already there; stating
-- it keeps a later `revoke ... from public` (which does not touch role grants)
-- from being read as having removed it.
grant execute on function public.admin_search_orders(text)                     to service_role;
grant execute on function public.bump_support_usage(integer, integer, integer) to service_role;
grant execute on function public.claim_seats(uuid, uuid[], uuid, integer)      to service_role;
grant execute on function public.generate_previous_month_settlements()         to service_role;
grant execute on function public.generate_settlement_range(
  uuid, timestamptz, timestamptz, text, uuid, uuid)                            to service_role;
grant execute on function public.generate_settlements(date)                    to service_role;
grant execute on function public.increment_coupon_use(uuid)                    to service_role;
grant execute on function public.mark_seats_sold(uuid)                         to service_role;
grant execute on function public.recompute_settlement(uuid)                    to service_role;
grant execute on function public.release_expired_orders()                      to service_role;
grant execute on function public.release_pending_order(uuid)                   to service_role;
grant execute on function public.release_seats_for_order(uuid)                 to service_role;
grant execute on function public.release_ticket_capacity(uuid, integer)        to service_role;
grant execute on function public.reserve_ticket_capacity(uuid, integer)        to service_role;
grant execute on function public.schedule_reminder_jobs()                      to service_role;
grant execute on function public.trigger_email_processing()                    to service_role;
grant execute on function public.trigger_invoice_issuing()                     to service_role;
grant execute on function public.trigger_refund_processing()                   to service_role;
grant execute on function public.trigger_waitlist_processing()                 to service_role;
grant execute on function public.trigger_webhook_processing()                  to service_role;
