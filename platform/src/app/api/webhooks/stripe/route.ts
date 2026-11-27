import { type NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

// Stripe signs the raw request body — reading it as text (not json())
// before verifying is load-bearing, since any re-serialization would
// change the bytes the signature was computed over and fail verification.
export async function POST(request: NextRequest) {
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const stripe = getStripe();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Signature verification failed: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Idempotency: Stripe redelivers events, sometimes more than once for
  // the same one. Inserting the marker first (rather than after
  // processing) atomically claims the event via the primary key, so two
  // concurrent deliveries of the same event can't both process it. A
  // primary-key conflict (Postgres code 23505) means another delivery
  // already claimed and finished it — skip. Any OTHER error here (a
  // transient network blip) must surface as a 500, not a silent 200:
  // Stripe only retries on a non-2xx response.
  const { error: dedupeError } = await admin
    .from("webhook_events")
    .insert({ id: event.id, provider: "stripe" });
  if (dedupeError) {
    if (dedupeError.code === "23505") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    return NextResponse.json({ error: dedupeError.message }, { status: 500 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const registrationId = session.metadata?.registrationId;

      if (registrationId && session.payment_status === "paid") {
        const { error: paymentError } = await admin
          .from("payments")
          .update({ status: "paid" })
          .eq("stripe_checkout_session_id", session.id);
        if (paymentError) throw paymentError;

        const { error: regError } = await admin
          .from("registrations")
          .update({ status: "confirmed", reservation_expires_at: null })
          .eq("id", registrationId)
          .eq("status", "reserved");
        if (regError) throw regError;
      }
    }
  } catch (err) {
    // Processing failed after the event was claimed — release the claim
    // so a Stripe retry (triggered by this 500) can actually reprocess it,
    // instead of hitting the duplicate check and being silently skipped
    // forever.
    await admin.from("webhook_events").delete().eq("id", event.id);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
