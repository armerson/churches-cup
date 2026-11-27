import "server-only";
import { createClient } from "./supabase/server";

export type CurrentUser = {
  id: string;
  email: string | null;
};

// Data Access Layer: the one place that reads the session. Every caller
// must sit behind a <Suspense> boundary (Cache Components treats a cookie
// read as request-time, so it can't be part of the static shell) — see
// node_modules/next/dist/docs/01-app/02-guides/authentication-with-cache-components.md
export async function getCurrentUser(): Promise<CurrentUser | null> {
  "use cache: private";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;
  return { id: user.id, email: user.email ?? null };
}
