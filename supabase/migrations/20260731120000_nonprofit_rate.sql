-- Reduced commission for the non-profit sector (občianske združenie, nadácia,
-- n. o., neinvestičný fond, účelové zariadenie cirkvi).
--
-- The rate itself needs no new machinery: orders already price from
-- organizers.fee_percent / fee_min_cents (src/server/order-service.ts). What is
-- new is HOW an organizer legitimately gets the lower numbers — a claim that a
-- platform admin approves, never a self-service discount. Until approval the
-- organizer sells at the standard rate.
--
-- Approval copies the current platform non-profit rate onto the organizer row,
-- the same columns the manual admin fee edit writes. Consequences, deliberate:
--   - the fee is snapshotted per order, so approval applies to FUTURE orders
--     only and never rewrites past settlements,
--   - later changing the platform non-profit rate does not silently re-rate
--     already-approved organizers.
--
-- organizers has RLS with no anon policy (organizers_member_read), so these
-- columns are visible only to the organizer's own members and service_role.

alter table public.organizers
  add column if not exists legal_form text
    check (
      legal_form is null
      or legal_form in (
        'civic_association',    -- občianske združenie
        'foundation',           -- nadácia
        'npo',                  -- nezisková organizácia (n. o.)
        'non_investment_fund',  -- neinvestičný fond
        'church',               -- účelové zariadenie cirkvi
        'other_nonprofit'       -- iná nezisková právna forma
      )
    ),
  add column if not exists nonprofit_status text not null default 'none'
    check (nonprofit_status in ('none', 'pending', 'approved', 'rejected')),
  add column if not exists nonprofit_requested_at timestamptz,
  add column if not exists nonprofit_decided_at timestamptz,
  add column if not exists nonprofit_decided_by uuid,
  add column if not exists nonprofit_note text;

comment on column public.organizers.legal_form is
  'Declared legal form; set only when the organizer claims non-profit status.';
comment on column public.organizers.nonprofit_status is
  'none | pending (awaiting admin review) | approved (fee lowered) | rejected.';
comment on column public.organizers.nonprofit_note is
  'Applicant''s supporting note, then overwritten with the admin reason on reject.';

-- The admin review queue reads exactly this slice; keep it cheap as the table grows.
create index if not exists organizers_nonprofit_pending_idx
  on public.organizers (nonprofit_requested_at)
  where nonprofit_status = 'pending';

-- The non-profit rate is platform-wide and tunable, like the standard default.
-- 2.0 % / 0,20 EUR: at 2 % the standard 0,40 EUR floor would swallow the whole
-- discount on every ticket up to 20 EUR, which is most of what these organizers
-- sell — so the floor has to come down with the percentage.
alter table public.platform_settings
  add column if not exists nonprofit_fee_percent numeric(5, 2) not null default 2.0
    check (nonprofit_fee_percent >= 0 and nonprofit_fee_percent <= 100),
  add column if not exists nonprofit_fee_min_cents integer not null default 20
    check (nonprofit_fee_min_cents >= 0);

comment on column public.platform_settings.nonprofit_fee_percent is
  'Commission percent applied when a non-profit claim is approved. Default 2.0.';
comment on column public.platform_settings.nonprofit_fee_min_cents is
  'Minimum commission for approved non-profits, in cents. Default 20 (0,20 EUR).';
