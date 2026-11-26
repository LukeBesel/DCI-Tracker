// Cadence score-alert relay (Supabase Edge Function).
//
// Same routes as the retired Railway relay, so the app's CadPush client works
// unchanged:  GET /healthz  GET /status  GET /vapid
//             POST /subscribe  POST /unsubscribe  POST /test
// plus        POST /check   — called by pg_cron: every 5 s while a show is
//             live (relay_kv "mode".hot), once a minute otherwise. Watches the
//             official sources directly (fast path) and the published site
//             (safety net); one push per genuinely new class result.
//
// State lives in Postgres (service role only): push_subs, relay_kv (VAPID
// keys, last snapshot, status) and relay_notified (the anti-spam ledger:
// exactly one alert per show, never a repeat when CDN edges flap).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SITE = (Deno.env.get("SITE_URL") ?? "https://lukebesel.github.io/DCI-Tracker/").replace(/\/?$/, "/");
const ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  `${new URL(SITE).origin},http://localhost:8000,http://localhost:8533`).split(",").map((s) => s.trim());
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } });

// ------------------------------------------------------------ helpers
function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

async function kvGet<T>(key: string): Promise<T | null> {
  const { data } = await db.from("relay_kv").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? null;
}
async function kvSet(key: string, value: unknown) {
  await db.from("relay_kv").upsert({ key, value, updated_at: new Date().toISOString() });
}

// VAPID keys: generated once and never rotated (rotation silently detaches
// every subscriber). Insert-if-absent, then re-read, so two cold starts
// racing can't end up signing with different keys.
let vapid: { publicKey: string; privateKey: string } | null = null;
async function keys() {
  if (vapid) return vapid;
  let k = await kvGet<{ publicKey: string; privateKey: string }>("vapid");
  if (!k) {
    const fresh = webpush.generateVAPIDKeys();
    await db.from("relay_kv").upsert({ key: "vapid", value: fresh }, { onConflict: "key", ignoreDuplicates: true });
    k = await kvGet("vapid");
  }
  vapid = k!;
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:alerts@cadence.app", vapid.publicKey, vapid.privateKey);
  return vapid;
}

// the signed-in user behind a request, if any (alerts work signed out too)
async function userOf(req: Request): Promise<string | null> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt || jwt.split(".").length !== 3) return null;
  const { data } = await db.auth.getUser(jwt);
  return data?.user?.id ?? null;
}

async function isPlus(uid: string | null): Promise<boolean> {
  if (!uid) return false;
  const { data } = await db.rpc("is_plus", { uid });
  return data === true;
}

// ------------------------------------------------------------ scores
type Row = { circuit: "dci" | "wgi"; cls: string; corps: string; score: number; date: string; event: string };

async function fetchJson(path: string) {
  const r = await fetch(`${SITE}${path}?cb=${Date.now()}`, { headers: { "cache-control": "no-cache" } });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}

// key "circuit|class|corps" -> "date|event|score"
async function snapshot(): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  const dci = await fetchJson("data/rankings.json");
  for (const [cls, block] of Object.entries<any>(dci.standings ?? {}))
    for (const r of block.rows ?? [])
      out.set(`dci|${cls}|${r.corps}`, { circuit: "dci", cls, corps: r.corps, score: +r.score, date: r.date, event: r.event });
  try {
    const wgi = await fetchJson("data/wgi/rankings.json");
    for (const [div, classes] of Object.entries<any>(wgi.standings ?? {}))
      for (const [cls, block] of Object.entries<any>(classes))
        for (const r of block.rows ?? [])
          out.set(`wgi|${div} · ${cls}|${r.corps}`,
            { circuit: "wgi", cls: `${div} · ${cls}`, corps: r.corps, score: +r.score, date: r.date, event: r.event });
  } catch { /* WGI off-season or missing: DCI alerts still run */ }
  return out;
}
const sig = (r: Row) => `${r.date}|${r.event}|${r.score}`;
// one ledger entry per class result at a show (the fast path is per class
// too), so one class being announced never silences another class later
const showKey = (r: Row) => `${r.circuit}|${r.event}|${r.date}|${r.cls}`;

