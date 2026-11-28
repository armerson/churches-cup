import "server-only";
import { calculateStandings, type FixtureWithTeams } from "./fixtures";

export type GroupStandings = { groupLabel: string; rows: ReturnType<typeof calculateStandings> };

export function calculateStandingsByGroup(fixtures: FixtureWithTeams[]): GroupStandings[] {
  const groupLabels = [
    ...new Set(fixtures.map((f) => f.groupLabel).filter((g): g is string => g != null)),
  ];
  return groupLabels.map((groupLabel) => ({
    groupLabel,
    rows: calculateStandings(fixtures, groupLabel),
  }));
}

// True once every group's round-robin is fully played: every team in a
// group has a `played` count equal to (group size - 1). Used to gate
// group-position-based seeding (Championship/Plate/Shield's direct
// portion) — generating from a position before every group has actually
// reached it would seed from a still-moving table.
export function allGroupsComplete(fixtures: FixtureWithTeams[]): boolean {
  const byGroup = calculateStandingsByGroup(fixtures);
  if (byGroup.length === 0) return false;
  return byGroup.every(
    ({ rows }) => rows.length >= 2 && rows.every((r) => r.played === rows.length - 1),
  );
}

// Registrations finishing at group positions [positionStart, positionEnd]
// (1-indexed, inclusive) across every group — e.g. (1, 2) for "top 2 per
// group" feeds Championship, (4, 4) for "bottom team" feeds Plate. Caller
// should check allGroupsComplete() first; a group whose table hasn't
// reached `positionEnd` rows yet simply contributes nothing here.
export function getGroupPositionEntrants(
  fixtures: FixtureWithTeams[],
  positionStart: number,
  positionEnd: number,
): string[] {
  const byGroup = calculateStandingsByGroup(fixtures);
  const entrants: string[] = [];
  for (const { rows } of byGroup) {
    for (let pos = positionStart; pos <= positionEnd; pos++) {
      const row = rows[pos - 1];
      if (row?.registrationId) entrants.push(row.registrationId);
    }
  }
  return entrants;
}
