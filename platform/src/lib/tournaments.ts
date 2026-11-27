import "server-only";
import { createClient } from "./supabase/server";

export type TournamentDetail = {
  id: string;
  name: string;
  status: string;
  maxTeams: number | null;
  registrationClosesAt: string | null;
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
      "id, name, status, max_teams, registration_closes_at, is_public, organisations!inner(slug, name)",
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
    maxTeams: data.max_teams,
    registrationClosesAt: data.registration_closes_at,
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
