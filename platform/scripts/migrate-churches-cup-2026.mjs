#!/usr/bin/env node
// One-time historical migration: brings the 2026 Churches Cup tournament
// — its 32 teams, 8 groups, full schedule, and (when live data is
// reachable) every submitted score and knockout result — into the new
// platform schema as a completed tournament under the Ambassadors
// organisation. Non-destructive: never writes back to the live
// churches-cup app or its Google Sheet, only reads from it and inserts
// into the new Supabase project.
//
// Usage:
//   node scripts/migrate-churches-cup-2026.mjs --dry-run [--tournament-date=2026-11-07]
//   node scripts/migrate-churches-cup-2026.mjs --apply [--tournament-date=2026-11-07]
//
// --dry-run (the default if neither flag is given) builds the full
// migration plan and prints/saves it as JSON without touching any
// database — safe to run with no credentials at all.
//
// --apply requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// to be set (the same service-role key used elsewhere in this app — see
// lib/supabase/admin.ts) and actually writes. It refuses to run if a
// tournament with the target slug already exists, since this is meant to
// run exactly once, not as a repeatable sync.
//
// --tournament-date sets the calendar date (YYYY-MM-DD) the kickoff
// times in the static schedule apply to. The old app never recorded this
// anywhere machine-readable, so it has to be supplied by hand; without
// it, fixtures are inserted with scheduled_at left null rather than a
// guessed date.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { extractStaticTournamentData } from "./lib/extract-static-data.mjs";
import { fetchLiveTournamentData } from "./lib/fetch-live-data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const INDEX_HTML_PATH = join(REPO_ROOT, "index.html");

const ORG_SLUG = "ambassadors";
const TOURNAMENT_SLUG = "churches-cup-2026";
const TOURNAMENT_NAME = "Churches Cup 2026";

const PITCH_LABELS = { orange: "Orange Pitch", blue: "Blue Pitch", yellow: "Yellow Pitch", red: "Red Pitch" };
const COMPETITION_NAMES = { c: "Championship", s: "Shield", p: "Plate" };

function parseArgs(argv) {
  const apply = argv.includes("--apply");
  const dateArg = argv.find((a) => a.startsWith("--tournament-date="));
  const tournamentDate = dateArg ? dateArg.split("=")[1] : null;
  return { apply, tournamentDate };
}

function pitchColourForGroup(pitches, groupLabel) {
  for (const [colour, groupLabels] of Object.entries(pitches)) {
    if (groupLabels.includes(groupLabel)) return colour;
  }
  return null;
}

function competitionKeyForMatchId(matchId) {
  // Match ids are "<comp>-<round>-<num>" or "<comp>-final", e.g.
  // "c-r16-1", "s-final" — the prefix before the first "-" is the
  // competition (see koSchedule/koPitchAssignment in index.html).
  const prefix = matchId.split("-")[0];
  return COMPETITION_NAMES[prefix] ? prefix : null;
}

function roundLabelFromMatchId(matchId) {
  // "c-r16-3" -> "r16", "c-final" -> "final", "s-qf-2" -> "qf"
  const parts = matchId.split("-");
  return parts.length === 3 ? parts[1] : parts[1] ?? "final";
}

function timeToTimestamp(tournamentDate, time) {
  if (!tournamentDate || !time) return null;
  return `${tournamentDate}T${time}:00`;
}

