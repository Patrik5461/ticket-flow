-- Pin the search_path of immutable_unaccent.
--
-- The linter flags it as having a mutable search_path, which on a function that
-- resolves unqualified names is how a caller-controlled schema gets to shadow
-- the function's own dependencies. This one is not actually exposed: its body
-- already qualifies everything (extensions.unaccent, and the regdictionary
-- literal names the schema too), so nothing in it resolves through the path.
-- Pinning it is defence in depth and, mainly, keeps a later edit from
-- introducing an unqualified name into a function whose path is wide open.
--
-- ALTER, not CREATE OR REPLACE, on purpose: events.search_text and
-- events.city_key are stored generated columns computed from this function, so
-- they depend on it. Setting an attribute leaves the body and the volatility
-- alone; replacing it would rewrite something two columns are built on for no
-- behavioural gain. The output is byte-for-byte the same either way, so the
-- values already stored stay correct and no backfill is needed.

alter function public.immutable_unaccent(text) set search_path = '';
