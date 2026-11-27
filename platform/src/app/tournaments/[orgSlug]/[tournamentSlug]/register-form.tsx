"use client";

import { useActionState, useEffect } from "react";
import { registerTeamForTournament, type RegisterActionState } from "@/app/teams/actions";
import type { Team } from "@/lib/teams";

const initialState: RegisterActionState = { error: null, status: null, checkoutUrl: null };

export function RegisterForm({
  tournamentId,
  teams,
}: {
  tournamentId: string;
  teams: Team[];
}) {
  const [state, formAction, pending] = useActionState(
    registerTeamForTournament,
    initialState,
  );

  // Paid tournament: send the browser on to Stripe Checkout once a
  // session exists — a plain navigation, not a server-side redirect,
  // since the URL only exists after this client-side state update.
  useEffect(() => {
    if (state.checkoutUrl) {
      window.location.href = state.checkoutUrl;
    }
  }, [state.checkoutUrl]);

  if (state.checkoutUrl) {
    return <p className="text-sm text-zinc-500">Redirecting you to payment…</p>;
  }

  if (state.status) {
    return (
      <p className="text-sm">
        {state.status === "waitlisted"
          ? "Tournament is full — your team has been added to the waiting list."
          : "Registration submitted!"}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex items-end gap-2">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <label className="flex flex-1 flex-col gap-1 text-sm">
        Team
        <select name="teamId" required className="rounded border border-zinc-300 px-3 py-2">
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Registering…" : "Register"}
      </button>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
