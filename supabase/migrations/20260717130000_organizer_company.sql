-- Phase 13 block 2 — organizer company/billing details, editable in settings.
-- All nullable (organizers created via onboarding without them).

alter table organizers
  add column if not exists ico text,
  add column if not exists dic text,
  add column if not exists ic_dph text,
  add column if not exists iban text,
  add column if not exists contact_email text,
  add column if not exists phone text,
  add column if not exists address text;
