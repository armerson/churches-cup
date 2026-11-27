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

export type Membership = {
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: string;
};

// Which organisations the current user belongs to, and with what role.
// Same private-cache/session-read pattern as getCurrentUser above.
export async function getCurrentMemberships(): Promise<Membership[]> {
  "use cache: private";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("memberships")
    .select("org_id, role, organisations(name, slug)")
    .eq("user_id", user.id);

  if (error || !data) return [];

  // Without generated Database types (no real Supabase project linked yet),
  // supabase-js infers the joined relation as an array; it's really the one
  // parent row the foreign key points to.
  return data.map((row) => {
    const org = Array.isArray(row.organisations)
      ? row.organisations[0]
      : row.organisations;
    return {
      orgId: row.org_id,
      orgName: org?.name ?? "",
      orgSlug: org?.slug ?? "",
      role: row.role,
    };
  });
}
