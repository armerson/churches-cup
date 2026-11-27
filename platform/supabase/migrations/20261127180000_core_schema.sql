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
