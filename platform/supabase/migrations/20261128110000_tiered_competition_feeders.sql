-- Supports a 3-tier group->knockout structure like Churches Cup's
-- Championship/Shield/Plate: a competition can be seeded directly from
-- group standings (a position range, e.g. "top 2 per group" or "bottom
-- team per group"), and/or receive the LOSERS of another competition's
-- first knockout round once that round is fully confirmed (Shield taking
-- Championship's round-1 losers, alongside its own directly-seeded
-- 3rd-place teams).
--
-- advance_from_position_start/end: 1-indexed, inclusive, group finishing
-- position range that feeds this competition directly (e.g. 1..2 for
-- Championship, 4..4 for Plate, 3..3 for Shield's direct portion).
-- feeder_competition_id: the OTHER competition whose round-1 losers also
-- feed this one (Shield -> Championship). A competition can be a direct
-- group feed, a loser feed, both, or neither (knockout generated from
-- "all confirmed registrations", the original behaviour).

alter table public.competitions
    add column if not exists advance_from_position_start int,
    add column if not exists advance_from_position_end int,
    add column if not exists feeder_competition_id uuid references public.competitions(id) on delete set null;

alter table public.competitions
    add constraint competitions_advance_position_range_chk
    check (
        (advance_from_position_start is null) = (advance_from_position_end is null)
        and (advance_from_position_start is null or advance_from_position_start <= advance_from_position_end)
    );

-- competitions already has an insert/update/delete-via-admin RLS policy
-- and a broad authenticated grant from 20261128100000 — the two new
-- nullable columns and the FK need no new policy or grant.
