import Link from "next/link";
import { Suspense } from "react";
import { getMyTeams } from "@/lib/teams";

export default function TeamsPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">My teams</h1>
        <Link href="/teams/new" className="text-sm underline">
          + New team
        </Link>
      </div>
      <Suspense fallback={<p className="text-sm text-zinc-400">Loading…</p>}>
        <TeamsList />
      </Suspense>
    </main>
  );
}

async function TeamsList() {
  const teams = await getMyTeams();

  if (teams.length === 0) {
    return <p className="text-sm text-zinc-500">You don&rsquo;t manage any teams yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {teams.map((team) => (
        <li key={team.id} className="rounded border border-zinc-200 px-3 py-2 text-sm">
          {team.name}
        </li>
      ))}
    </ul>
  );
}
