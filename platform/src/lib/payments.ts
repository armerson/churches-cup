import "server-only";
import { createClient } from "./supabase/server";
import { getStripe } from "./stripe";

// Flat platform fee taken out of each registration payment via Stripe
// Connect's "destination charge" pattern (brief §17: "transaction-based
// fees" as one of the commercial-model options) — a placeholder rate,
// not a real pricing decision.
const PLATFORM_FEE_BPS = 500; // 5%

export type CheckoutResult =
  | { checkoutUrl: string; error: null }
  | { checkoutUrl: null; error: string };

// Only called right after register_team_for_tournament has already
// returned a 'pending' registration for a paid tournament — this
// function's job is just to move it to 'reserved' and start a Checkout
// Session, not to re-decide whether registering was allowed.
export async function createCheckoutForRegistration(
  registrationId: string,
  tournamentId: string,
): Promise<CheckoutResult> {
  const supabase = await createClient();

  const { data: tournament } = await supabase
    .from("tournaments")
    .select("id, name, entry_fee_cents, org_id, organisations(stripe_account_id, stripe_onboarding_complete)")
    .eq("id", tournamentId)
    .maybeSingle();

  if (!tournament || tournament.entry_fee_cents <= 0) {
    return { checkoutUrl: null, error: "This tournament has no entry fee." };
  }

  const org = Array.isArray(tournament.organisations)
    ? tournament.organisations[0]
    : tournament.organisations;

  if (!org?.stripe_account_id || !org.stripe_onboarding_complete) {
    return {
      checkoutUrl: null,
      error: "This organisation hasn't finished setting up payments yet.",
    };
  }

  // Goes through a function, not a direct update — see
  // 20261127250000_tighten_registration_updates.sql. Its 30-minute window
  // is what the expires_at below has to match.
  const { error: reserveError } = await supabase.rpc("reserve_registration_for_payment", {
    p_registration_id: registrationId,
  });
  if (reserveError) {
    return { checkoutUrl: null, error: reserveError.message };
  }
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const applicationFeeAmount = Math.round(
    (tournament.entry_fee_cents * PLATFORM_FEE_BPS) / 10000,
  );

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: tournament.entry_fee_cents,
          product_data: { name: `${tournament.name} — entry fee` },
        },
      },
    ],
    payment_intent_data: {
      application_fee_amount: applicationFeeAmount,
      transfer_data: { destination: org.stripe_account_id },
    },
    metadata: { registrationId },
    success_url: `${siteUrl}/registrations/${registrationId}/payment-result?status=success`,
    cancel_url: `${siteUrl}/registrations/${registrationId}/payment-result?status=cancelled`,
    expires_at: Math.floor(expiresAt.getTime() / 1000),
  });

  if (!session.url) {
    return { checkoutUrl: null, error: "Stripe did not return a checkout URL." };
  }

  await supabase.from("payments").insert({
    registration_id: registrationId,
    provider: "stripe",
    stripe_checkout_session_id: session.id,
    amount_cents: tournament.entry_fee_cents,
    status: "pending",
    idempotency_key: session.id,
  });

  return { checkoutUrl: session.url, error: null };
}
