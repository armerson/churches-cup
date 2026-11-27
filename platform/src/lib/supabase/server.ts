import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Per-request client — reads the session cookie, so every caller must sit
// behind a Suspense boundary (see src/lib/auth.ts) under Cache Components.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component render — ignore; middleware
            // refreshes the session cookie on the next request instead.
          }
        },
      },
    },
  );
}
