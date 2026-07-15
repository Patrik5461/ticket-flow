-- Secondary indexes for foreign keys and hot lookup paths.

create index organizer_members_user_id_idx on organizer_members (user_id);

create index events_organizer_id_idx on events (organizer_id);
create index events_status_idx        on events (status);

create index ticket_types_event_id_idx on ticket_types (event_id);

create index coupons_event_id_idx on coupons (event_id);

create index orders_event_id_idx         on orders (event_id);
create index orders_status_idx           on orders (status);
create index orders_gopay_payment_id_idx on orders (gopay_payment_id);
-- Partial index driving the expiry cron: only pending orders carry a live reservation.
create index orders_pending_expires_idx  on orders (expires_at) where status = 'pending';

create index order_items_order_id_idx       on order_items (order_id);
create index order_items_ticket_type_id_idx on order_items (ticket_type_id);

create index tickets_order_id_idx       on tickets (order_id);
create index tickets_event_id_idx       on tickets (event_id);
create index tickets_ticket_type_id_idx on tickets (ticket_type_id);

create index payment_events_order_id_idx on payment_events (order_id);

create index checkin_log_event_id_idx  on checkin_log (event_id);
create index checkin_log_ticket_id_idx on checkin_log (ticket_id);
