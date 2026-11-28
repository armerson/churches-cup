-- Projects with opt-in Data API exposure do not grant table access when
-- migrations create tables. RLS policies alone do not provide those grants.
-- Scope this fix to the existing create-team and team-list queries.

do $$
begin
  if exists (
    select 1
    from (values ('teams'), ('team_contacts'), ('team_managers'),
                 ('registrations'), ('tournaments')) required(table_name)
    where not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = required.table_name
        and c.relrowsecurity
    )
  ) then
    raise exception 'Team API grants require the core tables and their RLS policies first';
  end if;
end;
$$;

-- A client may only create a team owned by the signed-in caller.
alter policy "signed-in users create teams" on public.teams
  to authenticated
  with check (created_by = (select auth.uid()));

grant usage on schema public to authenticated;
grant select, insert on public.teams to authenticated;
grant select, insert on public.team_contacts to authenticated;
grant select on public.team_managers to authenticated;

-- Team-manager/contact SELECT policies inspect registration/tournament
-- visibility. These reads remain filtered by those tables' existing RLS.
grant select on public.registrations, public.tournaments to authenticated;

grant execute on function public.manages_team(uuid) to authenticated;
grant execute on function public.administers_tournament(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, text[]) to authenticated;
grant execute on function public.is_platform_admin() to authenticated;
