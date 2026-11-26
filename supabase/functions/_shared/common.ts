// Shared helpers for Cadence's account and billing functions.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

export const SITE = (Deno.env.get("SITE_URL") ?? "https://lukebesel.github.io/DCI-Tracker/").replace(/\/?$/, "/");
const ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  `${new URL(SITE).origin},http://localhost:8000,http://localhost:8533`).split(",").map((s) => s.trim());
export const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
export const PRICE = Deno.env.get("STRIPE_PRICE_PLUS") ?? "";

export const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } });

export function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
export const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

// the caller, from their own access token — never from the request body
export async function caller(req: Request) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await db.auth.getUser(jwt);
  return data?.user ?? null;
}

// Stripe REST (form-encoded), no SDK
export async function stripe(method: string, path: string, params?: Record<string, string>, idem?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${STRIPE_KEY}` };
  let body: string | undefined;
  let url = `https://api.stripe.com/v1/${path}`;
  if (params && method === "GET") url += "?" + new URLSearchParams(params);
  else if (params) { body = new URLSearchParams(params).toString(); headers["Content-Type"] = "application/x-www-form-urlencoded"; }
  if (idem) headers["Idempotency-Key"] = idem;
  const r = await fetch(url, { method, headers, body });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message ?? `stripe ${r.status}`);
  return j;
}

// a subscription object -> the row the app reads
export async function saveSubscription(sub: any, userId?: string) {
  const end = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
  const row = {
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
    stripe_subscription_id: sub.id,
    status: sub.status,
    current_period_end: end ? new Date(end * 1000).toISOString() : null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  };
  const uid = userId ?? sub.metadata?.user_id;
  if (uid) return db.from("subscriptions").upsert({ user_id: uid, ...row });
  return db.from("subscriptions").update(row).eq("stripe_customer_id", row.stripe_customer_id);
}
