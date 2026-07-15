-- Core Ticketio schema. All money is stored as integer cents (EUR). All timestamps
-- are timestamptz in UTC; presentation converts to Europe/Bratislava.

-- ---------------------------------------------------------------------------
-- Organizers
-- ---------------------------------------------------------------------------
create table organizers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  slug           text not null unique,
  ico            text,
  dic            text,
  ic_dph         text,
  iban           text,
  email          text,
  phone          text,
  fee_percent    numeric(5, 2) not null default 4.0 check (fee_percent >= 0 and fee_percent <= 100),
  fee_min_cents  integer not null default 40 check (fee_min_cents >= 0),
  gopay_goid     text,                       -- nullable: for payment split later
  created_at     timestamptz not null default now()
);

comment on column organizers.fee_percent   is 'Platform commission percent, per organizer. Default 4.0.';
comment on column organizers.fee_min_cents  is 'Minimum platform commission in cents. Default 40 (0,40 EUR).';

-- Members of an organizer team (maps to auth.users).
create table organizer_members (
  id            uuid primary key default gen_random_uuid(),
  organizer_id  uuid not null references organizers (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          text not null check (role in ('owner', 'admin', 'checkin')),
  created_at    timestamptz not null default now(),
  unique (organizer_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------
create table events (
  id             uuid primary key default gen_random_uuid(),
  organizer_id   uuid not null references organizers (id) on delete cascade,
  title          text not null,
  slug           text not null unique,
  description    text,
  venue_name     text,
  venue_address  text,
  starts_at      timestamptz not null,
  ends_at        timestamptz,
  timezone       text not null default 'Europe/Bratislava',
  cover_url      text,
  status         text not null default 'draft'
                   check (status in ('draft', 'published', 'ended', 'cancelled')),
  qr_secret      uuid not null default gen_random_uuid(),  -- per-event HMAC secret for QR signing
  created_at     timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);

comment on column events.qr_secret is 'Per-event secret used to HMAC-sign ticket QR codes: TIK.{ticket_id}.{hmac16}.';

-- ---------------------------------------------------------------------------
-- Ticket types (price tiers within an event)
-- ---------------------------------------------------------------------------
create table ticket_types (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events (id) on delete cascade,
  name            text not null,
  description     text,
  price_cents     integer not null check (price_cents >= 0),
  currency        text not null default 'EUR',
  capacity        integer not null check (capacity >= 0),
  sold_count      integer not null default 0 check (sold_count >= 0),
  sale_starts_at  timestamptz,
  sale_ends_at    timestamptz,
  max_per_order   integer not null default 10 check (max_per_order > 0),
  sort_order      integer not null default 0,
  hidden          boolean not null default false,
  created_at      timestamptz not null default now(),
  -- Capacity invariant: reservations may never oversell.
  constraint ticket_types_sold_within_capacity check (sold_count <= capacity)
);

-- ---------------------------------------------------------------------------
-- Coupons
-- ---------------------------------------------------------------------------
create table coupons (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events (id) on delete cascade,
  code         text not null,
  type         text not null check (type in ('percent', 'fixed')),
  value        integer not null check (value >= 0),  -- percent: 0-100; fixed: amount in cents
  max_uses     integer check (max_uses is null or max_uses >= 0),  -- null = unlimited
  used_count   integer not null default 0 check (used_count >= 0),
  valid_from   timestamptz,
  valid_until  timestamptz,
  created_at   timestamptz not null default now(),
  unique (event_id, code),
  check (type <> 'percent' or value <= 100)
);

comment on column coupons.value is 'percent type: whole-percent points (0-100). fixed type: discount in cents.';

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create table orders (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references events (id) on delete restrict,
  buyer_email       text not null,
  buyer_name        text,
  buyer_phone       text,
  status            text not null default 'pending'
                      check (status in ('pending', 'paid', 'expired', 'cancelled', 'refunded')),
  subtotal_cents    integer not null default 0 check (subtotal_cents >= 0),
  discount_cents    integer not null default 0 check (discount_cents >= 0),
  total_cents       integer not null default 0 check (total_cents >= 0),
  fee_cents         integer not null default 0 check (fee_cents >= 0),
  coupon_id         uuid references coupons (id) on delete set null,
  gopay_payment_id  text,
  expires_at        timestamptz,   -- pending reservation TTL (15 min); freed by cron when passed
  created_at        timestamptz not null default now(),
  paid_at           timestamptz
);

create table order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders (id) on delete cascade,
  ticket_type_id    uuid not null references ticket_types (id) on delete restrict,
  quantity          integer not null check (quantity > 0),
  unit_price_cents  integer not null check (unit_price_cents >= 0)  -- price snapshot at order time
);

-- ---------------------------------------------------------------------------
-- Tickets (one row per admission, carries the signed QR identity)
-- ---------------------------------------------------------------------------
create table tickets (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders (id) on delete cascade,
  ticket_type_id  uuid not null references ticket_types (id) on delete restrict,
  event_id        uuid not null references events (id) on delete cascade,
  holder_name     text,
  status          text not null default 'valid' check (status in ('valid', 'used', 'cancelled')),
  used_at         timestamptz,
  checked_in_by   uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Payment events (GoPay webhook idempotency ledger)
-- ---------------------------------------------------------------------------
create table payment_events (
  id                uuid primary key default gen_random_uuid(),
  gopay_payment_id  text not null,
  order_id          uuid references orders (id) on delete cascade,
  state             text not null,
  raw               jsonb,
  created_at        timestamptz not null default now(),
  -- A given (payment, state) pair is processed at most once.
  unique (gopay_payment_id, state)
);

-- ---------------------------------------------------------------------------
-- Check-in log (audit trail of every scan attempt)
-- ---------------------------------------------------------------------------
create table checkin_log (
  id            uuid primary key default gen_random_uuid(),
  ticket_id     uuid references tickets (id) on delete set null,  -- null for unrecognized scans
  event_id      uuid references events (id) on delete cascade,
  result        text not null check (result in ('ok', 'already_used', 'invalid', 'cancelled')),
  device_label  text,
  created_at    timestamptz not null default now()
);
