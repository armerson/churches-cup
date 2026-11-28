"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthActionState = { error: string | null };

export async function signUp(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName || null },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/confirm`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  redirect("/sign-up/check-email");
}

export async function signIn(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.code === "email_not_confirmed") {
      return { error: "Confirm your email using the link in your inbox, then sign in." };
    }
    if (error.code === "invalid_credentials") {
      // Don't reveal whether the email is registered.
      return { error: "Incorrect email or password." };
    }
    if (error.status === 429) {
      return { error: "Too many sign-in attempts. Please wait a moment and try again." };
    }

    // Record diagnostic fields without logging credentials or session tokens.
    console.error("Sign-in service error", {
      code: error.code,
      status: error.status,
      name: error.name,
    });
    return { error: "Sign-in is temporarily unavailable. Please try again shortly." };
  }

  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