function buildMigrationPlan({ staticData, liveData, tournamentDate }) {
  const { groups, groupSchedule, groupPitch, koSchedule, pitches, koPitchAssignment } = staticData;

  const teamNames = [...new Set(Object.values(groups).flat())];

  const pitchRows = Object.entries(PITCH_LABELS).map(([colour, name]) => ({ colour, name }));

  const competitionNames = [...new Set(Object.keys(koPitchAssignment).map(competitionKeyForMatchId))].filter(Boolean);
  const competitionRows = [
    { key: "group", name: "Group Stage", format: "round_robin" },
    ...competitionNames.map((key) => ({ key, name: COMPETITION_NAMES[key], format: "knockout" })),
  ];

  const groupLabelByTeam = {};
  for (const [label, teams] of Object.entries(groups)) {
    for (const team of teams) groupLabelByTeam[team] = label;
  }

  const groupFixtures = Object.entries(groupSchedule).map(([pairKey, time]) => {
    const [team1, team2] = pairKey.split("||");
    const groupLabel = groupLabelByTeam[team1];
    return {
      competitionKey: "group",
      round: "Group Stage",
      groupLabel,
      pitchColour: groupPitch[pairKey] ?? pitchColourForGroup(pitches, groupLabel),
      team1,
      team2,
      scheduledAt: timeToTimestamp(tournamentDate, time),
      // Matches a live `scores` row by (team1,team2) unordered pair,
      // same convention the old app itself used (see
      // index.html's scheduleKey = [t1,t2].sort().join('||')).
      liveScoreKey: [team1, team2].sort().join("||"),
    };
  });

  const koFixtures = Object.entries(koSchedule).map(([matchId, time]) => ({
    matchId,
    competitionKey: competitionKeyForMatchId(matchId),
    round: roundLabelFromMatchId(matchId),
    groupLabel: null,
    pitchColour: koPitchAssignment[matchId] ?? null,
    scheduledAt: timeToTimestamp(tournamentDate, time),
  }));

  // Live data fills in: actual group scores (matched by team pair),
  // actual KO team assignments + results (matched by matchId — these
  // aren't knowable from static data at all, since knockout pairings
  // depend on live group standings).
  const liveScoresByKey = new Map(
    (liveData?.scores ?? []).map((s) => [[s.team1, s.team2].sort().join("||"), s]),
  );
  const liveKoByMatchId = new Map((liveData?.ko ?? []).map((m) => [String(m.matchId), m]));

  for (const fixture of groupFixtures) {
    fixture.liveScore = liveScoresByKey.get(fixture.liveScoreKey) ?? null;
  }
  for (const fixture of koFixtures) {
    fixture.live = liveKoByMatchId.get(fixture.matchId) ?? null;
  }

  const unmatchedLiveKo = (liveData?.ko ?? []).filter((m) => !koFixtures.some((f) => f.matchId === String(m.matchId)));

  return {
    tournament: {
      slug: TOURNAMENT_SLUG,
      name: TOURNAMENT_NAME,
      format: "churches_cup",
      status: "completed",
      is_public: true,
      entry_fee_cents: 0,
    },
    pitches: pitchRows,
    competitions: competitionRows,
    teams: teamNames,
    groupFixtures,
    koFixtures,
    rosters: liveData?.rosters ?? {},
    notices: liveData?.notices ?? [],
    scheduleOverrides: liveData?.schedule ?? {},
    warnings: [
      ...(tournamentDate ? [] : ["No --tournament-date given: fixtures will be inserted with scheduled_at = null."]),
      ...(liveData ? [] : ["Live data unreachable: migrating structure only — no scores, KO results, rosters, or notices."]),
      ...(unmatchedLiveKo.length
        ? [`${unmatchedLiveKo.length} live KO match(es) had no matching entry in the static koSchedule — check these by hand: ${unmatchedLiveKo.map((m) => m.matchId).join(", ")}`]
        : []),
    ],
  };
}

