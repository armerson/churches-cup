"use client";

import { useActionState } from "react";
import { addPitch, type FormState } from "../../actions";

const initialState: FormState = { error: null };

export function AddPitchForm({
  tournamentId,
  orgSlug,
  tournamentSlug,
}: {
  tournamentId: string;
  orgSlug: string;
  tournamentSlug: string;
}) {
  const boundAction = addPitch.bind(null, tournamentId, orgSlug, tournamentSlug);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction} className="flex items-end gap-2">
      <label className="flex flex-col gap-1 text-sm">
        Pitch name
        <input name="name" type="text" placeholder="e.g. Orange Pitch" required className="rounded border border-zinc-300 px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Colour
        <input name="colour" type="text" placeholder="e.g. orange" className="rounded border border-zinc-300 px-2 py-1" />
      </label>
      <button type="submit" disabled={pending} className="rounded border border-zinc-300 px-2 py-1 text-sm">
        {pending ? "Adding…" : "Add"}
      </button>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
