import "server-only";
import { BracketsManager } from "brackets-manager";
import { InMemoryDatabase } from "brackets-memory-db";
import type { Match } from "brackets-model";

export type GeneratedFixture = {
  groupLabel: string;
  round: string;
  team1RegistrationId: string;
  team2RegistrationId: string;
};

// Splits registrations into `groupCount` groups by simple round-robin
// distribution (index i -> group i % groupCount). Doesn't attempt the
// brief's "avoid same-club teams in one group" refinement — a known,
// explicitly deferred simplification, not an oversight.
export function splitIntoGroups<T>(items: T[], groupCount: number): T[][] {
  const groups: T[][] = Array.from({ length: groupCount }, () => []);
  items.forEach((item, i) => groups[i % groupCount].push(item));
  return groups;
}

// Generates a complete round-robin schedule for one group of teams.
// brackets-manager only works with integer participant ids; it assigns
// them 0..N-1 strictly in the order the seeding array is given (verified
// against the real library, not assumed — see the commit message), so
// registrationIds[i] is always participant id i. Every match in a
// round-robin stage is immediately known at creation (no dependency on
// another match's result, unlike a knockout bracket), so this can write
// real, playable fixtures straight away.
export async function generateRoundRobinFixtures(
  groupLabel: string,
  registrationIds: string[],
): Promise<GeneratedFixture[]> {
  if (registrationIds.length < 2) return [];

  const storage = new InMemoryDatabase();
  const manager = new BracketsManager(storage);

  await manager.create.stage({
    tournamentId: 1,
    name: `Group ${groupLabel}`,
    type: "round_robin",
    seeding: registrationIds,
    settings: { groupCount: 1 },
  });

  const matches = (await storage.select("match")) as Match[] | null;
  if (!matches) return [];

  return matches
    .filter((m) => m.opponent1?.id != null && m.opponent2?.id != null)
    .map((m) => ({
      groupLabel,
      round: `group-round-${Number(m.round_id) + 1}`,
      team1RegistrationId: registrationIds[m.opponent1!.id as number],
      team2RegistrationId: registrationIds[m.opponent2!.id as number],
    }));
}
