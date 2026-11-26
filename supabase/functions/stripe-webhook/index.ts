// Stripe -> Cadence+ status. Trust model: the request body is only a hint.
// The event is re-fetched from Stripe with the secret key, so a forged POST
// can't grant anyone Plus — no signing secret needs to be copied around.
import { json, saveSubscription, stripe, STRIPE_KEY } from "../_shared/common.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(req, { error: "method" }, 405);
  if (!STRIPE_KEY) return json(req, { error: "billing_not_configured" }, 503);
  let id = "";
  try { id = (await req.json())?.id ?? ""; } catch { /* ignore */ }
  if (!/^evt_[A-Za-z0-9]+$/.test(id)) return json(req, { error: "bad_event" }, 400);
  let ev: any;
  try { ev = await stripe("GET", `events/${id}`); } catch { return json(req, { error: "unknown_event" }, 400); }

  const obj = ev.data?.object ?? {};
  try {
    if (ev.type === "checkout.session.completed" && obj.mode === "subscription" && obj.subscription) {
      const sub = await stripe("GET", `subscriptions/${obj.subscription}`);
      await saveSubscription(sub, obj.client_reference_id || sub.metadata?.user_id);
    } else if (ev.type.startsWith("customer.subscription.")) {
      // always store the subscription's CURRENT state, not the event's copy,
      // so out-of-order deliveries can't roll status backwards
      const sub = await stripe("GET", `subscriptions/${obj.id}`);
      await saveSubscription(sub);
    } else if (ev.type === "invoice.paid" && obj.subscription) {
      await saveSubscription(await stripe("GET", `subscriptions/${obj.subscription}`));
    }
  } catch (e) {
    return json(req, { error: String((e as Error).message).slice(0, 200) }, 500);   // Stripe retries
  }
  return json(req, { received: true });
});
