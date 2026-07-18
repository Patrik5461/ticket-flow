-- Phase 17 Block 4: AI support usage metering.
--
-- Per-UTC-day counters of how many Anthropic API calls the buyer support
-- assistant made, how many support tools it executed, and how many times it
-- fell back to the static FAQ (daily limit reached or the API errored). This
-- gives /admin a cheap cost overview and backs the configurable daily cap
-- (env SUPPORT_DAILY_LIMIT). Written only by the server via the SECURITY
-- DEFINER bump function below; RLS on, no policies (service-role only).

create table if not exists public.support_usage (
  day date primary key,
  api_calls integer not null default 0,
  tool_calls integer not null default 0,
  fallback_hits integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.support_usage enable row level security;

-- Atomic upsert increment so concurrent chats can't lose counts (a JS
-- read-modify-write would race). current_date is UTC on the server.
create or replace function public.bump_support_usage(
  p_api integer,
  p_tool integer,
  p_fallback integer
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.support_usage (day, api_calls, tool_calls, fallback_hits)
  values (current_date, p_api, p_tool, p_fallback)
  on conflict (day) do update set
    api_calls = public.support_usage.api_calls + excluded.api_calls,
    tool_calls = public.support_usage.tool_calls + excluded.tool_calls,
    fallback_hits = public.support_usage.fallback_hits + excluded.fallback_hits,
    updated_at = now();
$$;
