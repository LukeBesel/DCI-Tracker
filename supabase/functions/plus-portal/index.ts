// Stripe's hosted billing page (cancel, card, receipts) for the caller.
import { caller, cors, db, json, SITE, stripe, STRIPE_KEY } from "../_shared/common.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (!STRIPE_KEY) return json(req, { error: "billing_not_configured" }, 503);
  const user = await caller(req);
  if (!user) return json(req, { error: "sign_in_required" }, 401);
  const { data: row } = await db.from("subscriptions").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
  if (!row?.stripe_customer_id) return json(req, { error: "no_billing_account" }, 404);
  try {
    const s = await stripe("POST", "billing_portal/sessions", { customer: row.stripe_customer_id, return_url: `${SITE}#/plus` });
    return json(req, { url: s.url });
  } catch (e) {
    return json(req, { error: String((e as Error).message).slice(0, 200) }, 502);
  }
});
