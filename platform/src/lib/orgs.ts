import "server-only";
import { getCurrentMemberships } from "./auth";

const ADMIN_ROLES = ["org_admin", "tournament_admin"];

// UI-level gate only, for a sensible logged-out/wrong-role experience —
// the real enforcement is the RLS policies on tournaments/competitions/
// pitches, which re-check this exact thing server-side on every write
// regardless of what this function returns.
export async function isOrgAdmin(orgSlug: string): Promise<boolean> {
  const memberships = await getCurrentMemberships();
  return memberships.some((m) => m.orgSlug === orgSlug && ADMIN_ROLES.includes(m.role));
}
