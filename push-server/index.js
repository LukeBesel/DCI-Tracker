/* Cadence push relay.
   Polls the published site data every couple of minutes; when new scores
   appear, sends one Web Push to every subscriber (personalized with their
   favorite corps' scores when possible).

   Deploy: Railway (or any Node host). PORT is provided by the platform.
   Persistence: attach a volume and it lands in RAILWAY_VOLUME_MOUNT_PATH;
   without one, keys/subs live in ./data (survive restarts, not redeploys —
   set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars to pin keys forever). */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import webpush from "web-push";

const VERSION = 11; // bump on every behavior change — /status shows what's really deployed
const SITE = process.env.SITE_URL || "https://lukebesel.github.io/DCI-Tracker/";
const PORT = process.env.PORT || 8787;
const POLL_MS = +(process.env.POLL_SECONDS || 60) * 1000;
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || "./data";
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---- VAPID keys: env > saved > freshly generated ----
const keyFile = path.join(DATA_DIR, "vapid.json");
let keys;
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
} else if (fs.existsSync(keyFile)) {
  keys = JSON.parse(fs.readFileSync(keyFile, "utf8"));
} else {
  keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(keyFile, JSON.stringify(keys));
  console.log("generated new VAPID keys -> " + keyFile);
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:lucasbesel41@gmail.com",
  keys.publicKey, keys.privateKey);

// ---- subscriptions ----
const subsFile = path.join(DATA_DIR, "subs.json");
let subs = new Map(); // endpoint -> {sub, favs}
try {
  for (const s of JSON.parse(fs.readFileSync(subsFile, "utf8"))) subs.set(s.sub.endpoint, s);
} catch {}
const saveSubs = () => {
  try { fs.writeFileSync(subsFile, JSON.stringify([...subs.values()])); }
  catch (e) { console.error("saveSubs failed:", e.message); }
};

// ---- score watching ----
// the baseline persists on the volume: a restart mid-show can't blind the
// relay to scores that posted while it was rebooting
const stateFile = path.join(DATA_DIR, "state.json");
let lastState = null;   // corps -> "date|event|score" per class
try { lastState = new Map(JSON.parse(fs.readFileSync(stateFile, "utf8"))); } catch {}
const saveState = () => {
  try { fs.writeFileSync(stateFile, JSON.stringify([...lastState])); }
  catch (e) { console.error("saveState failed:", e.message); }
};
let status = { lastCheck: null, lastChange: null, lastError: null, sent: 0 };
let relayBucket = 10, relayStamp = Date.now(); // token bucket for /fetch

// read score data from raw.githubusercontent, not the Pages CDN: raw reflects
// a new-scores commit the instant the pipeline pushes it (GitHub purges raw's
// cache on push), so alerts fire ~1-2 min sooner than waiting for Pages to
// finish deploying. Falls back to SITE if RAW_URL is cleared.
const RAW = process.env.RAW_URL || "https://raw.githubusercontent.com/LukeBesel/DCI-Tracker/main/docs/";
async function fetchJson(p) {
  // unique query per poll so nothing serves a stale body
  const r = await fetch(`${RAW}${p}?cb=${Date.now()}`, { headers: { "cache-control": "no-cache" } });
  if (!r.ok) throw new Error(p + " " + r.status);
  return r.json();
}

function snapshot(rk) {
  const state = new Map();
  for (const [cls, block] of Object.entries(rk.standings || {})) {
    for (const row of block.rows || []) {
      state.set(cls + "|" + row.corps, `${row.date}|${row.event}|${row.score}`);
    }
  }
  return state;
}

async function check() {
  try {
    const rk = await fetchJson("data/rankings.json");
    status.lastCheck = new Date().toISOString();
    const state = snapshot(rk);
    if (lastState) {
      // which events produced new scores since last look?
      const events = new Map(); // "event|date" -> [{corps, score, cls}]
      for (const [key, val] of state) {
        if (lastState.get(key) === val) continue;
        const parts = key.split("|");
        const cls = parts[0];                       // state key is "class|corps"
        const corps = parts.slice(1).join("|");
        const [date, event, score] = val.split("|");
        const ek = event + "|" + date;
        if (!events.has(ek)) events.set(ek, []);
        events.get(ek).push({ corps, score: +score, cls });
      }
      if (events.size) {
        status.lastChange = new Date().toISOString();
        await broadcast(events);
      }
    }
    lastState = state;
    saveState();
  } catch (e) {
    status.lastError = `${new Date().toISOString()} ${e.message}`;
  }
}

