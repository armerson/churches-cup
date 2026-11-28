-- Supports "preview tournament setup" (admin dashboard): generating N
-- dummy teams + confirmed registrations so group/knockout fixtures can
-- be generated and inspected before any real team has entered, to check
-- competition seeding options (group counts, Championship/Plate/Shield
-- position ranges) are right. Dummy teams are flagged so the "clear test
-- data" action can find and remove exactly what it created.
alter table public.teams
    add column if not exists is_test boolean not null default false;

-- Found while building the above: registrations' INSERT policy let a
-- team manager insert their OWN registration at ANY status, including
-- 'confirmed' — the same class of hole as the registrations UPDATE
-- policy fixed in 20261127250000 (a malicious team manager could
-- self-confirm a paid entry with no payment, since the real app only
-- ever inserts through register_team_for_tournament(), which is
-- SECURITY DEFINER and unaffected by this policy either way — this was
-- simply never exercised, not deliberately permissive). A team manager
-- creating a registration directly (bypassing that function) can now
-- only do so as 'pending'; a tournament admin can insert at any status,
-- which the "preview tournament setup" feature above relies on.
drop policy if exists "team managers register their team" on public.registrations;

create policy "team managers register their team as pending"
    on public.registrations for insert
    with check (public.manages_team(team_id) and status = 'pending');

create policy "tournament admins insert any registration"
    on public.registrations for insert
    with check (public.administers_tournament(tournament_id));

-- Found while verifying the above: registrations only ever had SELECT
-- granted to authenticated (20261128091741) — INSERT/UPDATE/DELETE were
-- never granted at all, for any caller, despite RLS policies existing
-- for all three (including "team managers and tournament admins
-- withdraw registrations", a DELETE policy with no matching GRANT).
-- Dormant until now because the real app only ever inserts through
-- register_team_for_tournament(), a SECURITY DEFINER function that
-- doesn't need the caller's own table grants — but the "preview
-- tournament setup" admin action above does a direct insert, and any
-- future direct withdraw/admin-remove feature would hit the same wall.
grant insert, update, delete on public.registrations to authenticated;

-- Same gap, found the same way, on `teams`: only SELECT/INSERT were ever
-- granted (20261128091741) despite RLS policies existing for UPDATE
-- ("team managers update their team") and DELETE ("team managers and
-- platform admins delete teams") too. Dormant for the same reason —
-- nothing in the app has directly updated or deleted a team yet — until
-- the "clear test data" admin action above needs to delete the test
-- teams it created.
grant update, delete on public.teams to authenticated;
