import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS entirely. Only use this to perform a
// system-level consequence of an action whose authorization was already
// fully checked through a normal RLS-respecting path. See lib/bracket.ts's
// advanceBracket(), called only after resolve_score() has already
// succeeded via the regular per-request client.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
