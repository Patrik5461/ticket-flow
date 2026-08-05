-- Remember which Faktero customer an organizer is.
--
-- A Faktero invoice is billed to a customer_id and cannot carry the customer
-- inline, so the organizer has to exist there before the first commission
-- invoice. The obvious lookup — GET /customers?external_id=<organizer id> —
-- does not work: the API accepts the parameter and answers with the whole
-- unfiltered list, so there is no way to ask "do you already know this one?".
-- Without a mapping on our side, every month would create another copy of the
-- same organizer.
--
-- Written by src/server/settlement-invoicing.ts after the first invoice for
-- that organizer, and read on every later one. Not a secret (it identifies a
-- record in our own invoicing account), so it inherits the table's grants.

alter table public.organizers
  add column if not exists faktero_customer_id text;

comment on column public.organizers.faktero_customer_id is
  'Faktero customer id for commission invoices; set on first invoice.';
