import "server-only";
import { createClient } from "./supabase/server";

export type Team = { id: string; name: string };

// Not cached — this reads the session cookie via the server client on every
// call, same as lib/auth.ts, so it must only be called from behind a
// Suspense boundary (see src/app/teams/page.tsx).
export async function getMyTeams(): Promise<Team[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const [owned, managed] = await Promise.all([
    supabase.from("teams").select("id, name").eq("created_by", user.id),
    supabase.from("team_managers").select("teams(id, name)").eq("user_id", user.id),
  ]);

  const byId = new Map<string, Team>();
  for (const t of owned.data ?? []) byId.set(t.id, t);
  for (const row of managed.data ?? []) {
    const t = Array.isArray(row.teams) ? row.teams[0] : row.teams;
    if (t) byId.set(t.id, t);
  }
  return [...byId.values()];
}