async function broadcast(events) {
  const jobs = [];
  for (const { sub, favs, favsOnly, classes } of subs.values()) {
    // class filter: null/absent = every class; an array = only those picked
    const clsSet = Array.isArray(classes) ? new Set(classes) : null;
    const myEvents = [];
    for (const [ek, rows] of events) {
      const fr = clsSet ? rows.filter(r => clsSet.has(r.cls)) : rows;
      if (fr.length) myEvents.push([ek, fr]);
    }
    if (!myEvents.length) continue; // nothing in the classes they follow
    const myRows = myEvents.flatMap(([, rows]) => rows);
    // favorites-only: skip unless one of their corps is in this batch
    if (favsOnly) {
      const favSet = new Set(favs || []);
      if (!myRows.some(r => favSet.has(r.corps))) continue;
    }
    const names = myEvents.map(([k]) => k.split("|")[0]);
    const title = names.length === 1 ? `🥁 Scores in: ${names[0]}` : `🥁 New scores: ${names.length} shows`;
    const leads = myEvents.map(([, rows]) => {
      const s = [...rows].sort((a, b) => b.score - a.score);
      return `${s[0].corps} ${s[0].score.toFixed(3)}${s[1] ? `, ${s[1].corps} ${s[1].score.toFixed(3)}` : ""}`;
    });
    // favorites first: if one of the subscriber's corps scored, lead with it
    let body = leads.slice(0, 3).join(" · ");
    const mine = (favs || []).map(f => myRows.find(r => r.corps === f)).filter(Boolean);
    if (mine.length) {
      body = mine.slice(0, 3).map(r => `${r.corps} ${r.score.toFixed(3)}`).join(" · ")
        + (names.length ? ` — ${names[0]}` : "");
    }
    const payload = JSON.stringify({ title, body, url: SITE, tag: "cadence-scores" });
    jobs.push(webpush.sendNotification(sub, payload).then(
      () => { status.sent++; },
      err => {
        status.lastPushError = `${new Date().toISOString()} ${err.statusCode || ""} ${err.message}`;
        if ([401, 403, 404, 410].includes(err.statusCode)) {
          subs.delete(sub.endpoint); // gone, or bound to a rotated key
        }
      }));
  }
  await Promise.allSettled(jobs);
  saveSubs();
  console.log(`pushed to ${jobs.length} subscribers`);
}

// Adaptive cadence: poll hard on show days (a show today or last night, for
// late West-Coast results) so a score drop pushes within ~25s of the commit;
// idle the rest of the time. showToday is refreshed from the upcoming feed.
let showToday = false;
const SHOW_POLL = 25_000, IDLE_POLL = 120_000;
async function refreshShowFlag() {
  try {
    const up = await fetchJson("data/upcoming.json");
    const day = ms => new Date(ms).toISOString().slice(0, 10);
    const now = Date.now();
    const days = new Set([day(now), day(now - 864e5)]);
    showToday = Array.isArray(up) && up.some(e => days.has(e.date));
  } catch (e) { /* keep prior flag */ }
}
(async function poll() {
  await check();
  setTimeout(poll, showToday ? SHOW_POLL : IDLE_POLL);
})();
refreshShowFlag();
setInterval(refreshShowFlag, 15 * 60 * 1000);

// ---- tiny HTTP API ----
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
const send = (res, code, obj) =>
  res.writeHead(code, { "content-type": "application/json", ...CORS }).end(JSON.stringify(obj));

// a bad request or disk hiccup must answer 500, never kill the process
process.on("uncaughtException", e => console.error("uncaught:", e));
process.on("unhandledRejection", e => console.error("unhandled:", e));