async function applyMigrationPlan(plan) {
  const { createClient } = await import("@supabase/supabase-js");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to --apply.");
  }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data: org, error: orgError } = await supabase
    .from("organisations")
    .select("id")
    .eq("slug", ORG_SLUG)
    .maybeSingle();
  if (orgError || !org) {
    throw new Error(`Could not find the "${ORG_SLUG}" organisation — has the core schema migration been applied?`);
  }

  const { data: existing } = await supabase
    .from("tournaments")
    .select("id")
    .eq("org_id", org.id)
    .eq("slug", plan.tournament.slug)
    .maybeSingle();
  if (existing) {
    throw new Error(
      `A tournament with slug "${plan.tournament.slug}" already exists (id ${existing.id}) — this script is meant to run once. Remove it first if you really want to re-run this.`,
    );
  }

  const { data: tournament, error: tError } = await supabase
    .from("tournaments")
    .insert({ ...plan.tournament, org_id: org.id })
    .select("id")
    .single();
  if (tError) throw tError;
  const tournamentId = tournament.id;

  const { data: pitchRows, error: pError } = await supabase
    .from("pitches")
    .insert(plan.pitches.map((p) => ({ tournament_id: tournamentId, name: p.name, colour: p.colour })))
    .select("id, colour");
  if (pError) throw pError;
  const pitchIdByColour = new Map(pitchRows.map((p) => [p.colour, p.id]));

  const { data: competitionRows, error: cError } = await supabase
    .from("competitions")
    .insert(plan.competitions.map((c) => ({ tournament_id: tournamentId, name: c.name, format: c.format })))
    .select("id, name");
  if (cError) throw cError;
  const competitionIdByKey = new Map(
    plan.competitions.map((c) => [c.key, competitionRows.find((r) => r.name === c.name).id]),
  );

  const { data: teamRows, error: teamError } = await supabase
    .from("teams")
    .insert(plan.teams.map((name) => ({ name })))
    .select("id, name");
  if (teamError) throw teamError;
  const teamIdByName = new Map(teamRows.map((t) => [t.name, t.id]));

  const { data: registrationRows, error: regError } = await supabase
    .from("registrations")
    .insert(
      plan.teams.map((name) => ({
        tournament_id: tournamentId,
        team_id: teamIdByName.get(name),
        status: "confirmed",
      })),
    )
    .select("id, team_id");
  if (regError) throw regError;
  const registrationIdByTeamId = new Map(registrationRows.map((r) => [r.team_id, r.id]));
  const registrationIdByTeamName = new Map(plan.teams.map((name) => [name, registrationIdByTeamId.get(teamIdByName.get(name))]));

  const fixtureInserts = [];
  for (const f of plan.groupFixtures) {
    fixtureInserts.push({
      tournament_id: tournamentId,
      competition_id: competitionIdByKey.get(f.competitionKey),
      round: f.round,
      group_label: f.groupLabel,
      pitch_id: f.pitchColour ? pitchIdByColour.get(f.pitchColour) : null,
      team1_registration_id: registrationIdByTeamName.get(f.team1),
      team2_registration_id: registrationIdByTeamName.get(f.team2),
      scheduled_at: f.scheduledAt,
      status: f.liveScore ? "completed" : "scheduled",
      _liveScore: f.liveScore,
    });
  }
  for (const f of plan.koFixtures) {
    fixtureInserts.push({
      tournament_id: tournamentId,
      competition_id: f.competitionKey ? competitionIdByKey.get(f.competitionKey) : null,
      round: f.round,
      group_label: null,
      pitch_id: f.pitchColour ? pitchIdByColour.get(f.pitchColour) : null,
      team1_registration_id: f.live?.team1 ? registrationIdByTeamName.get(f.live.team1) ?? null : null,
      team2_registration_id: f.live?.team2 ? registrationIdByTeamName.get(f.live.team2) ?? null : null,
      scheduled_at: f.scheduledAt,
      status: f.live?.winner ? "completed" : "scheduled",
      _liveScore: f.live,
    });
  }

  const { data: insertedFixtures, error: fError } = await supabase
    .from("fixtures")
    .insert(fixtureInserts.map(({ _liveScore, ...row }) => row))
    .select("id, tournament_id, round, group_label, team1_registration_id, team2_registration_id");
  if (fError) throw fError;

  // Preserve the live status rather than blanket-marking everything
  // confirmed — a real 'disputed' score in the old system shouldn't
  // silently become "confirmed" history just because the tournament is
  // over. Only defaults to 'confirmed' when the live row predates that
  // field existing at all (Code.gs added `status` after `scorers2`/
  // `disputeNote`, so some historical rows may not have one).
  const VALID_SCORE_STATUSES = new Set(["pending", "confirmed", "disputed"]);
  const scoreInserts = [];
  insertedFixtures.forEach((fixtureRow, i) => {
    const live = fixtureInserts[i]._liveScore;
    if (!live) return;
    const isKo = "winner" in live;
    const status = VALID_SCORE_STATUSES.has(live.status) ? live.status : "confirmed";
    scoreInserts.push({
      fixture_id: fixtureRow.id,
      score1: live.score1 ?? null,
      score2: live.score2 ?? null,
      pen_score1: isKo ? (live.penScore1 || null) : null,
      pen_score2: isKo ? (live.penScore2 || null) : null,
      scorers1: isKo ? (live.scorers1 ?? []) : (live.scorers ?? []),
      scorers2: live.scorers2 ?? [],
      dispute_note: live.disputeNote || null,
      status,
    });
  });

  if (scoreInserts.length > 0) {
    const { error: sError } = await supabase.from("scores").insert(scoreInserts);
    if (sError) throw sError;
  }

  const rosterInserts = [];
  for (const [teamName, players] of Object.entries(plan.rosters)) {
    const registrationId = registrationIdByTeamName.get(teamName);
    if (!registrationId) continue; // roster for a team not in this tournament's group data — skip rather than guess
    for (const playerName of players) {
      rosterInserts.push({ registration_id: registrationId, player_name: playerName });
    }
  }
  if (rosterInserts.length > 0) {
    const { error: rosterError } = await supabase.from("rosters").insert(rosterInserts);
    if (rosterError) throw rosterError;
  }

  const noticeInserts = plan.notices.map((n) => ({
    tournament_id: tournamentId,
    message: n.message,
    created_at: n.timestamp || undefined,
  }));
  if (noticeInserts.length > 0) {
    const { error: noticeError } = await supabase.from("notices").insert(noticeInserts);
    if (noticeError) throw noticeError;
  }

  return {
    tournamentId,
    teamsInserted: teamRows.length,
    fixturesInserted: insertedFixtures.length,
    rostersInserted: rosterInserts.length,
    noticesInserted: noticeInserts.length,
    scoresInserted: scoreInserts.length,
  };
}

