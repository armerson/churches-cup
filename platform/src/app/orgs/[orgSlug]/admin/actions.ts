"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrgIdBySlug } from "@/lib/tournaments";
import { splitIntoGroups, generateRoundRobinFixtures } from "@/lib/scheduling";
import { persistGeneratedBracket } from "@/lib/bracket";
import { getFixtures } from "@/lib/fixtures";
import { allGroupsComplete, getGroupPositionEntrants } from "@/lib/progression";
import { isOrgAdmin } from "@/lib/orgs";

export type FormState = { error: string | null };

// Raw (unparsed) field values from a failed createTournament submission,
// so the form can redisplay exactly what was typed instead of losing it —
// see CreateTournamentFormState below.
export type TournamentFormValues = {
  name: string;
  format: string;
  ageCategory: string;
  isPublic: boolean;
  maxTeams: string;
  startsAt: string;
  endsAt: string;
  venueName: string;
  venueAddress: string;
  entryFee: string;
  registrationClosesAt: string;
  websiteRegistrationOpensAt: string;
  appRegistrationOpensAt: string;
};

export type CreateTournamentFormState = FormState & { values?: TournamentFormValues };

function tournamentFormValuesFrom(formData: FormData): TournamentFormValues {
  return {
    name: String(formData.get("name") ?? ""),
    format: String(formData.get("format") ?? ""),
    ageCategory: String(formData.get("ageCategory") ?? ""),
    isPublic: formData.get("isPublic") === "on",
    maxTeams: String(formData.get("maxTeams") ?? ""),
    startsAt: String(formData.get("startsAt") ?? ""),
    endsAt: String(formData.get("endsAt") ?? ""),
    venueName: String(formData.get("venueName") ?? ""),
    venueAddress: String(formData.get("venueAddress") ?? ""),
    entryFee: String(formData.get("entryFee") ?? ""),
    registrationClosesAt: String(formData.get("registrationClosesAt") ?? ""),
    websiteRegistrationOpensAt: String(formData.get("websiteRegistrationOpensAt") ?? ""),
    appRegistrationOpensAt: String(formData.get("appRegistrationOpensAt") ?? ""),
  };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toIntOrNull(raw: FormDataEntryValue | null): number | null {
  const str = String(raw ?? "").trim();
  if (!str) return null;
  const n = Number.parseInt(str, 10);
  return Number.isFinite(n) ? n : null;
}

function toDateOrNull(raw: FormDataEntryValue | null): string | null {
  const str = String(raw ?? "").trim();
  return str || null;
}

function toTimestampOrNull(raw: FormDataEntryValue | null): string | null {
  // <input type="datetime-local"> gives "2026-05-10T09:00" with no
  // timezone — Postgres's timestamptz column treats a bare string like
  // this as the server's local time, which is wrong; store it explicit.
  const str = String(raw ?? "").trim();
  if (!str) return null;
  return new Date(str).toISOString();
}

export async function createTournament(
  orgSlug: string,
  _prevState: CreateTournamentFormState,
  formData: FormData,
): Promise<CreateTournamentFormState> {
  const values = tournamentFormValuesFrom(formData);
  const name = String(formData.get("name") ?? "").trim();
  const format = String(formData.get("format") ?? "custom").trim();
  const ageCategory = String(formData.get("ageCategory") ?? "").trim() || null;
  const isPublic = formData.get("isPublic") === "on";
  const maxTeams = toIntOrNull(formData.get("maxTeams"));
  const startsAt = toDateOrNull(formData.get("startsAt"));
  const endsAt = toDateOrNull(formData.get("endsAt"));
  const venueName = String(formData.get("venueName") ?? "").trim();
  const venueAddress = String(formData.get("venueAddress") ?? "").trim();
  const entryFeePounds = String(formData.get("entryFee") ?? "").trim();
  const entryFeeCents = entryFeePounds ? Math.round(Number.parseFloat(entryFeePounds) * 100) : 0;
  const registrationClosesAt = toTimestampOrNull(formData.get("registrationClosesAt"));
  const websiteRegistrationOpensAt = toTimestampOrNull(formData.get("websiteRegistrationOpensAt"));
  const appRegistrationOpensAt = toTimestampOrNull(formData.get("appRegistrationOpensAt"));

  if (!name) {
    return { error: "Tournament name is required.", values };
  }
  if (!Number.isFinite(entryFeeCents) || entryFeeCents < 0) {
    return { error: "Entry fee must be a valid amount.", values };
  }

  const orgId = await getOrgIdBySlug(orgSlug);
  if (!orgId) {
    return { error: "Organisation not found.", values };
  }

  const slug = slugify(name);
  const venue = venueName || venueAddress ? { name: venueName, address: venueAddress } : {};

  // No permission check here — the tournaments INSERT policy already
  // requires org_admin/tournament_admin via has_org_role(); a non-admin's
  // insert is rejected by Postgres itself, not by this code.
  const supabase = await createClient();
  const { error } = await supabase.from("tournaments").insert({
    org_id: orgId,
    name,
    slug,
    format,
    age_category: ageCategory,
    max_teams: maxTeams,
    is_public: isPublic,
    starts_at: startsAt,
    ends_at: endsAt,
    venue,
    entry_fee_cents: entryFeeCents,
    registration_closes_at: registrationClosesAt,
    website_registration_opens_at: websiteRegistrationOpensAt,
    app_registration_opens_at: appRegistrationOpensAt,
  });

  if (error) {
    if (error.code === "23505") {
      return {
        error: `A tournament named "${name}" already exists for this organisation — change the name below and resubmit, or go to its existing admin page instead.`,
        values,
      };
    }
    return { error: error.message, values };
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
  const advanceFromPositionStart = toIntOrNull(formData.get("advanceFromPositionStart"));
  const advanceFromPositionEnd = toIntOrNull(formData.get("advanceFromPositionEnd"));
  const feederCompetitionId = String(formData.get("feederCompetitionId") ?? "").trim() || null;

  if (!name) {
    return { error: "Competition name is required." };
  }
  if ((advanceFromPositionStart == null) !== (advanceFromPositionEnd == null)) {
    return { error: "Give both a start and end group position, or neither." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("competitions").insert({
    tournament_id: tournamentId,
    name,
    format,
    advance_from_position_start: advanceFromPositionStart,
    advance_from_position_end: advanceFromPositionEnd,
    feeder_competition_id: feederCompetitionId,
  });

  if (error) {
    return { error: error.message };
  }

  redirect(`/orgs/${orgSlug}/admin/tournaments/${tournamentSlug}`);
}

const GROUP_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export async function generateGroupFixtures(
  tournamentId: string,
  orgSlug: string,
  tournamentSlug: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const competitionId = String(formData.get("competitionId") ?? "");
  const groupCountRaw = String(formData.get("groupCount") ?? "1");
  const groupCount = Math.max(1, Number.parseInt(groupCountRaw, 10) || 1);

  if (!competitionId) {
    return { error: "Choose a competition first." };
  }

  const supabase = await createClient();

  // No permission check here either — fixtures INSERT is gated by the
  // same administers_tournament() RLS policy as competitions/pitches.
  const { data: registrations, error: regError } = await supabase
    .from("registrations")
    .select("id")
    .eq("tournament_id", tournamentId)
    .eq("status", "confirmed");

  if (regError) {
    return { error: regError.message };
  }
  if (!registrations || registrations.length < 2) {
    return { error: "Need at least 2 confirmed registrations to generate fixtures." };
  }

  const groups = splitIntoGroups(
    registrations.map((r) => r.id as string),
    groupCount,
  );

  const allFixtures = (
    await Promise.all(
      groups.map((group, i) =>
        generateRoundRobinFixtures(GROUP_LETTERS[i] ?? String(i + 1), group),
      ),
    )
  ).flat();

  if (allFixtures.length === 0) {
    return { error: "No fixtures were generated (not enough teams per group)." };
  }

  const { error: insertError } = await supabase.from("fixtures").insert(
    allFixtures.map((f) => ({
      tournament_id: tournamentId,
      competition_id: competitionId,
      round: f.round,
      group_label: f.groupLabel,
      team1_registration_id: f.team1RegistrationId,
      team2_registration_id: f.team2RegistrationId,
    })),
  );

  if (insertError) {
    return { error: insertError.message };
  }

  redirect(`/orgs/${orgSlug}/admin/tournaments/${tournamentSlug}`);
}

export async function generateKnockoutFixtures(
  tournamentId: string,
  orgSlug: string,
  tournamentSlug: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const competitionId = String(formData.get("competitionId") ?? "");
  if (!competitionId) {
    return { error: "Choose a competition first." };
  }

  // Explicit re-check here, not just a UI gate: this action writes to
  // bracket_stages via the service-role client below, which bypasses RLS
  // entirely, so it must verify authorisation itself rather than relying
  // on a policy to reject an unauthorised caller.
  if (!(await isOrgAdmin(orgSlug))) {
    return { error: "Not authorised." };
  }

  const supabase = await createClient();
  const { data: competition, error: compError } = await supabase
    .from("competitions")
    .select("name, advance_from_position_start, advance_from_position_end, feeder_competition_id")
    .eq("id", competitionId)
    .maybeSingle();
  if (compError || !competition) {
    return { error: "Competition not found." };
  }

  // A feeder-fed competition (Shield taking Championship's round-1
  // losers) generates itself automatically — see
  // lib/bracket.ts's maybeAutoGenerateFeederCompetitions(), triggered from
  // advanceBracket() once the feeder's round 1 is fully confirmed. There's
  // nothing for a manual click to do here.
  if (competition.feeder_competition_id) {
    return {
      error:
        "This competition fills automatically once its feeder competition's first round is confirmed — it can't be generated manually.",
    };
  }

  let registrationIds: string[];
  if (competition.advance_from_position_start != null && competition.advance_from_position_end != null) {
    const fixtures = await getFixtures(tournamentId);
    if (!allGroupsComplete(fixtures)) {
      return { error: "Not every group has finished its round-robin yet." };
    }
    registrationIds = getGroupPositionEntrants(
      fixtures,
      competition.advance_from_position_start,
      competition.advance_from_position_end,
    );
  } else {
    const { data: registrations, error: regError } = await supabase
      .from("registrations")
      .select("id")
      .eq("tournament_id", tournamentId)
      .eq("status", "confirmed");
    if (regError) {
      return { error: regError.message };
    }
    registrationIds = (registrations ?? []).map((r) => r.id as string);
  }

  if (registrationIds.length < 2) {
    return { error: "Need at least 2 teams to generate a bracket." };
  }

  const { error } = await persistGeneratedBracket(
    tournamentId,
    competitionId,
    competition.name,
    registrationIds,
  );
  if (error) {
    return { error };
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
