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
