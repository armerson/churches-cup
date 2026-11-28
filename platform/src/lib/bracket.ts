import "server-only";
import { BracketsManager } from "brackets-manager";
import { InMemoryDatabase } from "brackets-memory-db";
import type { Database, Table } from "brackets-model";
import { createAdminClient } from "./supabase/admin";
import { getFixtures } from "./fixtures";
import { allGroupsComplete, getGroupPositionEntrants } from "./progression";

const TABLES: Table[] = ["participant", "stage", "group", "round", "match", "match_game"];

// InMemoryDatabase's `data` field is protected at the type level (even
// though nothing stops reaching into it at runtime) — snapshot/restore go
// through its public select()/setData() API instead, one call per table.
async function snapshotDatabase(storage: InMemoryDatabase): Promise<Database> {
  const entries = await Promise.all(
    TABLES.map(async (table) => [table, (await storage.select(table)) ?? []] as const),
  );
  return Object.fromEntries(entries) as Database;
}

// Single elimination only for now — double elimination's winner/loser
// bracket crossover and grand-final-reset logic hasn't been verified
// against the real library the way everything else in this file has, and
// getting that wrong would silently misroute real fixtures. Deferred
// deliberately, not an oversight.
export type BracketType = "single_elimination";

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function roundLabel(roundNumber: number, totalRounds: number): string {
  const fromEnd = totalRounds - roundNumber;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semi-final";
  if (fromEnd === 2) return "Quarter-final";
  const teamsInRound = 2 ** (fromEnd + 1);
  return `Round of ${teamsInRound}`;
}

export type GeneratedBracketFixture = {
  bracketMatchId: number;
  round: string;
  team1RegistrationId: string | null;
  team2RegistrationId: string | null;
};

// Generates a knockout bracket in an ephemeral in-memory brackets-manager
// instance, then discards that instance — only the resulting snapshot
// (returned here, for the caller to persist in bracket_stages) and the
// extracted fixture rows matter afterwards. Participant ids are assigned
// 0..N-1 strictly in seeding order (verified against the real library —
// see the round-robin generator's commit for the same check), so
// registrationIds[i] is always participant id i; `null` entries pad the
// seeding to the power of two the library requires for BYEs.
export async function generateKnockoutBracket(
  competitionName: string,
  registrationIds: string[],
): Promise<{
  data: Database;
  participantMap: (string | null)[];
  fixtures: GeneratedBracketFixture[];
}> {
  const size = nextPowerOfTwo(registrationIds.length);
  const seeding: (string | null)[] = [...registrationIds];
  while (seeding.length < size) seeding.push(null);

  const storage = new InMemoryDatabase();
  const manager = new BracketsManager(storage);

  await manager.create.stage({
    tournamentId: 1,
    name: competitionName,
    type: "single_elimination",
    seeding,
    settings: { seedOrdering: ["natural"], balanceByes: true },
  });

  const data = await snapshotDatabase(storage);
  return { data, participantMap: seeding, fixtures: extractFixtures(data, seeding) };
}

function extractFixtures(
  data: Database,
  participantMap: (string | null)[],
): GeneratedBracketFixture[] {
  const totalRounds = data.round.length;
  return data.match.map((m) => {
    const round = data.round.find((r) => r.id === m.round_id);
    return {
      bracketMatchId: m.id as number,
      round: round ? roundLabel(round.number, totalRounds) : "Unknown round",
      team1RegistrationId:
        m.opponent1?.id != null ? (participantMap[m.opponent1.id as number] ?? null) : null,
      team2RegistrationId:
        m.opponent2?.id != null ? (participantMap[m.opponent2.id as number] ?? null) : null,
    };
  });
}

