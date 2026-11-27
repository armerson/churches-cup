import { type NextRequest } from "next/server";
import { startStripeOnboarding } from "../actions";

// Stripe sends the admin here if their onboarding link expired or was
// already used — just re-start onboarding, which generates a fresh link.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const { orgSlug } = await params;
  await startStripeOnboarding(orgSlug);
}
