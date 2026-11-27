"use client";

import { useActionState } from "react";
import { createTournament, type FormState } from "../../actions";

const initialState: FormState = { error: null };

export function NewTournamentForm({ orgSlug }: { orgSlug: string }) {
  const boundAction = createTournament.bind(null, orgSlug);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Name
        <input name="name" type="text" required className="rounded border border-zinc-300 px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Format
        <input
          name="format"
          type="text"
          placeholder="e.g. churches_cup, five_a_side, adult_11_a_side"
          className="rounded border border-zinc-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Max teams
        <input name="maxTeams" type="number" min={1} className="rounded border border-zinc-300 px-3 py-2" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="isPublic" type="checkbox" defaultChecked />
        Public (visible on the tournament discovery page)
      </label>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create tournament"}
      </button>
    </form>
  );
}
