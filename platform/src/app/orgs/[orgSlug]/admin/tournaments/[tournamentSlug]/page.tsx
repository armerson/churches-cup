import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { isOrgAdmin } from "@/lib/orgs";
import { getTournamentAdminView } from "@/lib/tournaments";
import { AddCompetitionForm } from "./add-competition-form";
import { DeleteCompetitionButton } from "./delete-competition-button";
import { AddPitchForm } from "./add-pitch-form";
import { PublishButton } from "./publish-button";
import { GenerateFixturesForm } from "./generate-fixtures-form";
import { GenerateKnockoutForm } from "./generate-knockout-form";
import { PreviewSetupForm } from "./preview-setup-form";

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
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{tournament.name}</h1>
        <p className="text-sm text-zinc-500">
          Status: {tournament.status.replace("_", " ")} · {tournament.isPublic ? "Public" : "Private"}
          {tournament.maxTeams ? ` · ${tournament.maxTeams} team cap` : ""}
          {tournament.ageCategory ? ` · ${tournament.ageCategory}` : ""}
        </p>
        {(tournament.startsAt || tournament.endsAt) && (
          <p className="text-sm text-zinc-500">
            {tournament.startsAt}
            {tournament.endsAt && tournament.endsAt !== tournament.startsAt ? ` – ${tournament.endsAt}` : ""}
          </p>
        )}
        {(tournament.venue?.name || tournament.venue?.address) && (
          <p className="text-sm text-zinc-500">
            {[tournament.venue?.name, tournament.venue?.address].filter(Boolean).join(", ")}
          </p>
        )}
        <p className="text-sm text-zinc-500">
          Entry fee: {tournament.entryFeeCents > 0 ? `£${(tournament.entryFeeCents / 100).toFixed(2)}` : "Free"}
        </p>
        {tournament.registrationClosesAt && (
          <p className="text-sm text-zinc-500">
            Registration closes: {new Date(tournament.registrationClosesAt).toLocaleString()}
          </p>
        )}
        {tournament.websiteRegistrationOpensAt && (
          <p className="text-sm text-zinc-500">
            Website registration opens: {new Date(tournament.websiteRegistrationOpensAt).toLocaleString()}
          </p>
        )}
        {tournament.appRegistrationOpensAt && (
          <p className="text-sm text-zinc-500">
            App-exclusive registration opens: {new Date(tournament.appRegistrationOpensAt).toLocaleString()}
          </p>
        )}
      </div>

      {tournament.status === "draft" && (
        <PublishButton orgSlug={orgSlug} tournamentSlug={tournamentSlug} />
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Competitions</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {tournament.competitions.map((c) => {
            const feeder = tournament.competitions.find((other) => other.id === c.feederCompetitionId);
            return (
              <li key={c.id} className="flex items-center justify-between gap-2">
                <span>
                  {c.name} ({c.format.replace(/_/g, " ")})
                  {c.advanceFromPositionStart != null && (
                    <span className="text-zinc-500">
                      {" "}
                      · group pos. {c.advanceFromPositionStart}
                      {c.advanceFromPositionEnd !== c.advanceFromPositionStart
                        ? `–${c.advanceFromPositionEnd}`
                        : ""}
                    </span>
                  )}
                  {feeder && <span className="text-zinc-500"> · + {feeder.name} round-1 losers</span>}
                </span>
                <DeleteCompetitionButton
                  tournamentId={tournament.id}
                  orgSlug={orgSlug}
                  tournamentSlug={tournamentSlug}
                  competitionId={c.id}
                  competitionName={c.name}
                />
              </li>
            );
          })}
          {tournament.competitions.length === 0 && (
            <li className="text-zinc-500">No competitions yet.</li>
          )}
        </ul>
        <AddCompetitionForm
          tournamentId={tournament.id}
          orgSlug={orgSlug}
          tournamentSlug={tournamentSlug}
          competitions={tournament.competitions}
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

      <PreviewSetupForm tournamentId={tournament.id} orgSlug={orgSlug} tournamentSlug={tournamentSlug} />

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Fixtures</h2>
        <GenerateFixturesForm
          tournamentId={tournament.id}
          orgSlug={orgSlug}
          tournamentSlug={tournamentSlug}
          competitions={tournament.competitions}
        />
        <GenerateKnockoutForm
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