async function main() {
  const { apply, tournamentDate } = parseArgs(process.argv.slice(2));

  const staticData = extractStaticTournamentData(INDEX_HTML_PATH);

  let liveData = null;
  try {
    liveData = await fetchLiveTournamentData();
  } catch (err) {
    console.warn(`Could not reach the live churches-cup backend (${err.message}) — continuing with structure only.`);
  }

  const plan = buildMigrationPlan({ staticData, liveData, tournamentDate });

  console.log(`Teams: ${plan.teams.length}`);
  console.log(`Group-stage fixtures: ${plan.groupFixtures.length}`);
  console.log(`Knockout fixtures: ${plan.koFixtures.length}`);
  console.log(
    `Fixtures with a live result: ${
      plan.groupFixtures.filter((f) => f.liveScore).length + plan.koFixtures.filter((f) => f.live).length
    }`,
  );
  for (const w of plan.warnings) console.warn(`WARNING: ${w}`);

  if (!apply) {
    const outPath = join(__dirname, "migration-plan.dry-run.json");
    writeFileSync(outPath, JSON.stringify(plan, null, 2));
    console.log(`\nDry run only — nothing written. Full plan saved to ${outPath}`);
    return;
  }

  console.log("\nApplying migration...");
  const result = await applyMigrationPlan(plan);
  console.log(`Done. Tournament id: ${result.tournamentId}`);
  console.log(
    `Teams: ${result.teamsInserted}, fixtures: ${result.fixturesInserted}, scores: ${result.scoresInserted}, rosters: ${result.rostersInserted}, notices: ${result.noticesInserted}`,
  );
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
