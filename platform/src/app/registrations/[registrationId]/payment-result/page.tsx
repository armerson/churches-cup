import { Suspense } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type Props = {
  params: Promise<{ registrationId: string }>;
  searchParams: Promise<{ status?: string }>;
};

export default function PaymentResultPage({ params, searchParams }: Props) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-3 p-8 text-center">
      <Suspense fallback={<p className="text-sm text-zinc-400">Checking payment…</p>}>
        <Result params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Result({ params, searchParams }: Props) {
  const { registrationId } = await params;
  const { status: redirectStatus } = await searchParams;

  const supabase = await createClient();
  const { data: registration } = await supabase
    .from("registrations")
    .select("status")
    .eq("id", registrationId)
    .maybeSingle();

  if (!registration) notFound();

  if (registration.status === "confirmed") {
    return (
      <>
        <h1 className="text-xl font-semibold">Payment received</h1>
        <p className="text-sm text-zinc-500">Your registration is confirmed.</p>
      </>
    );
  }

  if (redirectStatus === "cancelled") {
    return (
      <>
        <h1 className="text-xl font-semibold">Payment cancelled</h1>
        <p className="text-sm text-zinc-500">
          Your spot is still reserved for a little while — you can try paying again from your
          team&rsquo;s registration.
        </p>
      </>
    );
  }

  // Stripe's webhook can take a few seconds to arrive after the browser
  // redirect — this isn't necessarily a failure, just not confirmed yet.
  return (
    <>
      <h1 className="text-xl font-semibold">Processing payment…</h1>
      <p className="text-sm text-zinc-500">
        This can take a few seconds. Refresh this page shortly if it doesn&rsquo;t update.
      </p>
    </>
  );
}
