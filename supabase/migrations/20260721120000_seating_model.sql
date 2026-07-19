-- Phase 21 Block 1 — seating maps (numbered seats) data model.
--
-- Builds on the existing capacity model (ticket_types.capacity/sold_count +
-- reserve_ticket_capacity + release_expired_orders). An event is "seated" for a
-- given ticket type when that type has ticket_types.seated = true and its
-- sectors are mapped to seats; unseated types keep the current quantity-based
-- capacity logic. An event may mix both (e.g. standing parter + numbered
-- balcony). The per-seat concurrency guard lands in Block 2.
--
-- RLS: enabled with NO policies on every table here — server-only via the
-- service role. The dashboard editor and the buyer-facing seat map both go
-- through server functions (serviceClient), exactly like waitlist_entries /
-- support_* . This deliberately avoids anon RLS policies (and the cross-table
-- subquery pitfall): there is no public read path to hide.
--
-- Import: venues / seat_maps / seats carry a nullable external_ref so a repeated
-- import from another system (Maxiticket) upserts instead of duplicating.
-- Imported maps populate the SAME structure and are fully editable — no
-- read-only "imported" mode.

-- ---------------------------------------------------------------------------
-- venues — a physical place, reusable across events, per organizer
-- ---------------------------------------------------------------------------
create table venues (
  id            uuid primary key default gen_random_uuid(),
  organizer_id  uuid not null references organizers (id) on delete cascade,
  name          text not null,
  address       text,
  external_ref  text,                       -- source-system id (idempotent import)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index venues_organizer on venues (organizer_id);
create unique index venues_external_ref
  on venues (organizer_id, external_ref) where external_ref is not null;

-- ---------------------------------------------------------------------------
-- seat_maps — a layout of a venue, reusable across events
-- ---------------------------------------------------------------------------
-- layout jsonb shape (rendered by editor + buyer):
--   {
--     "levels": [
--       { "key":"parter", "name":"Parter", "order":0,
--         "canvas": {"width":1200,"height":800},   -- own canvas per level
--         "shapes": [ ... sector rectangles/arcs, labels ... ] },
--       { "key":"balkon", "name":"Balkón", "order":1, "canvas":{...}, "shapes":[...] }
--     ]
--   }
-- Levels (parter / balkón / galéria) live WITHIN one map, shown separately —
-- not overlaid on a single canvas.
create table seat_maps (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references venues (id) on delete cascade,
  name          text not null,
  layout        jsonb not null default '{}'::jsonb,
  external_ref  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index seat_maps_venue on seat_maps (venue_id);
create unique index seat_maps_external_ref
  on seat_maps (venue_id, external_ref) where external_ref is not null;

-- ---------------------------------------------------------------------------
-- seats — normalized seats of a map (the reusable template, not event-specific)
-- ---------------------------------------------------------------------------
create table seats (
  id            uuid primary key default gen_random_uuid(),
  seat_map_id   uuid not null references seat_maps (id) on delete cascade,
  level         text not null default 'main',   -- floor/level key: parter/balkon/galeria
  level_order   integer not null default 0,      -- level sort order
  sector        text not null,                   -- sector key; maps to a price category per event
  row_label     text not null,
  seat_number   text not null,                   -- text: '1', 'A1', '12a'
  x             double precision not null default 0,   -- canvas coords (within the level)
  y             double precision not null default 0,
  seat_type     text not null default 'standard'
                  check (seat_type in ('standard', 'wheelchair', 'blocked')),
  external_ref  text,
  created_at    timestamptz not null default now(),
  unique (seat_map_id, level, sector, row_label, seat_number)
);
create index seats_map on seats (seat_map_id);
create index seats_map_sector on seats (seat_map_id, sector);
create unique index seats_external_ref
  on seats (seat_map_id, external_ref) where external_ref is not null;

-- ---------------------------------------------------------------------------
-- ticket_types.seated — mixed-mode flag. Seated types bind to sectors/seats;
-- unseated types keep the current quantity-based capacity logic.
-- ---------------------------------------------------------------------------
alter table ticket_types add column seated boolean not null default false;

-- ---------------------------------------------------------------------------
-- event_seat_maps — which map an event uses (one map per event in v1)
-- ---------------------------------------------------------------------------
create table event_seat_maps (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events (id) on delete cascade,
  seat_map_id   uuid not null references seat_maps (id) on delete restrict,
  created_at    timestamptz not null default now(),
  unique (event_id)
);
create index event_seat_maps_map on event_seat_maps (seat_map_id);

-- ---------------------------------------------------------------------------
-- event_sector_pricing — sector -> price category (ticket_type) for an event
-- ---------------------------------------------------------------------------
create table event_sector_pricing (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events (id) on delete cascade,
  sector          text not null,
  ticket_type_id  uuid not null references ticket_types (id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (event_id, sector)
);
create index event_sector_pricing_event on event_sector_pricing (event_id);

-- ---------------------------------------------------------------------------
-- event_seats — per-event, per-seat state (the heart of reservation, Block 2)
-- ---------------------------------------------------------------------------
create table event_seats (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events (id) on delete cascade,
  seat_id         uuid not null references seats (id) on delete cascade,
  ticket_type_id  uuid not null references ticket_types (id) on delete restrict,
  status          text not null default 'available'
                    check (status in ('available', 'held', 'sold', 'blocked')),
  held_until      timestamptz,                  -- held reservation TTL (mirrors orders.expires_at)
  order_id        uuid references orders (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (event_id, seat_id)
);
create index event_seats_event_status on event_seats (event_id, status);
create index event_seats_order on event_seats (order_id) where order_id is not null;
create index event_seats_held on event_seats (held_until) where status = 'held';

-- ---------------------------------------------------------------------------
-- tickets.seat_id — nullable, so non-seated events are unchanged
-- ---------------------------------------------------------------------------
alter table tickets add column seat_id uuid references seats (id) on delete set null;
create index tickets_seat on tickets (seat_id) where seat_id is not null;

-- ---------------------------------------------------------------------------
-- RLS: on, no policies (server-only via service role).
-- ---------------------------------------------------------------------------
alter table venues                enable row level security;
alter table seat_maps             enable row level security;
alter table seats                 enable row level security;
alter table event_seat_maps       enable row level security;
alter table event_sector_pricing  enable row level security;
alter table event_seats           enable row level security;
