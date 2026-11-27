"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createCheckoutForRegistration } from "@/lib/payments";

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

export type RegisterActionState = {
  error: string | null;
  status: string | null;
  checkoutUrl: string | null;
};

export async function registerTeamForTournament(
  _prevState: RegisterActionState,
  formData: FormData,
): Promise<RegisterActionState> {
  const tournamentId = String(formData.get("tournamentId") ?? "");
  const teamId = String(formData.get("teamId") ?? "");

  if (!tournamentId || !teamId) {
    return { error: "Choose a team to register.", status: null, checkoutUrl: null };
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
    return { error: error.message, status: null, checkoutUrl: null };
  }

  const registration = data as { id: string; status: string } | null;
  if (!registration) {
    return { error: "Registration failed.", status: null, checkoutUrl: null };
  }

  if (registration.status !== "pending") {
    // Waitlisted — nothing to pay yet, no further action needed.
    return { error: null, status: registration.status, checkoutUrl: null };
  }

  const { data: tournament } = await supabase
    .from("tournaments")
    .select("entry_fee_cents")
    .eq("id", tournamentId)
    .maybeSingle();

  if (!tournament || tournament.entry_fee_cents <= 0) {
    // Free tournament — nothing to pay, so 'pending' is already the
    // successful terminal state; confirm immediately rather than leaving
    // it stuck behind a payment step that doesn't apply. Goes through a
    // function, not a direct update — see
    // 20261127250000_tighten_registration_updates.sql for why a plain
    // client-side update can't be trusted to self-confirm.
    const { error: confirmError } = await supabase.rpc("confirm_free_registration", {
      p_registration_id: registration.id,
    });
    if (confirmError) {
      return { error: confirmError.message, status: registration.status, checkoutUrl: null };
    }
    return { error: null, status: "confirmed", checkoutUrl: null };
  }

  const checkout = await createCheckoutForRegistration(registration.id, tournamentId);
  if (checkout.error) {
    return { error: checkout.error, status: registration.status, checkoutUrl: null };
  }

  return { error: null, status: "reserved", checkoutUrl: checkout.checkoutUrl };
}
