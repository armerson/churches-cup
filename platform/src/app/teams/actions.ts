"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type TeamActionState = { error: string | null };

export async function createTeam(
  _prevState: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const contactName = String(formData.get("contactName") ?? "").trim();
  const contactEmail = String(formData.get("contactEmail") ?? "").trim();
  const contactPhone = String(formData.get("contactPhone") ?? "").trim();

  if (!name) {
    return { error: "Team name is required." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be signed in to create a team." };
  }

  const { data: team, error } = await supabase
    .from("teams")
    .insert({ name, created_by: user.id })
    .select("id")
    .single();

  if (error || !team) {
    return { error: error?.message ?? "Could not create team." };
  }

  if (contactName || contactEmail || contactPhone) {
    await supabase.from("team_contacts").insert({
      team_id: team.id,
      contact_name: contactName || null,
      contact_email: contactEmail || null,
      contact_phone: contactPhone || null,
    });
  }

  redirect("/teams");
}

export type RegisterActionState = { error: string | null; status: string | null };

export async function registerTeamForTournament(
  _prevState: RegisterActionState,
  formData: FormData,
): Promise<RegisterActionState> {
  const tournamentId = String(formData.get("tournamentId") ?? "");
  const teamId = String(formData.get("teamId") ?? "");

  if (!tournamentId || !teamId) {
    return { error: "Choose a team to register.", status: null };
  }

  const supabase = await createClient();
  // All the real enforcement (auth window, capacity, duplicate check,
  // manages_team authorisation) happens atomically inside this one
  // function — see supabase/migrations/20261127200000_register_team_function.sql.
  const { data, error } = await supabase.rpc("register_team_for_tournament", {
    p_tournament_id: tournamentId,
    p_team_id: teamId,
    p_channel: "website",
  });

  if (error) {
    return { error: error.message, status: null };
  }

  return { error: null, status: (data as { status?: string } | null)?.status ?? null };
}
