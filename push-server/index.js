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

const VERSION = 4; // bump on every behavior change — /status shows what's really deployed
const SITE = process.env.SITE_URL || "https://lukebesel.github.io/DCI-Tracker/";
const PORT = process.env.PORT || 8787;
const POLL_MS = +(process.env.POLL_SECONDS || 120) * 1000;
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
const saveSubs = () => fs.writeFileSync(subsFile, JSON.stringify([...subs.values()]));

// ---- score watching ----
let lastState = null;   // corps -> "date|event|score" per class
let status = { lastCheck: null, lastChange: null, lastError: null, sent: 0 };

async function fetchJson(p) {
  // unique query per poll: GitHub Pages' CDN caches for ~10 minutes and
  // ignores request cache-control — a busted URL is always fresh
  const r = await fetch(`${SITE}${p}?cb=${Date.now()}`, { headers: { "cache-control": "no-cache" } });
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
      const events = new Map(); // "event|date" -> [{corps, score}]
      for (const [key, val] of state) {
        if (lastState.get(key) === val) continue;
        const corps = key.split("|").slice(1).join("|");
        const [date, event, score] = val.split("|");
        const ek = event + "|" + date;
        if (!events.has(ek)) events.set(ek, []);
        events.get(ek).push({ corps, score: +score });
      }
      if (events.size) {
        status.lastChange = new Date().toISOString();
        await broadcast(events);
      }
    }
    lastState = state;
  } catch (e) {
    status.lastError = `${new Date().toISOString()} ${e.message}`;
  }
}

async function broadcast(events) {
  const names = [...events.keys()].map(k => k.split("|")[0]);
  const title = names.length === 1 ? `🥁 Scores in: ${names[0]}` : `🥁 New scores: ${names.length} shows`;
  const leads = [];
  for (const [ek, rows] of events) {
    rows.sort((a, b) => b.score - a.score);
    leads.push(`${rows[0].corps} ${rows[0].score.toFixed(3)}${rows[1] ? `, ${rows[1].corps} ${rows[1].score.toFixed(3)}` : ""}`);
  }
  const allRows = [...events.values()].flat();
  const jobs = [];
  for (const { sub, favs } of subs.values()) {
    // favorites first: if one of the subscriber's corps scored, lead with it
    let body = leads.slice(0, 3).join(" · ");
    const mine = (favs || []).map(f => allRows.find(r => r.corps === f)).filter(Boolean);
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
  console.log(`pushed to ${jobs.length} subscribers: ${title}`);
}

setInterval(check, POLL_MS);
check();

// ---- tiny HTTP API ----
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
const send = (res, code, obj) =>
  res.writeHead(code, { "content-type": "application/json", ...CORS }).end(JSON.stringify(obj));

http.createServer(async (req, res) => {
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
  if (req.method === "POST" && url.pathname === "/subscribe") {
    const sub = json.subscription;
    if (!sub || !sub.endpoint) return send(res, 400, { error: "subscription required" });
    subs.set(sub.endpoint, { sub, favs: Array.isArray(json.favs) ? json.favs.slice(0, 30) : [] });
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
}).listen(PORT, () => console.log(`cadence-push on :${PORT} — watching ${SITE}`));
