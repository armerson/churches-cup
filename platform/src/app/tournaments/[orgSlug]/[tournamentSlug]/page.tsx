import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  getTournamentBySlug,
  getRegistrationCount,
  getMyRegisteredTeamIds,
} from "@/lib/tournaments";
import { getMyTeams } from "@/lib/teams";
import { RegisterForm } from "./register-form";

type Props = { params: Promise<{ orgSlug: string; tournamentSlug: string }> };

export default function TournamentPage({ params }: Props) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-8">
      {/* `params` and every read below it are request-time under Cache
          Components, so the whole lookup sits behind one boundary. */}
      <Suspense fallback={<p className="text-sm text-zinc-400">Loading tournament…</p>}>
        <TournamentContent params={params} />
      </Suspense>
    </main>
  );
}

async function TournamentContent({ params }: Props) {
  const { orgSlug, tournamentSlug } = await params;
  const tournament = await getTournamentBySlug(orgSlug, tournamentSlug);

  if (!tournament) {
    notFound();
  }

  return (
    <>
      <p className="text-sm text-zinc-500">{tournament.orgName}</p>
      <h1 className="text-2xl font-semibold">{tournament.name}</h1>
      <p className="text-sm text-zinc-500">
        Status: {tournament.status.replace("_", " ")}
        {tournament.maxTeams ? ` · ${tournament.maxTeams} team cap` : ""}
      </p>
      <Link href={`/tournaments/${orgSlug}/${tournamentSlug}/fixtures`} className="text-sm underline">
        Fixtures &amp; standings
      </Link>

      {/* Nested boundary: the session-dependent registration state can
          resolve independently of (and later than) the tournament info
          above it. */}
      <Suspense fallback={<p className="text-sm text-zinc-400">Loading registration…</p>}>
        <RegistrationPanel tournamentId={tournament.id} status={tournament.status} />
      </Suspense>
    </>
  );
}

async function RegistrationPanel({
  tournamentId,
  status,
}: {
  tournamentId: string;
  status: string;
}) {
  const [count, myTeams, registeredTeamIds] = await Promise.all([
    getRegistrationCount(tournamentId),
    getMyTeams(),
    getMyRegisteredTeamIds(tournamentId),
  ]);

  const availableTeams = myTeams.filter((t) => !registeredTeamIds.has(t.id));

  if (status !== "registration_open") {
    return <p className="text-sm text-zinc-500">Registration is not currently open.</p>;
  }

  if (myTeams.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        You need a team before you can register — create one from the Teams page.
      </p>
    );
  }

  if (availableTeams.length === 0) {
    return <p className="text-sm text-zinc-500">All your teams are already registered.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-zinc-500">{count} teams registered so far.</p>
      <RegisterForm tournamentId={tournamentId} teams={availableTeams} />
    </div>
  );
}