// Shared by the admin "generate knockout bracket" action and the
// feeder-competition auto-generation below — writes a freshly generated
// bracket's bracket_stages row and fixtures, via the service-role client
// (bracket_stages has no authenticated-role write policy at all; see
// AGENTS.md). Idempotent: does nothing if this competition already has a
// bracket_stages row, so a feeder trigger firing more than once (e.g. two
// round-1 results confirmed close together) can't double-generate it.
export async function persistGeneratedBracket(
  tournamentId: string,
  competitionId: string,
  competitionName: string,
  registrationIds: string[],
): Promise<{ error: string | null }> {
  if (registrationIds.length < 2) return { error: null };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("bracket_stages")
    .select("competition_id")
    .eq("competition_id", competitionId)
    .maybeSingle();
  if (existing) return { error: null };

  const { data, participantMap, fixtures } = await generateKnockoutBracket(
    competitionName,
    registrationIds,
  );

  const { error: stageError } = await admin
    .from("bracket_stages")
    .insert({ competition_id: competitionId, participant_map: participantMap, data });
  if (stageError) return { error: stageError.message };

  const { error: insertError } = await admin.from("fixtures").insert(
    fixtures.map((f) => ({
      tournament_id: tournamentId,
      competition_id: competitionId,
      round: f.round,
      bracket_match_id: f.bracketMatchId,
      team1_registration_id: f.team1RegistrationId,
      team2_registration_id: f.team2RegistrationId,
    })),
  );
  return { error: insertError?.message ?? null };
}

// Round 1 is identified structurally (round.number === 1 within the
// bracket's own stored data), not by the human-readable round label
// (which depends on bracket size — "Round of 16" vs "Quarter-final") —
// see roundLabel() above for why those two things differ.
// "Complete" means every round-1 match has a decided win/loss result
// recorded (advanceBracket only ever writes a decisive result — see its
// level-score guard — so a recorded result always has a real loser,
// except a bye, which has no opponent at all and is skipped).
function getRoundOneLosers(
  data: Database,
  participantMap: (string | null)[],
): { complete: boolean; loserRegistrationIds: string[] } {
  const round = data.round.find((r) => r.number === 1);
  if (!round) return { complete: false, loserRegistrationIds: [] };

  const matches = data.match.filter((m) => m.round_id === round.id);
  if (matches.length === 0) return { complete: false, loserRegistrationIds: [] };

  const losers: string[] = [];
  for (const m of matches) {
    const r1 = m.opponent1?.result;
    const r2 = m.opponent2?.result;
    if (r1 !== "loss" && r2 !== "loss") {
      return { complete: false, loserRegistrationIds: [] };
    }
    const loserOpponent = r1 === "loss" ? m.opponent1 : m.opponent2;
    if (loserOpponent?.id == null) continue; // a bye — no real loser to feed onward
    const regId = participantMap[loserOpponent.id as number];
    if (regId) losers.push(regId);
  }
  return { complete: true, loserRegistrationIds: losers };
}

// Called at the end of advanceBracket, every time a bracket's state
// changes — checks whether any OTHER competition declares this one as
// its feeder_competition_id (Shield <- Championship) and, once this
// competition's round 1 is fully confirmed, generates that dependent
// competition's bracket from its own group-position entrants (if any)
// plus this round's losers. Idempotent via persistGeneratedBracket, and
// a no-op for the common case of no dependents.
async function maybeAutoGenerateFeederCompetitions(
  feederCompetitionId: string,
  feederData: Database,
  feederParticipantMap: (string | null)[],
): Promise<void> {
  const admin = createAdminClient();
  const { data: dependents } = await admin
    .from("competitions")
    .select("id, name, tournament_id, advance_from_position_start, advance_from_position_end")
    .eq("feeder_competition_id", feederCompetitionId);

  if (!dependents || dependents.length === 0) return;

  const { complete, loserRegistrationIds } = getRoundOneLosers(feederData, feederParticipantMap);
  if (!complete) return;

  for (const dep of dependents) {
    let directEntrants: string[] = [];
    if (dep.advance_from_position_start != null && dep.advance_from_position_end != null) {
      const fixtures = await getFixtures(dep.tournament_id, admin);
      if (!allGroupsComplete(fixtures)) continue; // groups not finished — retry on the next trigger
      directEntrants = getGroupPositionEntrants(
        fixtures,
        dep.advance_from_position_start,
        dep.advance_from_position_end,
      );
    }
    await persistGeneratedBracket(dep.tournament_id, dep.id, dep.name, [
      ...directEntrants,
      ...loserRegistrationIds,
    ]);
  }
}

