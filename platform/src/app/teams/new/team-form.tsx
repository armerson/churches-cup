"use client";

import { useActionState } from "react";
import { createTeam, type TeamActionState } from "../actions";

const initialState: TeamActionState = { error: null };

export function TeamForm() {
  const [state, formAction, pending] = useActionState(createTeam, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Team name
        <input
          name="name"
          type="text"
          required
          className="rounded border border-zinc-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Contact name
        <input name="contactName" type="text" className="rounded border border-zinc-300 px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Contact email
        <input
          name="contactEmail"
          type="email"
          className="rounded border border-zinc-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Contact phone
        <input name="contactPhone" type="tel" className="rounded border border-zinc-300 px-3 py-2" />
      </label>
      <p className="text-xs text-zinc-400">
        Contact details are only ever visible to you and to tournament
        organisers — never shown on a public page.
      </p>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create team"}
      </button>
    </form>
  );
}
