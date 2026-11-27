import "server-only";
import Stripe from "stripe";

let client: Stripe | null = null;

// Lazily constructed so a missing key only breaks the one request that
// actually needs Stripe, not every page (consistent with how the
// Supabase placeholder URL is handled elsewhere in this scaffold).
export function getStripe(): Stripe {
  if (!client) {
    client = new Stripe(process.env.STRIPE_SECRET_KEY!);
  }
  return client;
}
