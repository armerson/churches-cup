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
