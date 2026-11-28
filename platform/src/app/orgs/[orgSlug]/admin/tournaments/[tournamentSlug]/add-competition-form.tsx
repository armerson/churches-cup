"use client";

import { useActionState } from "react";
import { addCompetition, type FormState } from "../../actions";
import type { Competition } from "@/lib/tournaments";

const initialState: FormState = { error: null };

export function AddCompetitionForm({
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
  const boundAction = addCompetition.bind(null, tournamentId, orgSlug, tournamentSlug);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Competition
          <input
            name="name"
            type="text"
            placeholder="e.g. Championship"
            required
            className="rounded border border-zinc-300 px-2 py-1"
          />
        </label>
        <select name="format" defaultValue="knockout" className="rounded border border-zinc-300 px-2 py-1 text-sm">
          <option value="knockout">Knockout</option>
          <option value="round_robin">Round robin</option>
          <option value="groups_then_knockout">Groups then knockout</option>
        </select>
      </div>

      <div className="flex items-end gap-2 text-sm">
        <label className="flex flex-col gap-1">
          Seed from group position
          <input
            name="advanceFromPositionStart"
            type="number"
            min={1}
            placeholder="start (e.g. 1)"
            className="w-32 rounded border border-zinc-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          to
          <input
            name="advanceFromPositionEnd"
            type="number"
            min={1}
            placeholder="end (e.g. 2)"
            className="w-32 rounded border border-zinc-300 px-2 py-1"
          />
        </label>
        <span className="pb-1 text-xs text-zinc-400">
          Leave both blank to seed from all confirmed registrations instead.
        </span>
      </div>

      {competitions.length > 0 && (
        <label className="flex flex-col gap-1 text-sm">
          Also takes round-1 losers of
          <select name="feederCompetitionId" defaultValue="" className="rounded border border-zinc-300 px-2 py-1">
            <option value="">— none —</option>
            {competitions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-zinc-400">
            For a Shield-style competition: it fills automatically once that competition&apos;s
            first knockout round is confirmed, combined with any group-position seed above.
          </span>
        </label>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded border border-zinc-300 px-2 py-1 text-sm"
      >
        {pending ? "Adding…" : "Add"}
      </button>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
