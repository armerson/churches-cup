"use client";

import { startStripeOnboarding } from "./actions";

export function ConnectStripeButton({ orgSlug }: { orgSlug: string }) {
  const boundAction = startStripeOnboarding.bind(null, orgSlug);
  return (
    <form action={boundAction}>
      <button type="submit" className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white">
        Connect Stripe
      </button>
    </form>
  );
}
