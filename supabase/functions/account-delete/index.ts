// Delete the caller's account and everything synced to it (rows cascade).
// An active Cadence+ subscription is cancelled first, so nobody is billed
// for an account that no longer exists.
import { caller, cors, db, json, stripe, STRIPE_KEY } from "../_shared/common.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  const user = await caller(req);
  if (!user) return json(req, { error: "sign_in_required" }, 401);
  const { data: row } = await db.from("subscriptions").select("stripe_subscription_id, status").eq("user_id", user.id).maybeSingle();
  if (row?.stripe_subscription_id && ["active", "trialing", "past_due"].includes(row.status)) {
    if (!STRIPE_KEY) return json(req, { error: "Cancel Cadence+ before deleting your account." }, 409);
    try { await stripe("DELETE", `subscriptions/${row.stripe_subscription_id}`); }
    catch (e) { return json(req, { error: String((e as Error).message).slice(0, 200) }, 502); }
  }
  await db.from("push_subs").delete().eq("user_id", user.id);
  const { error } = await db.auth.admin.deleteUser(user.id);
  if (error) return json(req, { error: "delete_failed" }, 500);
  return json(req, { ok: true });
});
