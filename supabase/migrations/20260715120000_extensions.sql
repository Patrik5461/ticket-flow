-- Extensions required by the Ticketio schema.
-- pgcrypto: gen_random_uuid() / gen_random_bytes()
-- pg_cron:  scheduled release of expired order reservations (see cron migration)

create extension if not exists pgcrypto;

-- pg_cron must live in its own "cron" schema and requires the background worker,
-- which is enabled by default on Supabase cloud. If this statement fails on your
-- project, enable pg_cron once in Dashboard → Database → Extensions, then re-run
-- `npx supabase db push`.
create extension if not exists pg_cron;
