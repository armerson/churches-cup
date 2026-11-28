"use client";

import { useActionState, useRef } from "react";
import { addCompetition, type FormState } from "../../actions";
import type { Competition } from "@/lib/tournaments";

const initialState: FormState = { error: null };

// "From place N to place M" presets covering the common group-stage
// shapes (set both fields so most admins never have to type a number),
// matching churches-cup's own Championship/Plate/Shield structure.
const PRESETS = [
  { label: "Everyone (no group seeding)", start: "", end: "" },
  { label: "Top 2 per group", start: "1", end: "2" },
  { label: "Group winners only", start: "1", end: "1" },
  { label: "3rd place per group", start: "3", end: "3" },
  { label: "Bottom team per group", start: "4", end: "4" },
];

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
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded border border-zinc-200 p-3">
      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Competition name
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

      <div className="flex flex-col gap-2 border-t border-zinc-100 pt-2">
        <p className="text-sm font-medium">Which teams play in it?</p>
        <p className="text-xs text-zinc-500">
          Based on where a team finishes in its group once group fixtures are confirmed. 1st
          place is the group winner. Pick a preset, or set the range by hand below.
        </p>
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                if (startRef.current) startRef.current.value = p.start;
                if (endRef.current) endRef.current.value = p.end;
              }}
              className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2 text-sm">
          <label className="flex flex-col gap-1">
            From place
            <input
              ref={startRef}
              name="advanceFromPositionStart"
              type="number"
              min={1}
              placeholder="e.g. 1"
              className="w-24 rounded border border-zinc-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            to place
            <input
              ref={endRef}
              name="advanceFromPositionEnd"
              type="number"
              min={1}
              placeholder="e.g. 2"
              className="w-24 rounded border border-zinc-300 px-2 py-1"
            />
          </label>
        </div>
      </div>

      {competitions.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-zinc-100 pt-2">
          <p className="text-sm font-medium">Also take another competition&apos;s early losers?</p>
          <p className="text-xs text-zinc-500">
            Optional — use this for a Shield-style competition, e.g. 3rd place per group (above)
            plus whoever loses their first match in the Championship. It fills in automatically
            once that competition&apos;s first round is fully confirmed — nothing to click.
          </p>
          <label className="flex flex-col gap-1 text-sm">
            Round-1 losers from
            <select name="feederCompetitionId" defaultValue="" className="rounded border border-zinc-300 px-2 py-1">
              <option value="">— none —</option>
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded border border-zinc-300 px-2 py-1 text-sm"
      >
        {pending ? "Adding…" : "Add competition"}
      </button>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
