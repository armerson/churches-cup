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
