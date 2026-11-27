"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { isOrgAdmin } from "@/lib/orgs";
import { getOrgIdBySlug } from "@/lib/tournaments";

// Creates (or reuses) a Stripe Express account for the organisation and
// redirects the admin to Stripe's own hosted onboarding flow — the
// platform never collects or stores bank details itself.
export async function startStripeOnboarding(orgSlug: string) {
  if (!(await isOrgAdmin(orgSlug))) {
    throw new Error("Not authorised.");
  }

  const orgId = await getOrgIdBySlug(orgSlug);
  if (!orgId) {
    throw new Error("Organisation not found.");
  }

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organisations")
    .select("stripe_account_id")
    .eq("id", orgId)
    .maybeSingle();

  const stripe = getStripe();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  let accountId = org?.stripe_account_id;
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: "express",
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
    accountId = account.id;
    await supabase.from("organisations").update({ stripe_account_id: accountId }).eq("id", orgId);
  }

  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${siteUrl}/orgs/${orgSlug}/admin/stripe/refresh`,
    return_url: `${siteUrl}/orgs/${orgSlug}/admin/stripe/return`,
  });

  redirect(accountLink.url);
}
