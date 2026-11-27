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
