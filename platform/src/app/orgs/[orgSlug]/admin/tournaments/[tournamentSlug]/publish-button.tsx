"use client";

import { openRegistration } from "../../actions";

export function PublishButton({
  orgSlug,
  tournamentSlug,
}: {
  orgSlug: string;
  tournamentSlug: string;
}) {
  const boundAction = openRegistration.bind(null, orgSlug, tournamentSlug);
  return (
    <form action={boundAction}>
      <button
        type="submit"
        className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white"
      >
        Open registration
      </button>
    </form>
  );
}
