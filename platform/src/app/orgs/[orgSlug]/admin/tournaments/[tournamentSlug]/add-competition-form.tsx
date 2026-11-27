"use client";

import { useActionState } from "react";
import { addCompetition, type FormState } from "../../actions";

const initialState: FormState = { error: null };

export function AddCompetitionForm({
  tournamentId,
  orgSlug,
  tournamentSlug,
}: {
  tournamentId: string;
  orgSlug: string;
  tournamentSlug: string;
}) {
  const boundAction = addCompetition.bind(null, tournamentId, orgSlug, tournamentSlug);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction} className="flex items-end gap-2">
      <label className="flex flex-col gap-1 text-sm">
        Competition
        <input name="name" type="text" placeholder="e.g. Championship" required className="rounded border border-zinc-300 px-2 py-1" />
      </label>
      <select name="format" defaultValue="knockout" className="rounded border border-zinc-300 px-2 py-1 text-sm">
        <option value="knockout">Knockout</option>
        <option value="round_robin">Round robin</option>
        <option value="groups_then_knockout">Groups then knockout</option>
      </select>
      <button type="submit" disabled={pending} className="rounded border border-zinc-300 px-2 py-1 text-sm">
        {pending ? "Adding…" : "Add"}
      </button>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
