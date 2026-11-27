import Link from "next/link";
import { Suspense } from "react";
import { listPublicTournaments } from "@/lib/tournaments";

export default function TournamentsIndexPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-8">
      <h1 className="text-xl font-semibold">Tournaments</h1>
      <Suspense fallback={<p className="text-sm text-zinc-400">Loading…</p>}>
        <TournamentsList />
      </Suspense>
    </main>
  );
}

async function TournamentsList() {
  const tournaments = await listPublicTournaments();

  if (tournaments.length === 0) {
    return <p className="text-sm text-zinc-500">No public tournaments yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {tournaments.map((t) => (
        <li key={t.id}>
          <Link
            href={`/tournaments/${t.orgSlug}/${t.slug}`}
            className="block rounded border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50"
          >
            <span className="font-medium">{t.name}</span>
            <span className="block text-xs text-zinc-500">
              {t.orgName} · {t.status.replace("_", " ")}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
