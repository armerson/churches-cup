"use server";

import { createClient } from "@/lib/supabase/server";

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

  if (!Number.isFinite(score1) || !Number.isFinite(score2) || score1 < 0 || score2 < 0) {
    return { error: "Enter both scores.", success: false };
  }

  const supabase = await createClient();
  // All authorisation + "one score per fixture" enforcement happens
  // inside this function — see
  // supabase/migrations/20261127210000_score_functions.sql.
  const { error } = await supabase.rpc("submit_score", {
    p_fixture_id: fixtureId,
    p_score1: score1,
    p_score2: score2,
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