// ------------------------------------------------------------ fast path
// The site path above waits for scrape -> build -> GitHub Pages deploy,
// which costs minutes. On show days the relay ALSO watches the official
// sources directly — CompetitionSuite (where DCI's scores are entered) and
// WGI's own scores API — and pushes the moment a class's scores appear.
// Light on the sources: competition lists are cached for 5 minutes; only
// today's shows are re-read, at most every 4 s.
const CS = "https://bridge.competitionsuite.com/api/orgscores";
const DCI_ORG = "96b77ec2-333e-41e9-8d7d-806a8cbe116b";
const WGI = "https://wgiserver.org/v1";
const WGI_KEY = "pvk7syNgSZbCyTtTf_tWAw";   // the public key wgi.org's own pages use
// WGI season ids (Salesforce). Add the next one each winter, as scrape_wgi.py does.
const WGI_SEASONS: Record<number, string> = {
  2027: "a0sUy000002CVwXIAW", 2026: "a0sUy000001dAGfIAM", 2025: "a0sUy0000007hTFIAY",
};
const WGI_DIV: Record<string, string> = { Guard: "Color Guard", Percussion: "Percussion", Winds: "Winds" };

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
// "today" in the US: a 9 PM Pacific finish is already tomorrow in UTC
const liveDates = () => new Set([ymd(Date.now()), ymd(Date.now() - 864e5)]);

async function getJson(url: string): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json", "cache-control": "no-cache" } });
    if (!r.ok) return null;
    let txt = (await r.text()).trim();
    if (!txt.startsWith("{") && !txt.startsWith("[")) {      // jsonp wrapper
      const i = txt.indexOf("("), j = txt.lastIndexOf(")");
      if (i >= 0 && j > i) txt = txt.slice(i + 1, j);
    }
    return JSON.parse(txt);
  } catch { return null; } finally { clearTimeout(t); }
}

// cached lookups (5 min) so a 5-second cadence only re-reads today's shows
async function cached<T>(key: string, ttl: number, load: () => Promise<T | null>): Promise<T | null> {
  const c = await kvGet<{ at: number; v: T }>(`cache:${key}`);
  if (c && Date.now() - c.at < ttl) return c.v;
  const v = await load();
  if (v != null) await kvSet(`cache:${key}`, { at: Date.now(), v });
  return v ?? c?.v ?? null;
}

const DCI_ROUND: Record<string, string> = {
  "world class": "World Class", "open class": "Open Class", "all age class": "All-Age",
  "all-age class": "All-Age", "all age": "All-Age", "all-age": "All-Age",
};

type Live = { key: string; rows: Row[] };

async function dciLive(): Promise<Live[]> {
  const year = new Date().getUTCFullYear();
  const comps = await cached<any[]>(`cs-comps-${year}`, 5 * 60e3, async () => {
    const seasons = await getJson(`${CS}/GetSeasons/jsonp?organization=${DCI_ORG}`);
    const sg = Array.isArray(seasons) ? seasons.find((s: any) => String(s.name) === String(year))?.seasonGuid : null;
    if (!sg) return [];
    const d = await getJson(`${CS}/GetCompetitionsBySeason/jsonp?season=${sg}`);
    return (d?.competitions ?? []).map((c: any) => ({
      guid: c.competitionGuid, name: c.name, date: String(c.competitionDate ?? "").slice(0, 10) }));
  });
  const days = liveDates();
  const out: Live[] = [];
  for (const c of (comps ?? []).filter((c) => days.has(c.date))) {
    const d = await getJson(`${CS}/GetCompetition/jsonp?competition=${c.guid}`);
    for (const rnd of d?.rounds ?? []) {
      const raw = String(rnd.name ?? "").trim();
      const cls = DCI_ROUND[raw.toLowerCase()] ?? raw;
      const rows: Row[] = (rnd.performances ?? [])
        .filter((p: any) => p?.name && p.score != null && +p.score > 0)
        .map((p: any) => ({ circuit: "dci" as const, cls, corps: String(p.name).trim(), score: +p.score,
          date: c.date, event: c.name }));
      if (rows.length) out.push({ key: `fast|dci|${c.guid}|${raw}`, rows });
    }
  }
  return out;
}

