"use client";

import { useActionState } from "react";
import { generateGroupFixtures, type FormState } from "../../actions";
import type { Competition } from "@/lib/tournaments";

const initialState: FormState = { error: null };

export function GenerateFixturesForm({
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
  const boundAction = generateGroupFixtures.bind(null, tournamentId, orgSlug, tournamentSlug);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  if (competitions.length === 0) {
    return <p className="text-xs text-zinc-500">Add a competition first.</p>;
  }

  return (
    <form action={formAction} className="flex items-end gap-2">
      <label className="flex flex-col gap-1 text-sm">
        Competition
        <select name="competitionId" required className="rounded border border-zinc-300 px-2 py-1">
          {competitions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Groups
        <input name="groupCount" type="number" min={1} defaultValue={1} className="w-16 rounded border border-zinc-300 px-2 py-1" />
      </label>
      <button type="submit" disabled={pending} className="rounded bg-zinc-900 px-3 py-1 text-sm text-white">
        {pending ? "Generating…" : "Generate round-robin fixtures"}
      </button>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
