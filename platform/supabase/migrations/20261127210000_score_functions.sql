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
