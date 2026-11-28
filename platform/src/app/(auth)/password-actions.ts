"use server";

import { createClient } from "@/lib/supabase/server";

export type PasswordActionState = { error: string | null; success: boolean };

export async function requestPasswordReset(
  _previous: PasswordActionState,
  formData: FormData,
): Promise<PasswordActionState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Enter your email address.", success: false };
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    return { error: "Password reset is temporarily unavailable.", success: false };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: new URL("/reset-password", siteUrl).toString(),
  });

  if (error) {
    console.error("Password reset email error", { code: error.code, status: error.status });
    return {
      error: error.status === 429
        ? "Please wait a few minutes before requesting another reset email."
        : "We couldn't send the reset email. Please try again shortly.",
      success: false,
    };
  }

  // Use the same response whether or not this address has an account.
  return { error: null, success: true };
}

export async function saveNewPassword(
  _previous: PasswordActionState,
  formData: FormData,
): Promise<PasswordActionState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (password.length < 8) {
    return { error: "Use at least 8 characters.", success: false };
  }
  if (password !== confirmation) {
    return { error: "The passwords don't match.", success: false };
  }

  const supabase = await createClient();
  const { data: { user }, error: sessionError } = await supabase.auth.getUser();
  if (sessionError || !user) {
    return { error: "This reset link has expired. Request a new one.", success: false };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return {
      error: error.code === "same_password"
        ? "Choose a password different from your current password."
        : error.code === "weak_password"
          ? "Choose a stronger password with at least 8 characters."
          : "We couldn't update your password. Please try again.",
      success: false,
    };
  }

  await supabase.auth.signOut({ scope: "local" });
  return { error: null, success: true };
}
