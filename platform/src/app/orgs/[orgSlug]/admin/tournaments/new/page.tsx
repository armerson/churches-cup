import { notFound } from "next/navigation";
import { Suspense } from "react";
import { isOrgAdmin } from "@/lib/orgs";
import { NewTournamentForm } from "./new-tournament-form";

type Props = { params: Promise<{ orgSlug: string }> };

export default function NewTournamentPage({ params }: Props) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <Suspense fallback={<p className="text-sm text-zinc-400">Loading…</p>}>
        <Gate params={params} />
      </Suspense>
    </main>
  );
}

async function Gate({ params }: Props) {
  const { orgSlug } = await params;
  const allowed = await isOrgAdmin(orgSlug);
  if (!allowed) {
    notFound();
  }

  return (
    <>
      <h1 className="text-xl font-semibold">New tournament</h1>
      <NewTournamentForm orgSlug={orgSlug} />
    </>
  );
}
