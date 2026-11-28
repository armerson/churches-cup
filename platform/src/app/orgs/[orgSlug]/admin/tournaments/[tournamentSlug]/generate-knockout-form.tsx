"use client";

import { useActionState } from "react";
import { generateKnockoutFixtures, type FormState } from "../../actions";
import type { Competition } from "@/lib/tournaments";

const initialState: FormState = { error: null };

export function GenerateKnockoutForm({
  tournamentId,
  orgSlug,
  tournamentSlug,
  competitions,
}: {
  tournamentId: string;
  orgSlug: string;
  tournamentSlug: string;
  competitions: Competition[];
}) {
  const boundAction = generateKnockoutFixtures.bind(null, tournamentId, orgSlug, tournamentSlug);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  // Feeder-fed competitions (Shield taking another competition's round-1
  // losers) generate themselves automatically once that round is
  // confirmed — see lib/bracket.ts — so there's nothing for this manual
  // button to do for them.
  const manuallyGeneratable = competitions.filter((c) => !c.feederCompetitionId);

  if (manuallyGeneratable.length === 0) {
    return (
      <p className="text-xs text-zinc-500">
        {competitions.length === 0
          ? "Add a competition first."
          : "All competitions here fill automatically from a feeder competition."}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex items-end gap-2">
      <label className="flex flex-col gap-1 text-sm">
        Competition
        <select name="competitionId" required className="rounded border border-zinc-300 px-2 py-1">
          {manuallyGeneratable.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.advanceFromPositionStart != null
                ? ` (group pos. ${c.advanceFromPositionStart}–${c.advanceFromPositionEnd})`
                : ""}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending} className="rounded bg-zinc-900 px-3 py-1 text-sm text-white">
        {pending ? "Generating…" : "Generate knockout bracket"}
      </button>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
