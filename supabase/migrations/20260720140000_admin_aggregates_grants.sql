-- Harden the admin aggregate functions. They are SECURITY DEFINER (run as the
-- owner), so the default EXECUTE-to-PUBLIC grant would let anon/authenticated
-- call them and read ALL platform revenue. Restrict execution to service_role,
-- which is the only intended caller (the admin server fns use the service
-- client). No public/anon access.

revoke execute on function public.admin_overview_stats(integer) from public;
revoke execute on function public.admin_platform_stats() from public;

-- anon/authenticated are not part of PUBLIC in all setups; revoke explicitly.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function public.admin_overview_stats(integer) from anon';
    execute 'revoke execute on function public.admin_platform_stats() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke execute on function public.admin_overview_stats(integer) from authenticated';
    execute 'revoke execute on function public.admin_platform_stats() from authenticated';
  end if;
end $$;

grant execute on function public.admin_overview_stats(integer) to service_role;
grant execute on function public.admin_platform_stats() to service_role;
