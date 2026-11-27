-- GENERATED FILE — all 8 migrations in supabase/migrations/, concatenated
-- in order, for pasting into the Supabase Dashboard's SQL Editor in one
-- go. Regenerate with:
--   cat supabase/migrations/*.sql > scripts/apply-all-migrations.sql
-- if new migrations are added — don't hand-edit this file directly.
-- Verified to apply cleanly, start to finish, against a fresh Postgres 16
-- database before being committed.

-- Core multi-organisation tournament schema (Phase 1 foundation).
--
-- Design notes:
-- - Every tenant-scoped table carries (directly or via its parent) an
--   org_id, and RLS enforces isolation through that column — see the
--   has_org_role()/is_platform_admin() helpers below.
-- - Team contact details (email/phone) are split into team_contacts,
--   separately RLS-protected, so a public tournament page can list team
--   names without exposing a parent/manager's personal contact details.
-- - `fixtures`/`scores` are intentionally generic (round as text,
--   group_label as text) — the scheduling engine (brackets-manager)
--   generates the shape; this schema just stores the result, it doesn't
--   encode any one bracket format.
-- - churches-cup's historical 2026 results are migrated into this schema
--   in a later, separate migration/script — this file only creates
--   structure.

create extension if not exists pgcrypto;

-- ── Organisations & platform-level roles ────────────────────────────────────

create table if not exists public.organisations (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text not null unique,
    logo_url text,
    created_at timestamptz not null default now()
);

create table if not exists public.platform_admins (
    user_id uuid primary key references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
);

-- One row per authenticated user, mirroring auth.users (display info only —
-- never store anything here that a public tournament page could leak).
create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text,
    avatar_url text,
    created_at timestamptz not null default now()
);

-- Org-scoped roles. 'spectator' deliberately has no row here — spectators
-- are just anyone without a membership, including anonymous visitors.
create table if not exists public.memberships (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references public.organisations(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    role text not null check (role in (
        'org_admin', 'tournament_admin', 'volunteer', 'referee', 'club_admin'
    )),
    created_at timestamptz not null default now(),
    unique (org_id, user_id, role)
);

-- ── Teams ────────────────────────────────────────────────────────────────────

-- Team identity is intentionally org-independent: a team can be entered
-- into tournaments run by organisations it has no other relationship to.
create table if not exists public.teams (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

-- Split from `teams` so public tournament pages can list team names
-- without exposing a manager's personal contact details.
create table if not exists public.team_contacts (
    team_id uuid primary key references public.teams(id) on delete cascade,
    contact_name text,
    contact_email text,
    contact_phone text,
    updated_at timestamptz not null default now()
);

-- Grants management rights over one team (replaces churches-cup's
-- shared-PIN model with real per-user accounts). A team's creator is
-- always implicitly a manager; this table is for adding others.
create table if not exists public.team_managers (
    team_id uuid not null references public.teams(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (team_id, user_id)
);

-- ── Tournaments ──────────────────────────────────────────────────────────────

create table if not exists public.tournaments (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references public.organisations(id) on delete cascade,
    name text not null,
    slug text not null,
    format text not null default 'custom',
    age_category text,
    starts_at date,
    ends_at date,
    venue jsonb not null default '{}'::jsonb,
    settings jsonb not null default '{}'::jsonb,
    is_public boolean not null default true,
    -- app-exclusive early access (brief §6): registration windows are
    -- enforced server-side by registration-write policies/functions, not
    -- just by hiding a button client-side.
    app_registration_opens_at timestamptz,
    website_registration_opens_at timestamptz,
    registration_closes_at timestamptz,
    max_teams int,
    status text not null default 'draft' check (status in (
        'draft', 'registration_open', 'in_progress', 'completed', 'archived'
    )),
    -- Placeholder for per-tournament public-visibility rules (e.g. league
    -- rules forbidding published scores for junior age groups). Enforcing
    -- this per age-group/competition needs more granularity than one flag
    -- gives — revisit once real age-category data exists.
    suppress_public_results boolean not null default false,
    created_at timestamptz not null default now(),
    unique (org_id, slug)
);

create table if not exists public.competitions (
    id uuid primary key default gen_random_uuid(),
    tournament_id uuid not null references public.tournaments(id) on delete cascade,
    name text not null,
    format text not null default 'knockout' check (format in (
        'round_robin', 'knockout', 'groups_then_knockout'
    )),
    created_at timestamptz not null default now()
);

create table if not exists public.pitches (
    id uuid primary key default gen_random_uuid(),
    tournament_id uuid not null references public.tournaments(id) on delete cascade,
    name text not null,
    colour text,
    created_at timestamptz not null default now()
);

-- ── Registration & payments ─────────────────────────────────────────────────

create table if not exists public.registrations (
    id uuid primary key default gen_random_uuid(),
    tournament_id uuid not null references public.tournaments(id) on delete cascade,
    team_id uuid not null references public.teams(id) on delete cascade,
    competition_id uuid references public.competitions(id) on delete set null,
    group_label text,
    status text not null default 'pending' check (status in (
        'pending', 'reserved', 'confirmed', 'waitlisted', 'withdrawn', 'cancelled'
    )),
    registered_by uuid references auth.users(id) on delete set null,
    -- Temporary hold during checkout (brief §7/§6) — a background job (or a
    -- check in the read path) expires unpaid reservations past this time.
    reservation_expires_at timestamptz,
    created_at timestamptz not null default now(),
    unique (tournament_id, team_id)
);

create table if not exists public.rosters (
    id uuid primary key default gen_random_uuid(),
    registration_id uuid not null references public.registrations(id) on delete cascade,
    player_name text not null,
    shirt_number int,
    created_at timestamptz not null default now()
);

create table if not exists public.payments (
    id uuid primary key default gen_random_uuid(),
    registration_id uuid not null references public.registrations(id) on delete cascade,
    provider text not null default 'stripe',
    provider_ref text,
    amount_cents int not null,
    currency text not null default 'gbp',
    status text not null default 'pending' check (status in (
        'pending', 'paid', 'failed', 'refunded', 'cancelled'
    )),
    idempotency_key text unique,
    created_at timestamptz not null default now()
);

-- ── Fixtures & scores ────────────────────────────────────────────────────────

create table if not exists public.fixtures (
    id uuid primary key default gen_random_uuid(),
    tournament_id uuid not null references public.tournaments(id) on delete cascade,
    competition_id uuid references public.competitions(id) on delete set null,
    round text,
    group_label text,
    team1_registration_id uuid references public.registrations(id) on delete set null,
    team2_registration_id uuid references public.registrations(id) on delete set null,
    pitch_id uuid references public.pitches(id) on delete set null,
    scheduled_at timestamptz,
    status text not null default 'scheduled' check (status in (
        'scheduled', 'in_progress', 'completed', 'postponed', 'cancelled'
    )),
    created_at timestamptz not null default now()
);

create table if not exists public.scores (
    id uuid primary key default gen_random_uuid(),
    fixture_id uuid not null unique references public.fixtures(id) on delete cascade,
    score1 int,
    score2 int,
    pen_score1 int,
    pen_score2 int,
    scorers1 jsonb not null default '[]'::jsonb,
    scorers2 jsonb not null default '[]'::jsonb,
    status text not null default 'pending' check (status in (
        'pending', 'confirmed', 'disputed'
    )),
    submitted_by uuid references auth.users(id) on delete set null,
    confirmed_by uuid references auth.users(id) on delete set null,
    dispute_note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.notices (
    id uuid primary key default gen_random_uuid(),
    tournament_id uuid not null references public.tournaments(id) on delete cascade,
    message text not null,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
    id uuid primary key default gen_random_uuid(),
    org_id uuid references public.organisations(id) on delete set null,
    actor_user_id uuid references auth.users(id) on delete set null,
    action text not null,
    entity_type text not null,
    entity_id uuid,
    before jsonb,
    after jsonb,
    created_at timestamptz not null default now()
);

-- ── RLS helper functions ─────────────────────────────────────────────────────
-- security definer + explicit search_path: these read across RLS boundaries
-- on purpose (that's the point of a helper), so search_path is pinned to
-- stop a malicious search_path substitution from hijacking the lookup.

create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
    select exists (
        select 1 from public.platform_admins where user_id = auth.uid()
    );
$$;

create or replace function public.has_org_role(p_org_id uuid, p_roles text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
    select
        public.is_platform_admin()
        or exists (
            select 1 from public.memberships m
            where m.org_id = p_org_id
              and m.user_id = auth.uid()
              and m.role = any(p_roles)
        );
$$;

create or replace function public.manages_team(p_team_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
    select
        public.is_platform_admin()
        or exists (
            select 1 from public.teams t
            where t.id = p_team_id and t.created_by = auth.uid()
        )
        or exists (
            select 1 from public.team_managers tm
            where tm.team_id = p_team_id and tm.user_id = auth.uid()
        );
$$;

-- True if the caller administers the tournament this fixture/registration
-- belongs to (org_admin or tournament_admin of its org).
create or replace function public.administers_tournament(p_tournament_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
    select public.has_org_role(
        (select org_id from public.tournaments where id = p_tournament_id),
        array['org_admin', 'tournament_admin']
    );
$$;

-- ── Row Level Security ───────────────────────────────────────────────────────

alter table public.organisations enable row level security;
alter table public.platform_admins enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.teams enable row level security;
alter table public.team_contacts enable row level security;
alter table public.team_managers enable row level security;
alter table public.tournaments enable row level security;
alter table public.competitions enable row level security;
alter table public.pitches enable row level security;
alter table public.registrations enable row level security;
alter table public.rosters enable row level security;
alter table public.payments enable row level security;
alter table public.fixtures enable row level security;
alter table public.scores enable row level security;
alter table public.notices enable row level security;
alter table public.audit_log enable row level security;

-- Organisations: public directory (brief §12 tournament discovery browses
-- by organisation), but only a platform admin creates/edits one in Phase 1
-- (self-service organiser onboarding is a Phase 4 concern).
create policy "organisations are publicly readable"
    on public.organisations for select
    using (true);

create policy "only platform admins manage organisations"
    on public.organisations for all
    using (public.is_platform_admin())
    with check (public.is_platform_admin());

create policy "only platform admins manage platform_admins"
    on public.platform_admins for all
    using (public.is_platform_admin())
    with check (public.is_platform_admin());

create policy "users manage their own profile"
    on public.profiles for all
    using (id = auth.uid())
    with check (id = auth.uid());

create policy "profiles are publicly readable"
    on public.profiles for select
    using (true);

create policy "members see their org's memberships"
    on public.memberships for select
    using (
        user_id = auth.uid()
        or public.has_org_role(org_id, array['org_admin', 'tournament_admin'])
    );

create policy "org_admins manage their org's memberships"
    on public.memberships for all
    using (public.has_org_role(org_id, array['org_admin']))
    with check (public.has_org_role(org_id, array['org_admin']));

-- Teams: names are public (tournament pages list entrants); any signed-in
-- user can register a team; only its manager(s) or a relevant admin edit it.
create policy "teams are publicly readable"
    on public.teams for select
    using (true);

create policy "signed-in users create teams"
    on public.teams for insert
    with check (auth.uid() is not null);

create policy "team managers update their team"
    on public.teams for update
    using (public.manages_team(id))
    with check (public.manages_team(id));

create policy "team managers and platform admins delete teams"
    on public.teams for delete
    using (public.manages_team(id));

-- Team contacts: never public. Visible only to the team's own managers and
-- to admins of a tournament that team is actually registered in.
create policy "team contacts visible to managers and tournament admins"
    on public.team_contacts for select
    using (
        public.manages_team(team_id)
        or exists (
            select 1 from public.registrations r
            where r.team_id = team_contacts.team_id
              and public.administers_tournament(r.tournament_id)
        )
    );

create policy "team managers write their team's contact details"
    on public.team_contacts for insert
    with check (public.manages_team(team_id));

create policy "team managers update their team's contact details"
    on public.team_contacts for update
    using (public.manages_team(team_id))
    with check (public.manages_team(team_id));

create policy "team managers remove their team's contact details"
    on public.team_contacts for delete
    using (public.manages_team(team_id));

create policy "team managers list is visible to managers and admins"
    on public.team_managers for select
    using (
        public.manages_team(team_id)
        or exists (
            select 1 from public.registrations r
            where r.team_id = team_managers.team_id
              and public.administers_tournament(r.tournament_id)
        )
    );

create policy "existing managers add other managers"
    on public.team_managers for insert
    with check (public.manages_team(team_id));

create policy "existing managers remove other managers"
    on public.team_managers for delete
    using (public.manages_team(team_id));

-- Tournaments: public ones are world-readable (brief §10/§12); private or
-- invitation-only ones (is_public = false) are visible only to org members.
create policy "public tournaments are readable by anyone"
    on public.tournaments for select
    using (is_public or public.has_org_role(org_id, array[
        'org_admin', 'tournament_admin', 'volunteer', 'referee', 'club_admin'
    ]));

create policy "org/tournament admins manage tournaments"
    on public.tournaments for all
    using (public.has_org_role(org_id, array['org_admin', 'tournament_admin']))
    with check (public.has_org_role(org_id, array['org_admin', 'tournament_admin']));

create policy "competitions follow their tournament's visibility"
    on public.competitions for select
    using (exists (
        select 1 from public.tournaments t
        where t.id = competitions.tournament_id
          and (t.is_public or public.has_org_role(t.org_id, array[
              'org_admin', 'tournament_admin', 'volunteer', 'referee', 'club_admin'
          ]))
    ));

create policy "tournament admins manage competitions"
    on public.competitions for all
    using (public.administers_tournament(tournament_id))
    with check (public.administers_tournament(tournament_id));

create policy "pitches follow their tournament's visibility"
    on public.pitches for select
    using (exists (
        select 1 from public.tournaments t
        where t.id = pitches.tournament_id
          and (t.is_public or public.has_org_role(t.org_id, array[
              'org_admin', 'tournament_admin', 'volunteer', 'referee', 'club_admin'
          ]))
    ));

create policy "tournament admins manage pitches"
    on public.pitches for all
    using (public.administers_tournament(tournament_id))
    with check (public.administers_tournament(tournament_id));

-- Registrations: readable wherever the parent tournament is readable (team
-- entry lists are normally public); writable by the team's own manager
-- (self-service registration) or a tournament admin.
create policy "registrations follow their tournament's visibility"
    on public.registrations for select
    using (exists (
        select 1 from public.tournaments t
        where t.id = registrations.tournament_id
          and (t.is_public or public.has_org_role(t.org_id, array[
              'org_admin', 'tournament_admin', 'volunteer', 'referee', 'club_admin'
          ]))
    ));

create policy "team managers register their team"
    on public.registrations for insert
    with check (public.manages_team(team_id));

create policy "team managers and tournament admins update registrations"
    on public.registrations for update
    using (public.manages_team(team_id) or public.administers_tournament(tournament_id))
    with check (public.manages_team(team_id) or public.administers_tournament(tournament_id));

create policy "team managers and tournament admins withdraw registrations"
    on public.registrations for delete
    using (public.manages_team(team_id) or public.administers_tournament(tournament_id));

create policy "rosters visible to team managers and tournament admins"
    on public.rosters for select
    using (exists (
        select 1 from public.registrations r
        where r.id = rosters.registration_id
          and (public.manages_team(r.team_id) or public.administers_tournament(r.tournament_id))
    ));

create policy "team managers write their roster"
    on public.rosters for all
    using (exists (
        select 1 from public.registrations r
        where r.id = rosters.registration_id and public.manages_team(r.team_id)
    ))
    with check (exists (
        select 1 from public.registrations r
        where r.id = rosters.registration_id and public.manages_team(r.team_id)
    ));

-- Payments: never public. Visible to the paying team's manager and to
-- tournament admins; written only by server-side code (service role),
-- never directly by a client — no insert/update policy for regular users.
create policy "payments visible to payer and tournament admins"
    on public.payments for select
    using (exists (
        select 1 from public.registrations r
        where r.id = payments.registration_id
          and (public.manages_team(r.team_id) or public.administers_tournament(r.tournament_id))
    ));

-- Fixtures/scores: readable wherever the tournament is readable, subject
-- to the suppress_public_results flag for non-admins.
create policy "fixtures follow their tournament's visibility"
    on public.fixtures for select
    using (exists (
        select 1 from public.tournaments t
        where t.id = fixtures.tournament_id
          and (
              public.has_org_role(t.org_id, array[
                  'org_admin', 'tournament_admin', 'volunteer', 'referee', 'club_admin'
              ])
              or (t.is_public and not t.suppress_public_results)
          )
    ));

create policy "tournament admins manage fixtures"
    on public.fixtures for all
    using (public.administers_tournament(tournament_id))
    with check (public.administers_tournament(tournament_id));

create policy "scores follow their fixture's tournament visibility"
    on public.scores for select
    using (exists (
        select 1 from public.fixtures f
        join public.tournaments t on t.id = f.tournament_id
        where f.id = scores.fixture_id
          and (
              public.has_org_role(t.org_id, array[
                  'org_admin', 'tournament_admin', 'volunteer', 'referee', 'club_admin'
              ])
              or (t.is_public and not t.suppress_public_results)
          )
    ));

-- A score is submitted/confirmed by a manager of either team in the fixture,
-- or by a tournament admin (organiser override) — mirrors churches-cup's
-- confirm/dispute flow, now backed by real accounts instead of shared PINs.
create policy "team managers and tournament admins write scores"
    on public.scores for all
    using (exists (
        select 1 from public.fixtures f
        where f.id = scores.fixture_id
          and (
              public.administers_tournament(f.tournament_id)
              or exists (
                  select 1 from public.registrations r
                  where r.id in (f.team1_registration_id, f.team2_registration_id)
                    and public.manages_team(r.team_id)
              )
          )
    ))
    with check (exists (
        select 1 from public.fixtures f
        where f.id = scores.fixture_id
          and (
              public.administers_tournament(f.tournament_id)
              or exists (
                  select 1 from public.registrations r
                  where r.id in (f.team1_registration_id, f.team2_registration_id)
                    and public.manages_team(r.team_id)
              )
          )
    ));

create policy "notices follow their tournament's visibility"
    on public.notices for select
    using (exists (
        select 1 from public.tournaments t
        where t.id = notices.tournament_id
          and (t.is_public or public.has_org_role(t.org_id, array[
              'org_admin', 'tournament_admin', 'volunteer', 'referee', 'club_admin'
          ]))
    ));

create policy "tournament admins post notices"
    on public.notices for all
    using (public.administers_tournament(tournament_id))
    with check (public.administers_tournament(tournament_id));

-- Audit log: write-only from the app's perspective, readable only by the
-- org's own admins or a platform admin — never by ordinary members.
create policy "org admins read their audit log"
    on public.audit_log for select
    using (org_id is null and public.is_platform_admin() or public.has_org_role(org_id, array['org_admin']));

create policy "authenticated users append audit log entries"
    on public.audit_log for insert
    with check (auth.uid() is not null);

-- ── Seed data ────────────────────────────────────────────────────────────────

insert into public.organisations (name, slug)
values ('Ambassadors FC', 'ambassadors')
on conflict (slug) do nothing;
-- Auto-create a public.profiles row whenever a new auth.users row appears,
-- so every sign-up method (password, OAuth, magic link) gets one uniformly
-- instead of relying on application code to remember to create it.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, full_name)
    values (new.id, new.raw_user_meta_data ->> 'full_name')
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
-- Atomic team registration: capacity check + insert happen inside one
-- transaction, under a row lock on the tournament, so concurrent
-- registrations for the same tournament serialize instead of racing on the
-- "how many teams so far" count (brief §6: "prevent overselling ... race
-- conditions when multiple teams attempt to book simultaneously").
--
-- p_channel distinguishes app-exclusive early access from general website
-- registration (brief §6) — there's no mobile app yet, but the function is
-- ready for it: pass p_channel => 'app' once it exists.

create or replace function public.register_team_for_tournament(
    p_tournament_id uuid,
    p_team_id uuid,
    p_channel text default 'website'
)
returns public.registrations
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tournament public.tournaments%rowtype;
    v_opens_at timestamptz;
    v_count int;
    v_status text;
    v_registration public.registrations;
begin
    if p_channel not in ('website', 'app') then
        raise exception 'Invalid channel.';
    end if;

    -- Replicated here because this function runs as security definer and
    -- so bypasses the teams/registrations RLS policies entirely.
    if not public.manages_team(p_team_id) then
        raise exception 'Not authorised to register this team.';
    end if;

    select * into v_tournament
    from public.tournaments
    where id = p_tournament_id
    for update;

    if not found then
        raise exception 'Tournament not found.';
    end if;

    if v_tournament.status <> 'registration_open' then
        raise exception 'Registration is not open for this tournament.';
    end if;

    if v_tournament.registration_closes_at is not null
       and now() > v_tournament.registration_closes_at then
        raise exception 'Registration has closed.';
    end if;

    v_opens_at := case
        when p_channel = 'app' then v_tournament.app_registration_opens_at
        else coalesce(v_tournament.website_registration_opens_at, v_tournament.app_registration_opens_at)
    end;

    if v_opens_at is not null and now() < v_opens_at then
        raise exception 'Registration has not opened yet.';
    end if;

    select count(*) into v_count
    from public.registrations
    where tournament_id = p_tournament_id
      and status in ('pending', 'reserved', 'confirmed');

    v_status := case
        when v_tournament.max_teams is not null and v_count >= v_tournament.max_teams
            then 'waitlisted'
        else 'pending'
    end;

    insert into public.registrations (tournament_id, team_id, status, registered_by)
    values (p_tournament_id, p_team_id, v_status, auth.uid())
    returning * into v_registration;

    return v_registration;
exception
    when unique_violation then
        raise exception 'This team is already registered for this tournament.';
end;
$$;

grant execute on function public.register_team_for_tournament(uuid, uuid, text) to authenticated;
-- Score submit/confirm/dispute, ported from churches-cup's proven
-- Code.gs submitScore/confirmKOMatch/updateStatus flow onto the new
-- schema, now backed by real accounts instead of shared team PINs.
--
-- Tightens the blanket "team managers and tournament admins write scores"
-- policy from the core schema migration: a team manager can no longer
-- directly UPDATE an arbitrary score row (that let a manager silently
-- rewrite a confirmed result). Submission and confirm/dispute now go
-- through these two functions, which replicate churches-cup's actual
-- rules (the submitting side cannot confirm its own result); admins keep
-- direct edit/delete rights for organiser overrides.

drop policy if exists "team managers and tournament admins write scores" on public.scores;

create policy "tournament admins manage scores directly"
    on public.scores for all
    using (exists (
        select 1 from public.fixtures f
        where f.id = scores.fixture_id and public.administers_tournament(f.tournament_id)
    ))
    with check (exists (
        select 1 from public.fixtures f
        where f.id = scores.fixture_id and public.administers_tournament(f.tournament_id)
    ));

create or replace function public.submit_score(
    p_fixture_id uuid,
    p_score1 int,
    p_score2 int,
    p_scorers1 jsonb default '[]'::jsonb,
    p_scorers2 jsonb default '[]'::jsonb
)
returns public.scores
language plpgsql
security definer
set search_path = public
as $$
declare
    v_fixture public.fixtures%rowtype;
    v_team1 uuid;
    v_team2 uuid;
    v_result public.scores;
begin
    select * into v_fixture from public.fixtures where id = p_fixture_id for update;
    if not found then
        raise exception 'Fixture not found.';
    end if;

    select team_id into v_team1 from public.registrations where id = v_fixture.team1_registration_id;
    select team_id into v_team2 from public.registrations where id = v_fixture.team2_registration_id;

    if not (
        public.administers_tournament(v_fixture.tournament_id)
        or public.manages_team(v_team1)
        or public.manages_team(v_team2)
    ) then
        raise exception 'Not authorised to submit a score for this fixture.';
    end if;

    insert into public.scores (fixture_id, score1, score2, scorers1, scorers2, status, submitted_by)
    values (p_fixture_id, p_score1, p_score2, p_scorers1, p_scorers2, 'pending', auth.uid())
    returning * into v_result;

    return v_result;
exception
    when unique_violation then
        raise exception 'A score has already been submitted for this fixture.';
end;
$$;

grant execute on function public.submit_score(uuid, int, int, jsonb, jsonb) to authenticated;

-- Only the OPPONENT of the submitting team (or a tournament admin) may
-- resolve a pending score — the submitter can never confirm its own
-- result, mirroring churches-cup's Code.gs confirmKOMatch/updateStatus.
create or replace function public.resolve_score(
    p_fixture_id uuid,
    p_status text,
    p_dispute_note text default null
)
returns public.scores
language plpgsql
security definer
set search_path = public
as $$
declare
    v_fixture public.fixtures%rowtype;
    v_score public.scores%rowtype;
    v_team1 uuid;
    v_team2 uuid;
    v_is_admin boolean;
begin
    if p_status not in ('confirmed', 'disputed') then
        raise exception 'Invalid status.';
    end if;

    select * into v_fixture from public.fixtures where id = p_fixture_id;
    if not found then
        raise exception 'Fixture not found.';
    end if;

    select * into v_score from public.scores where fixture_id = p_fixture_id for update;
    if not found then
        raise exception 'No score submitted for this fixture yet.';
    end if;

    if v_score.status <> 'pending' then
        raise exception 'This score has already been resolved.';
    end if;

    select team_id into v_team1 from public.registrations where id = v_fixture.team1_registration_id;
    select team_id into v_team2 from public.registrations where id = v_fixture.team2_registration_id;

    v_is_admin := public.administers_tournament(v_fixture.tournament_id);

    if not v_is_admin then
        if auth.uid() = v_score.submitted_by then
            raise exception 'The submitting team cannot confirm its own result.';
        end if;
        if not (public.manages_team(v_team1) or public.manages_team(v_team2)) then
            raise exception 'Not authorised to resolve this fixture''s score.';
        end if;
    end if;

    update public.scores
    set status = p_status,
        dispute_note = case when p_status = 'disputed' then p_dispute_note else dispute_note end,
        confirmed_by = auth.uid(),
        updated_at = now()
    where fixture_id = p_fixture_id
    returning * into v_score;

    return v_score;
end;
$$;

grant execute on function public.resolve_score(uuid, text, text) to authenticated;
-- Support for knockout bracket progression. Unlike round-robin, a
-- knockout round's pairings depend on the previous round's results, so
-- generating a bracket doesn't fully determine every fixture up front —
-- later rounds start as "TBD vs TBD" and get filled in as earlier rounds
-- are confirmed.
--
-- The actual bracket-progression logic (propagating a winner through an
-- arbitrary single/double-elimination topology) lives in brackets-manager,
-- a JS library — Postgres can't run it. bracket_stages stores that
-- library's own serialized state (one row per competition) so the app
-- layer can rehydrate an in-memory instance, feed it a confirmed result,
-- and read back which newly-resolved matches to sync into `fixtures`.

alter table public.fixtures add column if not exists bracket_match_id int;

create unique index if not exists fixtures_competition_bracket_match_uidx
    on public.fixtures (competition_id, bracket_match_id)
    where bracket_match_id is not null;

create table if not exists public.bracket_stages (
    competition_id uuid primary key references public.competitions(id) on delete cascade,
    -- registrationIds in the exact order passed as brackets-manager's
    -- seeding array — participant id i always means participant_map[i],
    -- verified against the real library (see commit message).
    participant_map jsonb not null,
    -- Full brackets-manager storage snapshot (participant/stage/group/
    -- round/match/match_game tables) — opaque to SQL, read/written only
    -- by lib/bracket.ts.
    data jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.bracket_stages enable row level security;

-- No insert/update/delete policy for ordinary users: this table is only
-- ever written by server-side code using the service-role client, as the
-- trusted consequence of a score already confirmed through
-- resolve_score()'s own (fully RLS-checked) authorization path — see
-- lib/bracket.ts's advanceBracket(). Tournament admins can still read the
-- raw state if they want to inspect it.
create policy "tournament admins read bracket stage state"
    on public.bracket_stages for select
    using (exists (
        select 1 from public.competitions c
        where c.id = bracket_stages.competition_id
          and public.administers_tournament(c.tournament_id)
    ));
-- Knockout ties need a penalty shootout result to produce a winner —
-- submit_score previously had nowhere to record one. Postgres resolves
-- functions by name *and* argument list, so just adding parameters would
-- leave the old 5-argument version callable alongside this one; drop it
-- explicitly instead of letting two overloads coexist pointlessly (no
-- real Supabase project has ever called the old signature).

drop function if exists public.submit_score(uuid, int, int, jsonb, jsonb);

create or replace function public.submit_score(
    p_fixture_id uuid,
    p_score1 int,
    p_score2 int,
    p_scorers1 jsonb default '[]'::jsonb,
    p_scorers2 jsonb default '[]'::jsonb,
    p_pen_score1 int default null,
    p_pen_score2 int default null
)
returns public.scores
language plpgsql
security definer
set search_path = public
as $$
declare
    v_fixture public.fixtures%rowtype;
    v_team1 uuid;
    v_team2 uuid;
    v_result public.scores;
begin
    select * into v_fixture from public.fixtures where id = p_fixture_id for update;
    if not found then
        raise exception 'Fixture not found.';
    end if;

    select team_id into v_team1 from public.registrations where id = v_fixture.team1_registration_id;
    select team_id into v_team2 from public.registrations where id = v_fixture.team2_registration_id;

    if not (
        public.administers_tournament(v_fixture.tournament_id)
        or public.manages_team(v_team1)
        or public.manages_team(v_team2)
    ) then
        raise exception 'Not authorised to submit a score for this fixture.';
    end if;

    insert into public.scores (
        fixture_id, score1, score2, scorers1, scorers2, pen_score1, pen_score2, status, submitted_by
    )
    values (
        p_fixture_id, p_score1, p_score2, p_scorers1, p_scorers2, p_pen_score1, p_pen_score2, 'pending', auth.uid()
    )
    returning * into v_result;

    return v_result;
exception
    when unique_violation then
        raise exception 'A score has already been submitted for this fixture.';
end;
$$;

grant execute on function public.submit_score(uuid, int, int, jsonb, jsonb, int, int) to authenticated;
-- Stripe Connect payments. Each organisation gets its own connected
-- Express account and receives its own tournament income — the platform
-- never holds organiser revenue itself (brief §7: "Do not assume all
-- tournament revenue belongs to Ambassadors"). Checkout uses the
-- "destination charge" pattern: one Checkout Session per registration,
-- with the charge created on the platform account and the organiser's
-- share transferred to their connected account via
-- payment_intent_data.transfer_data.

alter table public.organisations
    add column if not exists stripe_account_id text,
    add column if not exists stripe_onboarding_complete boolean not null default false;

alter table public.tournaments
    add column if not exists entry_fee_cents int not null default 0;

alter table public.payments
    add column if not exists stripe_checkout_session_id text;

create unique index if not exists payments_stripe_checkout_session_uidx
    on public.payments (stripe_checkout_session_id)
    where stripe_checkout_session_id is not null;

-- Webhook idempotency: Stripe can and does redeliver the same event: a
-- primary-key conflict on insert is how the webhook handler detects and
-- skips a duplicate, rather than reprocessing a payment twice.
create table if not exists public.webhook_events (
    id text primary key,
    provider text not null default 'stripe',
    created_at timestamptz not null default now()
);

alter table public.webhook_events enable row level security;
-- No policy at all: only the service-role webhook handler ever touches
-- this table; it isn't meant to be queried by any authenticated client.

-- A 'reserved' registration holds a place during checkout but shouldn't
-- count against capacity forever if payment never completes — register_
-- team_for_tournament now excludes expired reservations from both the
-- capacity count and (defensively) sweeps them to 'cancelled' first, so
-- the slot genuinely frees up rather than just being undercounted.
create or replace function public.register_team_for_tournament(
    p_tournament_id uuid,
    p_team_id uuid,
    p_channel text default 'website'
)
returns public.registrations
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tournament public.tournaments%rowtype;
    v_opens_at timestamptz;
    v_count int;
    v_status text;
    v_registration public.registrations;
begin
    if p_channel not in ('website', 'app') then
        raise exception 'Invalid channel.';
    end if;

    if not public.manages_team(p_team_id) then
        raise exception 'Not authorised to register this team.';
    end if;

    select * into v_tournament
    from public.tournaments
    where id = p_tournament_id
    for update;

    if not found then
        raise exception 'Tournament not found.';
    end if;

    if v_tournament.status <> 'registration_open' then
        raise exception 'Registration is not open for this tournament.';
    end if;

    if v_tournament.registration_closes_at is not null
       and now() > v_tournament.registration_closes_at then
        raise exception 'Registration has closed.';
    end if;

    v_opens_at := case
        when p_channel = 'app' then v_tournament.app_registration_opens_at
        else coalesce(v_tournament.website_registration_opens_at, v_tournament.app_registration_opens_at)
    end;

    if v_opens_at is not null and now() < v_opens_at then
        raise exception 'Registration has not opened yet.';
    end if;

    -- Sweep this tournament's own expired reservations before counting —
    -- still correct under concurrency, since the row lock above already
    -- serializes every registration attempt for this tournament.
    update public.registrations
    set status = 'cancelled'
    where tournament_id = p_tournament_id
      and status = 'reserved'
      and reservation_expires_at is not null
      and reservation_expires_at < now();

    select count(*) into v_count
    from public.registrations
    where tournament_id = p_tournament_id
      and status in ('pending', 'reserved', 'confirmed');

    v_status := case
        when v_tournament.max_teams is not null and v_count >= v_tournament.max_teams
            then 'waitlisted'
        else 'pending'
    end;

    insert into public.registrations (tournament_id, team_id, status, registered_by)
    values (p_tournament_id, p_team_id, v_status, auth.uid())
    returning * into v_registration;

    return v_registration;
exception
    when unique_violation then
        raise exception 'This team is already registered for this tournament.';
end;
$$;

grant execute on function public.register_team_for_tournament(uuid, uuid, text) to authenticated;
-- The registrations UPDATE policy from the core schema let a team
-- manager set their OWN registration to any status via a direct client
-- update — including 'confirmed', with no check that a paid tournament's
-- entry fee was ever paid. Found while wiring the free-tournament
-- auto-confirm path in this payments slice; a malicious team manager
-- could otherwise self-confirm a paid entry for free. Split into two
-- policies: a team manager can only withdraw their own registration;
-- everything else (including confirming) requires a tournament admin or
-- this dedicated function.

drop policy if exists "team managers and tournament admins update registrations" on public.registrations;

create policy "tournament admins update any registration"
    on public.registrations for update
    using (public.administers_tournament(tournament_id))
    with check (public.administers_tournament(tournament_id));

create policy "team managers withdraw their own registration"
    on public.registrations for update
    using (public.manages_team(team_id))
    with check (public.manages_team(team_id) and status = 'withdrawn');

-- The one case a team manager legitimately confirms their own
-- registration without an admin or a payment: a free tournament. Payment
-- confirmation instead goes through the Stripe webhook using the
-- service-role client (bypasses RLS as the trusted consequence of a
-- verified Stripe event, same pattern as advanceBracket).
create or replace function public.confirm_free_registration(p_registration_id uuid)
returns public.registrations
language plpgsql
security definer
set search_path = public
as $$
declare
    v_registration public.registrations%rowtype;
    v_tournament public.tournaments%rowtype;
begin
    select * into v_registration from public.registrations where id = p_registration_id for update;
    if not found then
        raise exception 'Registration not found.';
    end if;

    select * into v_tournament from public.tournaments where id = v_registration.tournament_id;

    if v_tournament.entry_fee_cents > 0 then
        raise exception 'This tournament requires payment and cannot be confirmed without it.';
    end if;

    if not (
        public.manages_team(v_registration.team_id)
        or public.administers_tournament(v_tournament.id)
    ) then
        raise exception 'Not authorised.';
    end if;

    if v_registration.status <> 'pending' then
        raise exception 'Registration is not pending.';
    end if;

    update public.registrations
    set status = 'confirmed'
    where id = p_registration_id
    returning * into v_registration;

    return v_registration;
end;
$$;

grant execute on function public.confirm_free_registration(uuid) to authenticated;

-- The paid-tournament counterpart: claims the reservation window used
-- while a Checkout Session is open. Same reasoning as
-- confirm_free_registration — a plain client update can't be trusted
-- with a status transition that matters, even one as unglamorous as
-- "pending -> reserved".
create or replace function public.reserve_registration_for_payment(p_registration_id uuid)
returns public.registrations
language plpgsql
security definer
set search_path = public
as $$
declare
    v_registration public.registrations%rowtype;
    v_tournament public.tournaments%rowtype;
begin
    select * into v_registration from public.registrations where id = p_registration_id for update;
    if not found then
        raise exception 'Registration not found.';
    end if;

    select * into v_tournament from public.tournaments where id = v_registration.tournament_id;

    if v_tournament.entry_fee_cents <= 0 then
        raise exception 'This tournament has no entry fee.';
    end if;

    if not public.manages_team(v_registration.team_id) then
        raise exception 'Not authorised.';
    end if;

    if v_registration.status <> 'pending' then
        raise exception 'Registration is not pending.';
    end if;

    -- Matches the 30-minute minimum Stripe enforces on a Checkout
    -- Session's own expires_at — the two have to agree, or a completed
    -- payment could land after our own reservation already lapsed.
    update public.registrations
    set status = 'reserved', reservation_expires_at = now() + interval '30 minutes'
    where id = p_registration_id
    returning * into v_registration;

    return v_registration;
end;
$$;

grant execute on function public.reserve_registration_for_payment(uuid) to authenticated;
