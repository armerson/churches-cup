"use client";

import { deleteCompetition } from "../../actions";

export function DeleteCompetitionButton({
  tournamentId,
  orgSlug,
  tournamentSlug,
  competitionId,
  competitionName,
}: {
  tournamentId: string;
  orgSlug: string;
  tournamentSlug: string;
  competitionId: string;
  competitionName: string;
}) {
  const boundAction = deleteCompetition.bind(null, tournamentId, orgSlug, tournamentSlug, competitionId);
  return (
    <form
      action={boundAction}
      className="inline"
      onSubmit={(e) => {
        if (
          !confirm(
            `Delete "${competitionName}"? Any fixtures already generated for it will be deleted too.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <button type="submit" className="text-xs text-red-600 underline">
        Delete
      </button>
    </form>
  );
}