// Called only from the fixtures confirmScore action, only after
// resolve_score() has already confirmed the result through the normal
// RLS-respecting client — this function's use of the service-role client
// is the trusted consequence of that already-authorized state change, not
// a standalone attacker-reachable entry point. Does nothing (silently) if
// the fixture isn't part of a knockout bracket.
export async function advanceBracket(fixtureId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: fixture } = await admin
    .from("fixtures")
    .select("competition_id, bracket_match_id")
    .eq("id", fixtureId)
    .maybeSingle();

  if (!fixture?.competition_id || fixture.bracket_match_id == null) return;

  const { data: score } = await admin
    .from("scores")
    .select("score1, score2, pen_score1, pen_score2, status")
    .eq("fixture_id", fixtureId)
    .maybeSingle();

  if (!score || score.status !== "confirmed" || score.score1 == null || score.score2 == null) {
    return;
  }

  const { data: stageRow } = await admin
    .from("bracket_stages")
    .select("data, participant_map")
    .eq("competition_id", fixture.competition_id)
    .maybeSingle();

  if (!stageRow) return;

  const storage = new InMemoryDatabase();
  storage.setData(stageRow.data as Database);
  const manager = new BracketsManager(storage);

  const levelOnScore = score.score1 === score.score2;
  const penaltiesLevel = (score.pen_score1 ?? 0) === (score.pen_score2 ?? 0);
  if (levelOnScore && penaltiesLevel) {
    // A knockout match can't end level with no decider recorded — the
    // score is still confirmed (see resolve_score), but refuse to guess a
    // winner rather than silently advancing the wrong team. Known gap: an
    // admin directly editing the score afterwards to add a penalty result
    // doesn't currently re-trigger this function — that direct-edit path
    // would need to call advanceBracket too to actually propagate the
    // winner. Not built yet; flagging rather than leaving it implicit.
    return;
  }
  const team1Wins = levelOnScore
    ? (score.pen_score1 ?? 0) > (score.pen_score2 ?? 0)
    : score.score1 > score.score2;

  await manager.update.match({
    id: fixture.bracket_match_id,
    opponent1: { score: score.score1, result: team1Wins ? "win" : "loss" },
    opponent2: { score: score.score2, result: team1Wins ? "loss" : "win" },
  });

  const newData = await snapshotDatabase(storage);
  const participantMap = stageRow.participant_map as (string | null)[];

  await admin
    .from("bracket_stages")
    .update({ data: newData, updated_at: new Date().toISOString() })
    .eq("competition_id", fixture.competition_id);

  // Re-sync every match's current opponents into fixtures. A plain loop
  // of per-row updates is fine at the bracket sizes this app deals with in
  // Phase 1, and avoids separately tracking exactly which matches changed.
  for (const m of newData.match) {
    const team1 = m.opponent1?.id != null ? (participantMap[m.opponent1.id as number] ?? null) : null;
    const team2 = m.opponent2?.id != null ? (participantMap[m.opponent2.id as number] ?? null) : null;
    await admin
      .from("fixtures")
      .update({ team1_registration_id: team1, team2_registration_id: team2 })
      .eq("competition_id", fixture.competition_id)
      .eq("bracket_match_id", m.id as number);
  }

  await maybeAutoGenerateFeederCompetitions(fixture.competition_id, newData, participantMap);
}
