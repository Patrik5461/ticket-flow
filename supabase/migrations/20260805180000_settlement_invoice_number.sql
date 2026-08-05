-- Keep the invoice number next to the invoice id.
--
-- invoice_ref was holding whichever of the two the provider happened to answer
-- with, preferring the printed number. That reads well in the admin and is
-- useless to the code: every follow-up call in the Faktero API is addressed by
-- id — GET /invoices/{id}/pdf, POST /invoices/{id}/send, /mark-paid, /cancel.
-- A settlement that recorded "20260901" could never be turned back into a PDF
-- or an e-mail.
--
-- So invoice_ref keeps the id, and the number — the thing an organizer quotes
-- when they ask what they are paying for — gets its own column.

alter table public.settlements
  add column if not exists invoice_number text;

comment on column public.settlements.invoice_ref is
  'Provider invoice id; the handle for PDF, send, mark-paid and cancel.';
comment on column public.settlements.invoice_number is
  'Invoice number as printed on the document, for humans.';