async function wgiLive(): Promise<Live[]> {
  const year = new Date().getUTCFullYear();
  const season = WGI_SEASONS[year];
  if (!season) return [];
  const days = liveDates();
  const out: Live[] = [];
  for (const div of Object.keys(WGI_DIV)) {
    const shows = await cached<any[]>(`wgi-shows-${year}-${div}`, 5 * 60e3, async () => {
      const d = await getJson(`${WGI}/seasonapi=${WGI_KEY}?Division=${div}&SeasonId=${season}`);
      return Array.isArray(d) ? d.map((s: any) => ({ id: s["show-id-key"], name: s.Name,
        date: String(s.Show_Date__c ?? "").slice(0, 10) })) : null;
    });
    for (const s of (shows ?? []).filter((s) => days.has(s.date) && s.id)) {
      const d = await getJson(`${WGI}/showapi=${WGI_KEY}?Division=${div}&ShowId=${s.id}`);
      for (const [cls, rounds] of Object.entries<any>(d?.Results ?? {})) {
        // rounds are "Round 0", "Round 1"...: alert each round once, as it posts
        for (const [rname, groups] of Object.entries<any>(rounds ?? {})) {
          if (!Array.isArray(groups)) continue;
          const rows: Row[] = groups
            .filter((g: any) => g && g.gss_bool_Hide_Score__c !== true && g.gss_bool_Score_Display__c !== false
              && /^\s*\d+(\.\d+)?\s*$/.test(String(g.gss_cs_score__c ?? "")) && +g.gss_cs_score__c > 0
              && g.backend_Group_Friendly_Name__c)
            .map((g: any) => ({ circuit: "wgi" as const, cls: `${WGI_DIV[div]} · ${cls.trim()}`,
              corps: String(g.backend_Group_Friendly_Name__c).trim(), score: +g.gss_cs_score__c,
              date: s.date, event: s.name }));
          if (rows.length) out.push({ key: `fast|wgi|${s.id}|${div}|${cls}|${rname}`, rows });
        }
      }
    }
  }
  return out;
}

// any show today/last night on either circuit? (drives the 5 s cadence)
async function liveShowsToday(): Promise<boolean> {
  const days = liveDates();
  const year = new Date().getUTCFullYear();
  const dci = await kvGet<{ v: any[] }>(`cache:cs-comps-${year}`);
  if (dci?.v?.some((c) => days.has(c.date))) return true;
  for (const div of Object.keys(WGI_DIV)) {
    const w = await kvGet<{ v: any[] }>(`cache:wgi-shows-${year}-${div}`);
    if (w?.v?.some((s) => days.has(s.date))) return true;
  }
  return false;
}

// What has already been announced, by EITHER path: circuit + date + the
// corps in it. Both paths consult it before sending and add to it after, so
// a result goes out once whichever path sees it first.
async function recentAlerts(): Promise<any[]> {
  return ((await kvGet<any[]>("fast_recent")) ?? []).filter((f) => f.date >= ymd(Date.now() - 3 * 864e5));
}
async function rememberAlerts(groups: Iterable<Row[]>) {
  const recent = await recentAlerts();
  for (const rows of groups)
    recent.push({ circuit: rows[0].circuit, date: rows[0].date, corps: rows.map((r) => norm(r.corps)) });
  await kvSet("fast_recent", recent.slice(-200));
}

async function fastCheck(status: any): Promise<{ shows: number; sent: number }> {
  const live = [...await dciLive(), ...await wgiLive()];
  // First fast run ever (fresh deploy or restored state): whatever the
  // sources already show is baseline, claimed silently, never a burst of
  // alerts for results that posted before the relay was watching.
  const seeding = !(await kvGet<boolean>("fast_seeded"));
  const already = await recentAlerts();
  const claimed = new Map<string, Row[]>();
  for (const l of live) {
    const { error } = await db.from("relay_notified").insert({ key: l.key });
    if (error) continue;                                   // claimed before
    if (seeding || l.rows.some((r) => announced(already, r))) continue;   // baseline / site path sent it
    claimed.set(l.key, l.rows);
  }
  if (seeding) await kvSet("fast_seeded", true);
  if (!claimed.size) return { shows: 0, sent: 0 };
  await rememberAlerts(claimed.values());
  status.lastFast = new Date().toISOString();
  return { shows: claimed.size, sent: await broadcast(claimed, status) };
}

