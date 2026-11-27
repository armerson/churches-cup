"use client";

import { useActionState, useState } from "react";
import {
  submitScore,
  confirmScore,
  disputeScore,
  initialScoreActionState,
} from "./actions";
import type { FixtureWithTeams } from "@/lib/fixtures";

// `canAct` = the current user manages one of the two teams or administers
// the tournament — a UI convenience only. It deliberately doesn't try to
// guess which side actually submitted (team ownership isn't the same
// thing as "the user who clicked submit"); if the submitter's own account
// tries to confirm, resolve_score rejects it server-side with a clear
// message, which the confirm form already surfaces as state.error.
export function FixtureControls({
  fixture,
  canAct,
}: {
  fixture: FixtureWithTeams;
  canAct: boolean;
}) {
  if (!canAct) return null;

  if (!fixture.score) {
    return <SubmitForm fixtureId={fixture.id} />;
  }

  if (fixture.score.status === "pending") {
    return <ResolveControls fixtureId={fixture.id} />;
  }

  return null;
}

function SubmitForm({ fixtureId }: { fixtureId: string }) {
  const boundAction = submitScore.bind(null, fixtureId);
  const [state, formAction, pending] = useActionState(boundAction, initialScoreActionState);

  if (state.success) {
    return <p className="text-xs text-zinc-500">Score submitted — awaiting confirmation.</p>;
  }

  return (
    <form action={formAction} className="flex items-center gap-1 text-xs">
      <input name="score1" type="number" min={0} required className="w-12 rounded border border-zinc-300 px-1 py-0.5" />
      <span>-</span>
      <input name="score2" type="number" min={0} required className="w-12 rounded border border-zinc-300 px-1 py-0.5" />
      <button type="submit" disabled={pending} className="rounded border border-zinc-300 px-2 py-0.5">
        {pending ? "…" : "Submit"}
      </button>
      {state.error && <span className="text-red-600">{state.error}</span>}
    </form>
  );
}

function ResolveControls({ fixtureId }: { fixtureId: string }) {
  const [showDispute, setShowDispute] = useState(false);
  const boundConfirm = confirmScore.bind(null, fixtureId);
  const boundDispute = disputeScore.bind(null, fixtureId);
  const [confirmState, confirmAction, confirmPending] = useActionState(
    boundConfirm,
    initialScoreActionState,
  );
  const [disputeState, disputeAction, disputePending] = useActionState(
    boundDispute,
    initialScoreActionState,
  );

  if (confirmState.success || disputeState.success) {
    return <p className="text-xs text-zinc-500">Resolved.</p>;
  }

  if (showDispute) {
    return (
      <form action={disputeAction} className="flex items-center gap-1 text-xs">
        <input name="note" type="text" placeholder="Reason" className="rounded border border-zinc-300 px-1 py-0.5" />
        <button type="submit" disabled={disputePending} className="rounded border border-red-300 px-2 py-0.5 text-red-700">
          {disputePending ? "…" : "Submit dispute"}
        </button>
        {disputeState.error && <span className="text-red-600">{disputeState.error}</span>}
      </form>
    );
  }

  return (
    <form action={confirmAction} className="flex items-center gap-2 text-xs">
      <button type="submit" disabled={confirmPending} className="rounded border border-green-300 px-2 py-0.5 text-green-700">
        {confirmPending ? "…" : "Confirm"}
      </button>
      <button type="button" onClick={() => setShowDispute(true)} className="underline">
        Dispute
      </button>
      {confirmState.error && <span className="text-red-600">{confirmState.error}</span>}
    </form>
  );
}
