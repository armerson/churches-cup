import "server-only";
import { createClient } from "./supabase/server";

export type TournamentDetail = {
  id: string;
  name: string;
  status: string;
  format: string;
  ageCategory: string | null;
  maxTeams: number | null;
  startsAt: string | null;
  endsAt: string | null;
  venue: { name?: string; address?: string } | null;
  entryFeeCents: number;
  registrationClosesAt: string | null;
  websiteRegistrationOpensAt: string | null;
  appRegistrationOpensAt: string | null;
  isPublic: boolean;
  orgName: string;
};

// Not cached, same reason as lib/teams.ts — reads the session cookie
// (needed so RLS can apply per-caller), so it's dynamic by nature under
// Cache Components and must sit behind a Suspense boundary.
export async function getTournamentBySlug(
  orgSlug: string,
  tournamentSlug: string,
): Promise<TournamentDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tournaments")
    .select(
      `id, name, status, format, age_category, max_teams, starts_at, ends_at, venue,
       entry_fee_cents, registration_closes_at, website_registration_opens_at,
       app_registration_opens_at, is_public, organisations!inner(slug, name)`,
    )
    .eq("slug", tournamentSlug)
    .eq("organisations.slug", orgSlug)
    .maybeSingle();

  if (error || !data) return null;

  const org = Array.isArray(data.organisations)
    ? data.organisations[0]
    : data.organisations;

  return {
    id: data.id,
    name: data.name,
    status: data.status,
    format: data.format,
    ageCategory: data.age_category,
    maxTeams: data.max_teams,
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    venue: data.venue,
    entryFeeCents: data.entry_fee_cents,
    registrationClosesAt: data.registration_closes_at,
    websiteRegistrationOpensAt: data.website_registration_opens_at,
    appRegistrationOpensAt: data.app_registration_opens_at,
    isPublic: data.is_public,
    orgName: org?.name ?? "",
  };
}

export async function getRegistrationCount(tournamentId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("registrations")
    .select("id", { count: "exact", head: true })
    .eq("tournament_id", tournamentId)
    .in("status", ["pending", "reserved", "confirmed"]);
  return count ?? 0;
}

export async function getMyRegisteredTeamIds(tournamentId: string): Promise<Set<string>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("registrations")
    .select("team_id")
    .eq("tournament_id", tournamentId);
  return new Set((data ?? []).map((r) => r.team_id));
}

export type OrgTournamentSummary = { id: string; name: string; slug: string; status: string };

export async function listOrgTournaments(orgId: string): Promise<OrgTournamentSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tournaments")
    .select("id, name, slug, status")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

// A lighter view of a tournament for "copy settings from an existing
// tournament" on the create form — deliberately excludes dates and
// registration windows, which are expected to differ for a new edition
// (e.g. next year's Churches Cup), but carries over format/venue/fee/etc.
export type TournamentTemplate = {
  id: string;
  name: string;
  format: string;
  ageCategory: string;
  maxTeams: string;
  venueName: string;
  venueAddress: string;
  entryFee: string;
  isPublic: boolean;
};

export async function listOrgTournamentTemplates(orgId: string): Promise<TournamentTemplate[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tournaments")
    .select("id, name, format, age_category, max_teams, venue, entry_fee_cents, is_public")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  return (data ?? []).map((t) => {
    const venue = (t.venue as { name?: string; address?: string } | null) ?? {};
    return {
      id: t.id,
      name: t.name,
      format: t.format ?? "",
      ageCategory: t.age_category ?? "",
      maxTeams: t.max_teams != null ? String(t.max_teams) : "",
      venueName: venue.name ?? "",
      venueAddress: venue.address ?? "",
      entryFee: t.entry_fee_cents ? (t.entry_fee_cents / 100).toFixed(2) : "",
      isPublic: t.is_public,
    };
  });
}

export async function getOrgIdBySlug(orgSlug: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("organisations")
    .select("id")
    .eq("slug", orgSlug)
    .maybeSingle();
  return data?.id ?? null;
}

export type Competition = {
  id: string;
  name: string;
  format: string;
  advanceFromPositionStart: number | null;
  advanceFromPositionEnd: number | null;
  feederCompetitionId: string | null;
};
export type Pitch = { id: string; name: string; colour: string | null };

export type TournamentAdminView = TournamentDetail & {
  competitions: Competition[];
  pitches: Pitch[];
};

export async function getTournamentAdminView(
  orgSlug: string,
  tournamentSlug: string,
): Promise<TournamentAdminView | null> {
  const tournament = await getTournamentBySlug(orgSlug, tournamentSlug);
  if (!tournament) return null;

  const supabase = await createClient();
  const [competitions, pitches] = await Promise.all([
    supabase
      .from("competitions")
      .select("id, name, format, advance_from_position_start, advance_from_position_end, feeder_competition_id")
      .eq("tournament_id", tournament.id),
    supabase.from("pitches").select("id, name, colour").eq("tournament_id", tournament.id),
  ]);

  return {
    ...tournament,
    competitions: (competitions.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      format: c.format,
      advanceFromPositionStart: c.advance_from_position_start,
      advanceFromPositionEnd: c.advance_from_position_end,
      feederCompetitionId: c.feeder_competition_id,
    })),
    pitches: pitches.data ?? [],
  };
}

// Public tournament discovery (brief §12) — every org's public tournaments,
// most recently created first.
export type DiscoverableTournament = {
  id: string;
  name: string;
  slug: string;
  status: string;
  startsAt: string | null;
  orgName: string;
  orgSlug: string;
};

export async function listPublicTournaments(): Promise<DiscoverableTournament[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tournaments")
    .select("id, name, slug, status, starts_at, organisations!inner(slug, name)")
    .eq("is_public", true)
    .order("starts_at", { ascending: true, nullsFirst: false });

  if (error || !data) return [];

  return data.map((row) => {
    const org = Array.isArray(row.organisations) ? row.organisations[0] : row.organisations;
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      startsAt: row.starts_at,
      orgName: org?.name ?? "",
      orgSlug: org?.slug ?? "",
    };
  });
}
