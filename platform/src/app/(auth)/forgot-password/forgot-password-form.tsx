"use client";

import { useActionState } from "react";
import { requestPasswordReset, type PasswordActionState } from "../password-actions";

const initialState: PasswordActionState = { error: null, success: false };

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);

  if (state.success) {
    return <p role="status" className="text-sm">If an account exists for that address, a reset link is on its way. Check your inbox and spam folder, then open the latest email in this browser.</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input name="email" type="email" required autoComplete="email" className="rounded border border-zinc-300 px-3 py-2" />
      </label>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      <button type="submit" disabled={pending} className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
