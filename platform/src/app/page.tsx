import Link from "next/link";
import { Suspense } from "react";
import { getCurrentUser, getCurrentMemberships } from "@/lib/auth";
import { signOut } from "./(auth)/actions";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">ACF Tournaments</h1>
      <p className="max-w-md text-sm text-zinc-500">
        Multi-organisation tournament platform scaffold. Tournament features
        land in later slices.
      </p>
      {/* Session read — streams in behind this boundary, never blocks the shell. */}
      <Suspense fallback={<p className="text-sm text-zinc-400">Checking session…</p>}>
        <SessionPanel />
      </Suspense>
    </main>
  );
}

async function SessionPanel() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="flex gap-3">
        <Link href="/sign-in" className="underline">
          Sign in
        </Link>
        <Link href="/sign-up" className="underline">
          Sign up
        </Link>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <p className="text-sm">Signed in as {user.email}</p>
      <Suspense fallback={<p className="text-sm text-zinc-400">Loading your organisations…</p>}>
        <MembershipsList />
      </Suspense>
      <form action={signOut}>
        <button type="submit" className="text-sm underline">
          Sign out
        </button>
      </form>
    </div>
  );
}

async function MembershipsList() {
  const memberships = await getCurrentMemberships();

  if (memberships.length === 0) {
    return <p className="text-sm text-zinc-500">No organisation memberships yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-1 text-sm">
      {memberships.map((m) => (
        <li key={`${m.orgId}-${m.role}`}>
          {m.orgName} — {m.role}
        </li>
      ))}
    </ul>
  );
}
