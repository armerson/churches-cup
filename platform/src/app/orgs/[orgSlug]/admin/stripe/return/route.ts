import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { getOrgIdBySlug } from "@/lib/tournaments";

// Stripe sends the admin back here after hosted onboarding — re-fetch the
// account to find out whether it's actually ready (the user could have
// abandoned onboarding partway through), rather than trusting the redirect
// itself as proof of completion.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const { orgSlug } = await params;
  const orgId = await getOrgIdBySlug(orgSlug);
  if (!orgId) {
    redirect(`/orgs/${orgSlug}/admin`);
  }

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organisations")
    .select("stripe_account_id")
    .eq("id", orgId)
    .maybeSingle();

  if (org?.stripe_account_id) {
    const stripe = getStripe();
    const account = await stripe.accounts.retrieve(org.stripe_account_id);
    const complete = Boolean(account.details_submitted && account.charges_enabled);
    await supabase
      .from("organisations")
      .update({ stripe_onboarding_complete: complete })
      .eq("id", orgId);
  }

  redirect(`/orgs/${orgSlug}/admin`);
}