http.createServer(async (req, res) => {
  try {
  if (req.method === "OPTIONS") return res.writeHead(204, CORS).end();
  const url = new URL(req.url, "http://x");
  let body = "";
  for await (const chunk of req) body += chunk;
  let json = {};
  try { json = body ? JSON.parse(body) : {}; } catch {}

  if (req.method === "GET" && url.pathname === "/") {
    // humans who click the relay's URL should land on the app itself
    return res.writeHead(302, { Location: SITE, ...CORS }).end();
  }
  if (req.method === "GET" && url.pathname === "/status") {
    return send(res, 200, { ok: true, service: "cadence-push", version: VERSION,
      volume: !!process.env.RAILWAY_VOLUME_MOUNT_PATH, dataDir: DATA_DIR,
      subscribers: subs.size, ...status });
  }
  if (req.method === "GET" && url.pathname === "/vapid") {
    return send(res, 200, { key: keys.publicKey });
  }
  if (req.method === "GET" && url.pathname === "/fetch") {
    // dci.org-only fetch relay: GitHub's runner IPs started getting a
    // blanket Cloudflare challenge from dci.org, so the scraper routes its
    // reads through this box instead. Hard-restricted to public dci.org
    // pages and rate-limited — this is not a general proxy.
    let target;
    try { target = new URL(url.searchParams.get("url") || ""); } catch {}
    if (!target || target.protocol !== "https:" || target.hostname !== "www.dci.org") {
      return send(res, 400, { error: "only https://www.dci.org/ urls" });
    }
    relayBucket = Math.min(relayBucket + (Date.now() - relayStamp) / 1500, 10);
    relayStamp = Date.now();
    if (relayBucket < 1) {
      return res.writeHead(429, { "retry-after": "5", ...CORS }).end("relay rate limit");
    }
    relayBucket -= 1;
    try {
      const up = await fetch(target, {
        redirect: "follow",
        signal: AbortSignal.timeout(25000),
        headers: { "user-agent": "cadence-relay/1 (+https://github.com/LukeBesel/DCI-Tracker)" },
      });
      const text = await up.text();
      status.lastRelay = `${new Date().toISOString()} ${up.status} ${target.pathname}`;
      const h = { "content-type": up.headers.get("content-type") || "text/html",
        "cache-control": "no-store", ...CORS };
      const ra = up.headers.get("retry-after");
      if (ra) h["retry-after"] = ra;
      const cfm = up.headers.get("cf-mitigated");
      if (cfm) h["cf-mitigated"] = cfm;
      return res.writeHead(up.status, h).end(text);
    } catch (e) {
      status.lastRelay = `${new Date().toISOString()} ERR ${e.message}`;
      return res.writeHead(502, CORS).end("relay fetch failed: " + e.message);
    }
  }
  if (req.method === "POST" && url.pathname === "/subscribe") {
    const sub = json.subscription;
    if (!sub || !sub.endpoint) return send(res, 400, { error: "subscription required" });
    subs.set(sub.endpoint, {
      sub,
      favs: Array.isArray(json.favs) ? json.favs.slice(0, 30) : [],
      favsOnly: !!json.favsOnly,
      classes: Array.isArray(json.classes) ? json.classes.slice(0, 8) : null,
    });
    saveSubs();
    return send(res, 200, { ok: true, subscribers: subs.size });
  }
  if (req.method === "POST" && url.pathname === "/unsubscribe") {
    if (json.endpoint) { subs.delete(json.endpoint); saveSubs(); }
    return send(res, 200, { ok: true, subscribers: subs.size });
  }
  if (req.method === "POST" && url.pathname === "/test") {
    const entry = json.endpoint && subs.get(json.endpoint);
    if (!entry) return send(res, 404, { error: "not subscribed" });
    // a short delay lets the user leave the app first — iOS won't banner a
    // push that lands while the app is in the foreground
    const delay = Math.min(Math.max(+json.delay || 0, 0), 30000);
    setTimeout(async () => {
      try {
        await webpush.sendNotification(entry.sub, JSON.stringify({
          title: "🥁 Cadence test", body: "Score alerts are working — you're all set.", url: SITE,
          tag: "cadence-test",
        }));
        status.sent++;
      } catch (e) {
        status.lastPushError = `${new Date().toISOString()} ${e.statusCode || ""} ${e.message}`;
        if ([401, 403, 404, 410].includes(e.statusCode)) { subs.delete(entry.sub.endpoint); saveSubs(); }
      }
    }, delay);
    return send(res, 200, { ok: true, queued: true, delay });
  }
  send(res, 404, { error: "not found" });
  } catch (e) {
    console.error("request failed:", e.message);
    try { send(res, 500, { error: "internal" }); } catch (e2) {}
  }
}).listen(PORT, () => console.log(`cadence-push on :${PORT} — watching ${SITE}`));
