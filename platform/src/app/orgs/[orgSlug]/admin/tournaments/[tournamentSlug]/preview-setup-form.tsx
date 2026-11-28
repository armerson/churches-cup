"use client";

import { useActionState } from "react";
import { createTestRegistrations, clearTestData, type FormState } from "../../actions";

const initialState: FormState = { error: null };

export function PreviewSetupForm({
  tournamentId,
  orgSlug,
  tournamentSlug,
}: {
  tournamentId: string;
  orgSlug: string;
  tournamentSlug: string;
}) {
  const boundCreate = createTestRegistrations.bind(null, tournamentId, orgSlug, tournamentSlug);
  const [state, formAction, pending] = useActionState(boundCreate, initialState);
  const boundClear = clearTestData.bind(null, tournamentId, orgSlug, tournamentSlug);

  return (
    <div className="flex flex-col gap-2 rounded border border-zinc-200 p-3">
      <p className="text-sm font-medium">Preview tournament setup</p>
      <p className="text-xs text-zinc-500">
        Generate dummy teams as confirmed registrations so you can run the real fixture/bracket
        generation and check the group counts and Championship/Plate/Shield options are right —
        before any real team has entered. Then use the normal fixture/bracket buttons above and
        view fixtures &amp; standings as usual.
      </p>
      <form action={formAction} className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Number of test teams
          <input
            name="count"
            type="number"
            min={2}
            max={128}
            defaultValue={32}
            className="w-24 rounded border border-zinc-300 px-2 py-1"
          />
        </label>
        <button type="submit" disabled={pending} className="rounded border border-zinc-300 px-2 py-1 text-sm">
          {pending ? "Generating…" : "Generate test teams"}
        </button>
        {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      </form>
      <form
        action={boundClear}
        onSubmit={(e) => {
          if (
            !confirm(
              "Clear all test teams and ALL fixtures/bracket progress for this tournament? (Real registrations, if any, are left alone.)",
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        <button type="submit" className="text-xs text-red-600 underline">
          Clear test data
        </button>
      </form>
    </div>
  );
}
