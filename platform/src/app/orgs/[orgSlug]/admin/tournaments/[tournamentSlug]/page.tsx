import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { isOrgAdmin } from "@/lib/orgs";
import { getTournamentAdminView } from "@/lib/tournaments";
import { AddCompetitionForm } from "./add-competition-form";
import { AddPitchForm } from "./add-pitch-form";
import { PublishButton } from "./publish-button";
import { GenerateFixturesForm } from "./generate-fixtures-form";

type Props = { params: Promise<{ orgSlug: string; tournamentSlug: string }> };

export default function TournamentAdminPage({ params }: Props) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 p-8">
      <Suspense fallback={<p className="text-sm text-zinc-400">Loading…</p>}>
        <AdminContent params={params} />
      </Suspense>
    </main>
  );
}

async function AdminContent({ params }: Props) {
  const { orgSlug, tournamentSlug } = await params;
  const allowed = await isOrgAdmin(orgSlug);
  if (!allowed) {
    notFound();
  }

  const tournament = await getTournamentAdminView(orgSlug, tournamentSlug);
  if (!tournament) {
    notFound();
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">{tournament.name}</h1>
        <p className="text-sm text-zinc-500">
          Status: {tournament.status.replace("_", " ")} · {tournament.isPublic ? "Public" : "Private"}
          {tournament.maxTeams ? ` · ${tournament.maxTeams} team cap` : ""}
        </p>
      </div>

      {tournament.status === "draft" && (
        <PublishButton orgSlug={orgSlug} tournamentSlug={tournamentSlug} />
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Competitions</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {tournament.competitions.map((c) => (
            <li key={c.id}>
              {c.name} ({c.format.replace(/_/g, " ")})
            </li>
          ))}
          {tournament.competitions.length === 0 && (
            <li className="text-zinc-500">No competitions yet.</li>
          )}
        </ul>
        <AddCompetitionForm
          tournamentId={tournament.id}
          orgSlug={orgSlug}
          tournamentSlug={tournamentSlug}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Pitches</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {tournament.pitches.map((p) => (
            <li key={p.id}>
              {p.name}
              {p.colour ? ` (${p.colour})` : ""}
            </li>
          ))}
          {tournament.pitches.length === 0 && <li className="text-zinc-500">No pitches yet.</li>}
        </ul>
        <AddPitchForm
          tournamentId={tournament.id}
          orgSlug={orgSlug}
          tournamentSlug={tournamentSlug}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Fixtures</h2>
        <GenerateFixturesForm
          tournamentId={tournament.id}
          orgSlug={orgSlug}
          tournamentSlug={tournamentSlug}
          competitions={tournament.competitions}
        />
        <Link
          href={`/tournaments/${orgSlug}/${tournamentSlug}/fixtures`}
          className="text-sm underline"
        >
          View fixtures &amp; standings
        </Link>
      </section>
    </>
  );
}
