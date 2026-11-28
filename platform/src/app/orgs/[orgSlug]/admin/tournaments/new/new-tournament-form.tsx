"use client";

import { useEffect, useRef } from "react";
import { useActionState } from "react";
import { createTournament, type CreateTournamentFormState } from "../../actions";
import type { TournamentTemplate } from "@/lib/tournaments";

const initialState: CreateTournamentFormState = { error: null };

// Everything except isPublic (a checkbox, handled separately below).
const FIELD_NAMES = [
  "name",
  "format",
  "ageCategory",
  "maxTeams",
  "startsAt",
  "endsAt",
  "venueName",
  "venueAddress",
  "entryFee",
  "registrationClosesAt",
  "websiteRegistrationOpensAt",
  "appRegistrationOpensAt",
] as const;

function draftKey(orgSlug: string) {
  return `new-tournament-draft:${orgSlug}`;
}

// sessionStorage, not React state — deliberately. This app's Cache
// Components setup can remount this form after a failed submission (the
// router refresh that follows a server action can re-suspend the
// Suspense boundary this form lives in), which resets any in-component
// state, including useActionState's own. Reading/writing the browser
// itself is the one thing that survives that remount.
function readDraft(orgSlug: string): Record<string, string> | null {
  try {
    const raw = sessionStorage.getItem(draftKey(orgSlug));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeDraft(orgSlug: string, form: HTMLFormElement) {
  try {
    const data = new FormData(form);
    const draft: Record<string, string> = {};
    for (const name of FIELD_NAMES) draft[name] = String(data.get(name) ?? "");
    draft.isPublic = data.get("isPublic") === "on" ? "on" : "";
    sessionStorage.setItem(draftKey(orgSlug), JSON.stringify(draft));
  } catch {
    // Private browsing / storage disabled — the form still works, it just
    // can't protect against a lost submission.
  }
}

function clearDraft(orgSlug: string) {
  try {
    sessionStorage.removeItem(draftKey(orgSlug));
  } catch {
    // ignore
  }
}

function applyDraft(form: HTMLFormElement, draft: Record<string, string>) {
  for (const name of FIELD_NAMES) {
    const el = form.elements.namedItem(name) as HTMLInputElement | null;
    if (el && draft[name]) el.value = draft[name];
  }
  const isPublicEl = form.elements.namedItem("isPublic") as HTMLInputElement | null;
  if (isPublicEl && draft.isPublic !== undefined) isPublicEl.checked = draft.isPublic === "on";
}

export function NewTournamentForm({
  orgSlug,
  templates,
}: {
  orgSlug: string;
  templates: TournamentTemplate[];
}) {
  const boundAction = createTournament.bind(null, orgSlug);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  // Restore on every mount — covers a genuine fresh page load (nothing to
  // restore, no-op) and a remount caused by the error round-trip alike.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const draft = readDraft(orgSlug);
    if (draft) applyDraft(form, draft);
  }, [orgSlug]);

  // The most recent server-confirmed snapshot of what was submitted —
  // re-apply and re-persist it too, in case this render is itself about
  // to be torn down by another refresh.
  useEffect(() => {
    const form = formRef.current;
    if (!form || !state.values) return;
    const v = state.values;
    applyDraft(form, {
      name: v.name,
      format: v.format,
      ageCategory: v.ageCategory,
      maxTeams: v.maxTeams,
      startsAt: v.startsAt,
      endsAt: v.endsAt,
      venueName: v.venueName,
      venueAddress: v.venueAddress,
      entryFee: v.entryFee,
      registrationClosesAt: v.registrationClosesAt,
      websiteRegistrationOpensAt: v.websiteRegistrationOpensAt,
      appRegistrationOpensAt: v.appRegistrationOpensAt,
      isPublic: v.isPublic ? "on" : "",
    });
    writeDraft(orgSlug, form);
  }, [state.values, orgSlug]);

  return (
    <form
      ref={formRef}
      action={formAction}
      onChange={(e) => writeDraft(orgSlug, e.currentTarget)}
      className="flex flex-col gap-5"
    >
      {templates.length > 0 && (
        <label className="flex flex-col gap-1 text-sm">
          Copy settings from an existing tournament
          <select
            defaultValue=""
            className="rounded border border-zinc-300 px-2 py-1"
            onChange={(e) => {
              const template = templates.find((t) => t.id === e.target.value);
              const form = formRef.current;
              if (!template || !form) return;
              applyDraft(form, {
                format: template.format,
                ageCategory: template.ageCategory,
                maxTeams: template.maxTeams,
                venueName: template.venueName,
                venueAddress: template.venueAddress,
                entryFee: template.entryFee,
                isPublic: template.isPublic ? "on" : "",
              });
              writeDraft(orgSlug, form);
              (form.elements.namedItem("name") as HTMLInputElement | null)?.focus();
            }}
          >
            <option value="">— start from scratch —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-zinc-400">
            Copies format, age category, venue, max teams, entry fee and public/private — not
            dates or registration windows, which you&apos;ll want to set fresh. Give the new
            tournament its own name below, e.g. &quot;Churches Cup 2027&quot;.
          </span>
        </label>
      )}

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
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create tournament"}
        </button>
        <button
          type="button"
          onClick={() => {
            clearDraft(orgSlug);
            formRef.current?.reset();
          }}
          className="text-xs text-zinc-400 underline"
        >
          Clear form
        </button>
      </div>
    </form>
  );
}
