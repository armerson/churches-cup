"use server";

import { createClient } from "@/lib/supabase/server";
import { advanceBracket } from "@/lib/bracket";

export type ScoreActionState = { error: string | null; success: boolean };

const initialState: ScoreActionState = { error: null, success: false };
export { initialState as initialScoreActionState };

export async function submitScore(
  fixtureId: string,
  _prevState: ScoreActionState,
  formData: FormData,
): Promise<ScoreActionState> {
  const score1 = Number.parseInt(String(formData.get("score1") ?? ""), 10);
  const score2 = Number.parseInt(String(formData.get("score2") ?? ""), 10);
  const penRaw1 = String(formData.get("penScore1") ?? "").trim();
  const penRaw2 = String(formData.get("penScore2") ?? "").trim();
  const penScore1 = penRaw1 ? Number.parseInt(penRaw1, 10) : null;
  const penScore2 = penRaw2 ? Number.parseInt(penRaw2, 10) : null;

  if (!Number.isFinite(score1) || !Number.isFinite(score2) || score1 < 0 || score2 < 0) {
    return { error: "Enter both scores.", success: false };
  }

  const supabase = await createClient();

  // A draw is a normal, scoreable result in a round-robin group match —
  // only a knockout fixture (one tied to a bracket match) needs a
  // decisive winner to be able to advance.
  if (score1 === score2 && penScore1 === penScore2) {
    const { data: fixture } = await supabase
      .from("fixtures")
      .select("bracket_match_id")
      .eq("id", fixtureId)
      .maybeSingle();
    if (fixture?.bracket_match_id != null) {
      return {
        error: "Scores are level — enter a penalty shootout result to decide a winner.",
        success: false,
      };
    }
  }

  // All authorisation + "one score per fixture" enforcement happens
  // inside this function — see
  // supabase/migrations/20261127210000_score_functions.sql and
  // 20261127230000_submit_score_penalties.sql.
  const { error } = await supabase.rpc("submit_score", {
    p_fixture_id: fixtureId,
    p_score1: score1,
    p_score2: score2,
    p_pen_score1: penScore1,
    p_pen_score2: penScore2,
  });

  if (error) {
    return { error: error.message, success: false };
  }
  return { error: null, success: true };
}

export async function confirmScore(
  fixtureId: string,
  _prevState: ScoreActionState,
  _formData: FormData,
): Promise<ScoreActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_score", {
    p_fixture_id: fixtureId,
    p_status: "confirmed",
  });
  if (error) {
    return { error: error.message, success: false };
  }

  // Only runs the bracket-sync logic (and its service-role writes) as the
  // trusted consequence of the RLS-checked confirm above succeeding — see
  // lib/bracket.ts. A no-op for round-robin fixtures (no bracket_match_id).
  await advanceBracket(fixtureId);

  return { error: null, success: true };
}

export async function disputeScore(
  fixtureId: string,
  _prevState: ScoreActionState,
  formData: FormData,
): Promise<ScoreActionState> {
  const note = String(formData.get("note") ?? "").trim();
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_score", {
    p_fixture_id: fixtureId,
    p_status: "disputed",
    p_dispute_note: note || null,
  });
  if (error) {
    return { error: error.message, success: false };
  }
  return { error: null, success: true };
}
