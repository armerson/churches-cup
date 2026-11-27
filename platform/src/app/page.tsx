import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">ACF Tournaments — platform scaffold</h1>
      <p className="max-w-md text-sm text-zinc-500">
        Next.js + Supabase scaffold. Schema, auth, and tournament features land in
        later slices.
      </p>
      {/* Session read — streams in behind this boundary, never blocks the shell. */}
      <Suspense fallback={<p className="text-sm text-zinc-400">Checking session…</p>}>
        <SessionStatus />
      </Suspense>
    </main>
  );
}

async function SessionStatus() {
  const user = await getCurrentUser();
  return (
    <p className="text-sm">
      {user ? `Signed in as ${user.email}` : "Not signed in"}
    </p>
  );
}
