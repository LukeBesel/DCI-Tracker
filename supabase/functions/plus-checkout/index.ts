// Start a Cadence+ checkout for the signed-in caller. Returns { url }.
import { caller, cors, db, json, PRICE, SITE, stripe, STRIPE_KEY } from "../_shared/common.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (!STRIPE_KEY || !PRICE) return json(req, { error: "billing_not_configured" }, 503);
  const user = await caller(req);
  if (!user) return json(req, { error: "sign_in_required" }, 401);
  try {
    const { data: row } = await db.from("subscriptions").select("stripe_customer_id, status").eq("user_id", user.id).maybeSingle();
    if (row && (row.status === "active" || row.status === "trialing")) return json(req, { error: "already_plus" }, 409);
    let customer = row?.stripe_customer_id;
    if (!customer) {
      const c = await stripe("POST", "customers", { email: user.email ?? "", "metadata[user_id]": user.id }, `cust-${user.id}`);
      customer = c.id;
      await db.from("subscriptions").upsert({ user_id: user.id, stripe_customer_id: customer, status: "none" });
    }
    const s = await stripe("POST", "checkout/sessions", {
      mode: "subscription",
      customer,
      client_reference_id: user.id,
      "line_items[0][price]": PRICE,
      "line_items[0][quantity]": "1",
      "subscription_data[metadata][user_id]": user.id,
      allow_promotion_codes: "true",
      success_url: `${SITE}#/plus`,
      cancel_url: `${SITE}#/plus`,
    });
    return json(req, { url: s.url });
  } catch (e) {
    return json(req, { error: String((e as Error).message).slice(0, 200) }, 502);
  }
});
