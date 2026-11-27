"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrgIdBySlug } from "@/lib/tournaments";

export type FormState = { error: string | null };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createTournament(
  orgSlug: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const name = String(formData.get("name") ?? "").trim();
  const format = String(formData.get("format") ?? "custom").trim();
  const maxTeamsRaw = String(formData.get("maxTeams") ?? "").trim();
  const isPublic = formData.get("isPublic") === "on";

  if (!name) {
    return { error: "Tournament name is required." };
  }

  const orgId = await getOrgIdBySlug(orgSlug);
  if (!orgId) {
    return { error: "Organisation not found." };
  }

  const slug = slugify(name);
  const maxTeams = maxTeamsRaw ? Number.parseInt(maxTeamsRaw, 10) : null;

  // No permission check here — the tournaments INSERT policy already
  // requires org_admin/tournament_admin via has_org_role(); a non-admin's
  // insert is rejected by Postgres itself, not by this code.
  const supabase = await createClient();
  const { error } = await supabase.from("tournaments").insert({
    org_id: orgId,
    name,
    slug,
    format,
    max_teams: Number.isFinite(maxTeams) ? maxTeams : null,
    is_public: isPublic,
  });

  if (error) {
    return { error: error.message };
  }

  redirect(`/orgs/${orgSlug}/admin/tournaments/${slug}`);
}

export async function openRegistration(orgSlug: string, tournamentSlug: string) {
  const supabase = await createClient();
  await supabase
    .from("tournaments")
    .update({ status: "registration_open" })
    .eq("slug", tournamentSlug);
  redirect(`/orgs/${orgSlug}/admin/tournaments/${tournamentSlug}`);
}

export async function addCompetition(
  tournamentId: string,
  orgSlug: string,
  tournamentSlug: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const name = String(formData.get("name") ?? "").trim();
  const format = String(formData.get("format") ?? "knockout");

  if (!name) {
    return { error: "Competition name is required." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("competitions")
    .insert({ tournament_id: tournamentId, name, format });

  if (error) {
    return { error: error.message };
  }

  redirect(`/orgs/${orgSlug}/admin/tournaments/${tournamentSlug}`);
}

export async function addPitch(
  tournamentId: string,
  orgSlug: string,
  tournamentSlug: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const name = String(formData.get("name") ?? "").trim();
  const colour = String(formData.get("colour") ?? "").trim();

  if (!name) {
    return { error: "Pitch name is required." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("pitches")
    .insert({ tournament_id: tournamentId, name, colour: colour || null });

  if (error) {
    return { error: error.message };
  }

  redirect(`/orgs/${orgSlug}/admin/tournaments/${tournamentSlug}`);
}
