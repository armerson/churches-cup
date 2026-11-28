-- A parallel session found and fixed this for teams/team_contacts/
-- team_managers/registrations/tournaments (20261128091741): a Supabase
-- project with the Data API enabled does not grant table access just
-- because a migration creates a table with RLS policies — RLS only
-- restricts *rows* once a base SQL-level privilege already allows the
-- operation. That fix only covered 5 tables; this covers the rest.
-- Caught by that session actually testing against a real project, which
-- this sandbox's network policy doesn't allow — every grant below is a
-- real, previously-missing gap, not a defensive guess.
--
-- RLS continues to do the real restricting in every case — these grants
-- are deliberately broad (e.g. authenticated gets `insert` on
-- `organisations` even though only a platform_admin's insert actually
-- succeeds) because that's exactly how every other table here already
-- works: the grant is necessary but not sufficient, RLS is what's
-- sufficient.
--
-- Deliberately NOT granted here, unchanged from their original design:
-- `bracket_stages` and `webhook_events` have no authenticated-role grant
-- at all — they are only ever written by the service-role client (see
-- AGENTS.md's security model section). Granting them here would quietly
-- undo that boundary.

-- 20261128091741 only granted select on tournaments (enough for reading
-- a tournament, not for an org_admin to create or publish one).
grant insert, update, delete on public.tournaments to authenticated;

grant select, insert, update, delete on public.organisations to authenticated;
grant select, insert, update, delete on public.platform_admins to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select, insert, update, delete on public.competitions to authenticated;
grant select, insert, update, delete on public.pitches to authenticated;
grant select, insert, update, delete on public.fixtures to authenticated;
grant select, insert, update, delete on public.scores to authenticated;
grant select, insert, update, delete on public.notices to authenticated;
grant select, insert, update, delete on public.rosters to authenticated;
grant select, insert on public.payments to authenticated;
grant select, insert on public.audit_log to authenticated;

-- Separate, genuine bug found alongside the grants above while checking
-- every table's RLS against what the app actually does: lib/payments.ts
-- inserts a `payments` row (via the regular, RLS-respecting client)
-- right after reserve_registration_for_payment() has already verified
-- the caller manages that registration's team — but no INSERT policy on
-- `payments` ever existed for authenticated users at all, independent of
-- the grant above. Every real Checkout Session creation would have
-- failed at that insert.
create policy "team managers create their own payment record"
    on public.payments for insert
    with check (exists (
        select 1 from public.registrations r
        where r.id = payments.registration_id and public.manages_team(r.team_id)
    ));
