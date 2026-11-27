import "server-only";
import { createClient } from "./supabase/server";

export type FixtureScore = {
  score1: number | null;
  score2: number | null;
  status: "pending" | "confirmed" | "disputed";
  submittedBy: string | null;
};

export type FixtureWithTeams = {
  id: string;
  round: string | null;
  groupLabel: string | null;
  team1Name: string;
  team2Name: string;
  // Null for a knockout fixture whose opponent isn't decided yet — the
  // feeder match(es) haven't been played/confirmed. Shown as "TBD".
  team1RegistrationId: string | null;
  team2RegistrationId: string | null;
  team1TeamId: string | null;
  team2TeamId: string | null;
  score: FixtureScore | null;
};

// Not cached — reads the session cookie, must sit behind Suspense.
export async function getFixtures(tournamentId: string): Promise<FixtureWithTeams[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fixtures")
    .select(
      `id, round, group_label,
       team1:registrations!fixtures_team1_registration_id_fkey(id, team_id, team:teams(name)),
       team2:registrations!fixtures_team2_registration_id_fkey(id, team_id, team:teams(name)),
       scores(score1, score2, status, submitted_by)`,
    )
    .eq("tournament_id", tournamentId)
    .order("group_label", { ascending: true })
    .order("round", { ascending: true });

  if (error || !data) return [];

  return data
    .map((row) => {
      const team1 = Array.isArray(row.team1) ? row.team1[0] : row.team1;
      const team2 = Array.isArray(row.team2) ? row.team2[0] : row.team2;
      const team1Info = Array.isArray(team1?.team) ? team1.team[0] : team1?.team;
      const team2Info = Array.isArray(team2?.team) ? team2.team[0] : team2?.team;
      const scoreRow = Array.isArray(row.scores) ? row.scores[0] : row.scores;

      return {
        id: row.id,
        round: row.round,
        groupLabel: row.group_label,
        team1Name: team1Info?.name ?? "TBD",
        team2Name: team2Info?.name ?? "TBD",
        team1RegistrationId: team1?.id ?? null,
        team2RegistrationId: team2?.id ?? null,
        team1TeamId: team1?.team_id ?? null,
        team2TeamId: team2?.team_id ?? null,
        score: scoreRow
          ? {
              score1: scoreRow.score1,
              score2: scoreRow.score2,
              status: scoreRow.status,
              submittedBy: scoreRow.submitted_by,
            }
          : null,
      };
    });
}

export type StandingsRow = {
  teamName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
};

// Standings are computed on read from confirmed scores, not stored —
// same approach as churches-cup's calcStandings, now driven by real
// relational data instead of a hand-maintained JS object.
export function calculateStandings(
  fixtures: FixtureWithTeams[],
  groupLabel?: string | null,
): StandingsRow[] {
  const table = new Map<string, StandingsRow>();

  const relevant = groupLabel
    ? fixtures.filter((f) => f.groupLabel === groupLabel)
    : fixtures;

  function ensure(name: string): StandingsRow {
    let row = table.get(name);
    if (!row) {
      row = { teamName: name, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
      table.set(name, row);
    }
    return row;
  }

  for (const f of relevant) {
    if (!f.score || f.score.status !== "confirmed") continue;
    const { score1, score2 } = f.score;
    if (score1 == null || score2 == null) continue;

    const t1 = ensure(f.team1Name);
    const t2 = ensure(f.team2Name);

    t1.played += 1;
    t2.played += 1;
    t1.goalsFor += score1;
    t1.goalsAgainst += score2;
    t2.goalsFor += score2;
    t2.goalsAgainst += score1;

    if (score1 > score2) {
      t1.won += 1;
      t1.points += 3;
      t2.lost += 1;
    } else if (score2 > score1) {
      t2.won += 1;
      t2.points += 3;
      t1.lost += 1;
    } else {
      t1.drawn += 1;
      t2.drawn += 1;
      t1.points += 1;
      t2.points += 1;
    }
  }

  return [...table.values()].sort(
    (a, b) => b.points - a.points || b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst),
  );
}
