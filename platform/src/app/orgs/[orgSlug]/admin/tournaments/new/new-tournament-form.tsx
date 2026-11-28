"use client";

import { useActionState } from "react";
import { createTournament, type FormState } from "../../actions";

const initialState: FormState = { error: null };

export function NewTournamentForm({ orgSlug }: { orgSlug: string }) {
  const boundAction = createTournament.bind(null, orgSlug);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Basics
        </legend>
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
          Age category
          <input
            name="ageCategory"
            type="text"
            placeholder="e.g. Adult, U16, Open"
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
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Dates &amp; venue
        </legend>
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            Starts
            <input name="startsAt" type="date" className="rounded border border-zinc-300 px-3 py-2" />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            Ends
            <input name="endsAt" type="date" className="rounded border border-zinc-300 px-3 py-2" />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          Venue name
          <input name="venueName" type="text" className="rounded border border-zinc-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Venue address
          <input name="venueAddress" type="text" className="rounded border border-zinc-300 px-3 py-2" />
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Entry &amp; registration
        </legend>
        <label className="flex flex-col gap-1 text-sm">
          Entry fee (£, leave blank or 0 for free)
          <input name="entryFee" type="number" min={0} step="0.01" className="rounded border border-zinc-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Registration closes
          <input name="registrationClosesAt" type="datetime-local" className="rounded border border-zinc-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Website registration opens
          <input
            name="websiteRegistrationOpensAt"
            type="datetime-local"
            className="rounded border border-zinc-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          App-exclusive registration opens
          <input
            name="appRegistrationOpensAt"
            type="datetime-local"
            className="rounded border border-zinc-300 px-3 py-2"
          />
          <span className="text-xs text-zinc-400">
            Leave both blank for registration to open immediately once you publish.
          </span>
        </label>
      </fieldset>

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
