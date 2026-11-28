import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { isOrgAdmin } from "@/lib/orgs";
import { createClient } from "@/lib/supabase/server";
import { getOrgIdBySlug, listOrgTournaments } from "@/lib/tournaments";
import { ConnectStripeButton } from "./stripe/connect-stripe-button";

type Props = { params: Promise<{ orgSlug: string }> };

export default function OrgAdminPage({ params }: Props) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-8">
      <Suspense fallback={<p className="text-sm text-zinc-400">Loading…</p>}>
        <OrgAdminContent params={params} />
      </Suspense>
    </main>
  );
}

async function OrgAdminContent({ params }: Props) {
  const { orgSlug } = await params;
  const allowed = await isOrgAdmin(orgSlug);
  if (!allowed) notFound();

  const orgId = await getOrgIdBySlug(orgSlug);
  if (!orgId) notFound();

  const supabase = await createClient();
  const [{ data: org }, tournaments] = await Promise.all([
    supabase
      .from("organisations")
      .select("name, stripe_account_id, stripe_onboarding_complete")
      .eq("id", orgId)
      .maybeSingle(),
    listOrgTournaments(orgId),
  ]);

  return (
    <>
      <h1 className="text-2xl font-semibold">{org?.name}</h1>

      <section className="flex flex-col gap-2 rounded border border-zinc-200 p-4">
        <h2 className="font-medium">Payments</h2>
        {org?.stripe_onboarding_complete ? (
          <p className="text-sm text-green-700">
            Stripe connected — this organisation can accept entry fees.
          </p>
        ) : (
          <>
            <p className="text-sm text-zinc-500">
              {org?.stripe_account_id
                ? "Stripe onboarding started but not finished yet."
                : "Not connected to Stripe yet — entry fees can't be collected until this is set up."}
            </p>
            <ConnectStripeButton orgSlug={orgSlug} />
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Tournaments</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {tournaments.map((t) => (
            <li key={t.id}>
              <Link href={`/orgs/${orgSlug}/admin/tournaments/${t.slug}`} className="underline">
                {t.name}
              </Link>
              <span className="text-zinc-500"> · {t.status.replace("_", " ")}</span>
            </li>
          ))}
          {tournaments.length === 0 && <li className="text-zinc-500">No tournaments yet.</li>}
        </ul>
        <Link href={`/orgs/${orgSlug}/admin/tournaments/new`} className="text-sm underline">
          + New tournament
        </Link>
      </section>
    </>
  );
}