// corps names differ slightly between sources ("... Drum & Bugle Corps")
function norm(s: string) {
  return s.toLowerCase().replace(/drum\s*(and|&)\s*bugle\s*corps/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

// is a show happening (today or last night, for late West-Coast results)?
async function showDay(): Promise<boolean> {
  try {
    const up = await fetchJson("data/upcoming.json");
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const days = new Set([day(Date.now()), day(Date.now() - 864e5)]);
    return Array.isArray(up) && up.some((e: any) => days.has(e.date));
  } catch { return false; }
}

async function check(force = false) {
  const status = (await kvGet<any>("status")) ?? {};
  const now = Date.now();
  // Show day? From the site's upcoming list (refreshed every 15 min) or the
  // sources' own competition lists. Hot = every 5 s; otherwise once a minute.
  if (!(status.showDayAt && now - status.showDayAt < 15 * 60e3)) {
    status.showDay = await showDay();
    status.showDayAt = now;
  }
  let fast = { shows: 0, sent: 0 };
  // first call of the day (or an expired cache) also refreshes the source lists
  const hot = status.showDay || await liveShowsToday();
  if (hot !== !!status.hot) { status.hot = hot; await kvSet("mode", { hot }); }
  if (hot && (force || !status.lastFastAt || now - status.lastFastAt >= 4e3)) {
    status.lastFastAt = now;
    fast = await fastCheck(status);
  } else if (!hot && (!status.listsAt || now - status.listsAt > 5 * 60e3)) {
    // cold: still poll the lists every 5 min so a show day is noticed
    status.listsAt = now;
    await dciLive(); await wgiLive();
  }
  // the site path is the safety net (and covers sources the fast path can't)
  const gap = hot ? 15e3 : 50e3;
  if (!force && status.lastCheckAt && now - status.lastCheckAt < gap) {
    status.sent = (status.sent ?? 0) + fast.sent;
    await kvSet("status", status);
    return { skipped: true, hot, fastShows: fast.shows, sent: fast.sent };
  }
  status.lastCheckAt = now;
  status.lastCheck = new Date(now).toISOString();

  const state = await snapshot();
  const last = await kvGet<Record<string, string>>("snapshot");
  const fresh: Record<string, string> = {};
  for (const [k, r] of state) fresh[k] = sig(r);

  let sentTo = 0, shows = 0;
  if (!last) {
    // first run: everything already live is the baseline, never an alert
    const seed = [...new Set([...state.values()].map(showKey))].map((key) => ({ key }));
    for (let i = 0; i < seed.length; i += 500) await db.from("relay_notified").upsert(seed.slice(i, i + 500));
  } else {
    // Two guards against alerting on old results: a circuit missing from the
    // last snapshot (a restored or first-published data set) is baseline, not
    // news; and only scores dated in the last two days can ever alert.
    const seen = new Set(Object.keys(last).map((k) => k.split("|")[0]));
    const recent = new Date(now - 2 * 864e5).toISOString().slice(0, 10);
    const baseline = new Set<string>();
    const fastRecent = await recentAlerts();
    const byShow = new Map<string, Row[]>();
    const covered = new Set<string>();      // class results the fast path already sent
    for (const [k, r] of state) {
      if (last[k] === fresh[k]) continue;
      if (!seen.has(r.circuit) || !(r.date >= recent)) { baseline.add(showKey(r)); continue; }
      const sk = showKey(r);
      // drop only the rows already announced; the rest of the class still goes out
      if (announced(fastRecent, r)) { covered.add(sk); continue; }
      if (!byShow.has(sk)) byShow.set(sk, []);
      byShow.get(sk)!.push(r);
    }
    // a class whose every changed row was already announced is done
    for (const sk of covered) if (!byShow.has(sk)) baseline.add(sk);
    const base = [...baseline].map((key) => ({ key }));
    for (let i = 0; i < base.length; i += 500)
      await db.from("relay_notified").upsert(base.slice(i, i + 500), { ignoreDuplicates: true });
    if (byShow.size) {
      // claim each show in the ledger BEFORE sending: only the run whose
      // insert succeeds broadcasts it, so overlapping runs can't double-alert
      const claimed = new Map<string, Row[]>();
      for (const [sk, rows] of byShow) {
        const { error } = await db.from("relay_notified").insert({ key: sk });
        if (!error) claimed.set(sk, rows);
      }
      if (claimed.size) {
        status.lastChange = new Date().toISOString();
        shows = claimed.size;
        await rememberAlerts(claimed.values());          // so the fast path won't repeat these
        sentTo = await broadcast(claimed, status);
      }
    }
  }
  await kvSet("snapshot", fresh);
  status.sent = (status.sent ?? 0) + sentTo + fast.sent;
  await kvSet("status", status);
  return { checked: true, hot, fastShows: fast.shows, newShows: shows, sent: sentTo + fast.sent };
}

// was this result already announced (by either path)? same circuit, same
// date, and this corps was in what went out
function announced(recent: any[], r: Row) {
  const me = norm(r.corps);
  return recent.some((f) => f.circuit === r.circuit && f.date === r.date && f.corps.includes(me));
}

function deepLink(r: Row, favCorps?: string) {
  const y = (r.date || "").slice(0, 4);
  if (r.circuit === "wgi") return `${SITE}#/wgi/events?y=${y}`;
  return `${SITE}#/go?y=${y}&d=${encodeURIComponent(r.date)}&e=${encodeURIComponent(r.event)}` +
    (favCorps ? `&c=${encodeURIComponent(favCorps)}` : "");
}

async function broadcast(shows: Map<string, Row[]>, status: any): Promise<number> {
  await keys();
  const { data: subs } = await db.from("push_subs").select("endpoint, sub, user_id, favs, favs_only, classes, circuits");
  const plus = new Set<string>();
  const uids = [...new Set((subs ?? []).map((s) => s.user_id).filter(Boolean))];
  for (const u of uids) if (await isPlus(u)) plus.add(u);

  let sent = 0;
  const gone: string[] = [];
  const jobs: Promise<unknown>[] = [];
  for (const s of subs ?? []) {
    const circuits = new Set<string>(Array.isArray(s.circuits) ? s.circuits : ["dci", "wgi"]);
    const cls = Array.isArray(s.classes) ? new Set<string>(s.classes) : null;
    const favs: string[] = Array.isArray(s.favs) ? s.favs : [];
    const isPlusSub = s.user_id && plus.has(s.user_id);
    for (const [, rows] of shows) {
      const r0 = rows[0];
      if (!circuits.has(r0.circuit)) continue;
      // a pick is a DCI class ("World Class") or a whole WGI division
      // ("wgi:Percussion" = every Percussion class)
      const fr = cls ? rows.filter((r) => cls.has(r.cls) ||
        (r.circuit === "wgi" && cls.has("wgi:" + r.cls.split(" · ")[0]))) : rows;
      if (!fr.length) continue;
      const mine = favs.map((f) => fr.find((r) => norm(r.corps) === norm(f))).filter(Boolean) as Row[];
      if (s.favs_only && !mine.length) continue;
      const top = [...fr].sort((a, b) => b.score - a.score);
      // Plus: lead with your corps and where they placed. Free: the top 3.
      const lead = isPlusSub && mine.length ? mine : top;
      const body = lead.slice(0, 3).map((r) => {
        const place = top.findIndex((t) => t === r) + 1;
        return `${isPlusSub && mine.includes(r) ? `#${place} ` : ""}${r.corps} ${r.score.toFixed(3)}`;
      }).join(" · ");
      const icon = r0.circuit === "wgi" ? "🎺" : "🥁";
      const payload = JSON.stringify({
        // per class: the tag keeps each class its own notification instead of
        // one class's alert silently replacing another's
        title: `${icon} ${r0.cls} scores in: ${r0.event}`, body,
        url: deepLink(r0, mine[0]?.corps), tag: `cadence-scores:${r0.circuit}:${r0.event}:${r0.cls}`,
      });
      jobs.push(webpush.sendNotification(s.sub, payload, { TTL: 3600, urgency: "high" }).then(
        () => { sent++; },
        (err: any) => {
          status.lastPushError = `${new Date().toISOString()} ${err?.statusCode ?? ""} ${err?.message ?? err}`;
          if ([401, 403, 404, 410].includes(err?.statusCode)) gone.push(s.endpoint);
        },
      ));
    }
  }
  await Promise.allSettled(jobs);
  if (gone.length) await db.from("push_subs").delete().in("endpoint", gone);
  return sent;
}

// ------------------------------------------------------------ routes
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  const route = new URL(req.url).pathname.replace(/^.*\/relay/, "") || "/";
  try {
    if (req.method === "GET" && route === "/healthz") return json(req, { ok: true });
    if (req.method === "GET" && route === "/vapid") return json(req, { key: (await keys()).publicKey });
    if (req.method === "GET" && route === "/status") {
      const st = (await kvGet<any>("status")) ?? {};
      const { count } = await db.from("push_subs").select("*", { count: "exact", head: true });
      return json(req, { ok: true, subscribers: count ?? 0, lastCheck: st.lastCheck ?? null,
        lastChange: st.lastChange ?? null, showDay: !!st.showDay, hot: !!st.hot,
        lastFast: st.lastFast ?? null, sent: st.sent ?? 0,
        lastPushError: st.lastPushError ?? null });
    }
    if (req.method !== "POST") return json(req, { error: "not_found" }, 404);
    const raw = await req.text();
    if (raw.length > 64 * 1024) return json(req, { error: "too_large" }, 413);
    const body = raw ? JSON.parse(raw) : {};

    if (route === "/check") return json(req, await check(false));

    if (route === "/subscribe") {
      const sub = body.subscription;
      if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth)
        return json(req, { error: "bad_subscription" }, 400);
      const strs = (v: unknown, n: number) =>
        Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.length < 120).slice(0, n) : null;
      const uid = await userOf(req);
      const row: Record<string, unknown> = {
        endpoint: sub.endpoint, sub, favs: strs(body.favs, 50) ?? [], favs_only: !!body.favsOnly,
        classes: strs(body.classes, 60), updated_at: new Date().toISOString(),
      };
      const circuits = strs(body.circuits, 2)?.filter((c) => c === "dci" || c === "wgi");
      if (circuits?.length) row.circuits = circuits;
      if (uid) row.user_id = uid;
      const { error } = await db.from("push_subs").upsert(row);
      if (error) return json(req, { error: "store_failed" }, 500);
      return json(req, { ok: true });
    }
    if (route === "/unsubscribe") {
      if (typeof body.endpoint !== "string") return json(req, { error: "bad_endpoint" }, 400);
      await db.from("push_subs").delete().eq("endpoint", body.endpoint);
      return json(req, { ok: true });
    }
    if (route === "/test") {
      // only an endpoint that is already registered can be pinged
      const { data } = await db.from("push_subs").select("sub").eq("endpoint", body.endpoint ?? "").maybeSingle();
      if (!data) return json(req, { error: "unknown_endpoint" }, 404);
      await keys();
      const delay = Math.min(Math.max(+body.delay || 0, 0), 15000);
      await new Promise((r) => setTimeout(r, delay));
      await webpush.sendNotification(data.sub, JSON.stringify({
        title: "Cadence alerts are on", body: "You'll get a ping the moment new scores post.",
        url: SITE, tag: "cadence-test",
      }), { TTL: 600 });
      return json(req, { ok: true });
    }
    return json(req, { error: "not_found" }, 404);
  } catch (e) {
    return json(req, { error: String((e as Error)?.message ?? e).slice(0, 200) }, 500);
  }
});
