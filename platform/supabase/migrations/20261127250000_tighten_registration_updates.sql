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
