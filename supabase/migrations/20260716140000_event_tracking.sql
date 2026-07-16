-- Phase 9 block 3 — per-event analytics (GA4 + Meta Pixel).
--
-- Optional tracking IDs configured per event; injected only on that event's public
-- pages, and only after cookie consent.
alter table events
  add column ga4_measurement_id text,
  add column meta_pixel_id text;

comment on column events.ga4_measurement_id is
  'Google Analytics 4 measurement ID (G-XXXXXXX). Injected on this event''s public pages after consent.';
comment on column events.meta_pixel_id is
  'Meta (Facebook) Pixel ID. Injected on this event''s public pages after consent.';
