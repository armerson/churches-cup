import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTournamentBySlug } from "@/lib/tournaments";
import { getFixtures, calculateStandings } from "@/lib/fixtures";
import { getMyTeams } from "@/lib/teams";
import { FixtureControls } from "./fixture-controls";

type Props = { params: Promise<{ orgSlug: string; tournamentSlug: string }> };

export default function FixturesPage({ params }: Props) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <Suspense fallback={<p className="text-sm text-zinc-400">Loading fixtures…</p>}>
        <FixturesContent params={params} />
      </Suspense>
    </main>
  );
}

async function FixturesContent({ params }: Props) {
  const { orgSlug, tournamentSlug } = await params;
  const tournament = await getTournamentBySlug(orgSlug, tournamentSlug);
  if (!tournament) notFound();

  const [fixtures, myTeams] = await Promise.all([
    getFixtures(tournament.id),
    getMyTeams(),
  ]);
  const myTeamIds = new Set(myTeams.map((t) => t.id));

  const groupLabels = [...new Set(fixtures.map((f) => f.groupLabel).filter(Boolean))] as string[];

  return (
    <>
      <h1 className="text-2xl font-semibold">{tournament.name} — Fixtures</h1>

      {groupLabels.length === 0 && fixtures.length === 0 && (
        <p className="text-sm text-zinc-500">No fixtures generated yet.</p>
      )}

      {groupLabels.map((group) => {
        const groupFixtures = fixtures.filter((f) => f.groupLabel === group);
        const standings = calculateStandings(fixtures, group);

        return (
          <section key={group} className="flex flex-col gap-3">
            <h2 className="font-medium">Group {group}</h2>

            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-zinc-500">
                  <th className="pr-2">Team</th>
                  <th className="px-1 text-center">P</th>
                  <th className="px-1 text-center">W</th>
                  <th className="px-1 text-center">D</th>
                  <th className="px-1 text-center">L</th>
                  <th className="px-1 text-center">GF</th>
                  <th className="px-1 text-center">GA</th>
                  <th className="px-1 text-center">Pts</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((row) => (
                  <tr key={row.teamName}>
                    <td className="pr-2">{row.teamName}</td>
                    <td className="px-1 text-center">{row.played}</td>
                    <td className="px-1 text-center">{row.won}</td>
                    <td className="px-1 text-center">{row.drawn}</td>
                    <td className="px-1 text-center">{row.lost}</td>
                    <td className="px-1 text-center">{row.goalsFor}</td>
                    <td className="px-1 text-center">{row.goalsAgainst}</td>
                    <td className="px-1 text-center font-medium">{row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="flex flex-col gap-2">
              {groupFixtures.map((f) => {
                const canAct =
                  (f.team1TeamId != null && myTeamIds.has(f.team1TeamId)) ||
                  (f.team2TeamId != null && myTeamIds.has(f.team2TeamId));
                return (
                  <li
                    key={f.id}
                    className="flex flex-col gap-1 rounded border border-zinc-200 px-3 py-2 text-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span>
                        {f.team1Name} vs {f.team2Name}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {f.score
                          ? `${f.score.score1}-${f.score.score2} (${f.score.status})`
                          : "Not played"}
                      </span>
                    </div>
                    <FixtureControls fixture={f} canAct={canAct} />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}
