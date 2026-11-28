"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { saveNewPassword, type PasswordActionState } from "../password-actions";

const initialState: PasswordActionState = { error: null, success: false };

async function checkResetSession(): Promise<boolean> {
  if (new URLSearchParams(window.location.search).has("error")) return false;

  // Dashboard-generated recovery links use tokens in a URL fragment. Remove
  // them before creating the SSR client, then exchange them into its cookies.
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = fragment.get("access_token");
  const refreshToken = fragment.get("refresh_token");
  const isRecovery = fragment.get("type") === "recovery";
  if (window.location.hash) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }

  const supabase = createClient();
  if (isRecovery && accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) return false;
  } else if (fragment.has("error")) {
    return false;
  }

  const { data: { user }, error } = await supabase.auth.getUser();
  return !error && !!user;
}

export function ResetPasswordForm() {
  const [status, setStatus] = useState<"checking" | "ready" | "invalid">("checking");
  const initialization = useRef<Promise<boolean> | null>(null);
  const [state, formAction, pending] = useActionState(saveNewPassword, initialState);

  useEffect(() => {
    let active = true;
    // Reuse the initialization during React's development effect replay.
    initialization.current ??= checkResetSession();
    initialization.current.then(
      ready => { if (active) setStatus(ready ? "ready" : "invalid"); },
      () => { if (active) setStatus("invalid"); },
    );
    return () => { active = false; };
  }, []);

  if (state.success) {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p role="status">Your password has been updated.</p>
        <Link href="/sign-in" className="underline">Sign in with your new password</Link>
      </div>
    );
  }
  if (status === "checking") return <p role="status" className="text-sm">Checking your reset link…</p>;
  if (status === "invalid") {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p role="alert">This reset link is missing or has expired.</p>
        <Link href="/forgot-password" className="underline">Request a new reset link</Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        New password
        <input name="password" type="password" required minLength={8} autoComplete="new-password" className="rounded border border-zinc-300 px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Confirm new password
        <input name="confirmation" type="password" required minLength={8} autoComplete="new-password" className="rounded border border-zinc-300 px-3 py-2" />
      </label>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      <button type="submit" disabled={pending} className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
        {pending ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
