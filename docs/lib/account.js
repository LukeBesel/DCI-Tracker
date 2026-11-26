/* Cadence accounts — optional sign-in, cross-device sync, Cadence+ status.
   window.CadAccount. Framework-free and library-free: it talks to Supabase
   Auth (GoTrue) and PostgREST over plain fetch, so there is no SDK download
   and nothing changes for anyone who never signs in.

   Sync model: the app keeps reading and writing localStorage exactly as
   before. When signed in, writes to the keys in SYNC are noticed and pushed
   (debounced) to the user's own rows; on sign-in the remote copy is merged
   in. Row-level security means a token can only ever touch its own rows. */
(function () {
  "use strict";
  var cfg = window.CadConfig || {};
  var URL_ = (cfg.SUPABASE_URL || "").replace(/\/+$/, "");
  var KEY = cfg.SUPABASE_KEY || "";
  var STORE = "cad-session";
  var PLUS_CACHE = "cad-plus";
  // preference keys that follow the account (favorites have their own table)
  var SYNC = ["cad-theme", "cad-fontsize", "cad-corps-theme", "cad-corps-css", "cad-corps-bar",
    "cad-corps-custom", "cad-notify-scope", "cad-notify-classes", "cad-notify-preds", "cad-onboard"];
  var FAVS = "cad-favs";
  var listeners = [];
  var session = load();
  var syncing = false, pushTimer = null;

  function enabled() { return !!(URL_ && KEY); }
  function load() { try { return JSON.parse(localStorage.getItem(STORE) || "null"); } catch (e) { return null; } }
  function save(s) {
    session = s;
    try { s ? localStorage.setItem(STORE, JSON.stringify(s)) : localStorage.removeItem(STORE); } catch (e) {}
    emit();
  }
  function emit() { listeners.forEach(function (cb) { try { cb(api.user()); } catch (e) {} }); }
  function raw(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  // ---- auth calls ---------------------------------------------------------
  async function auth(path, body, method) {
    var r = await fetch(URL_ + "/auth/v1/" + path, {
      method: method || "POST",
      headers: Object.assign({ apikey: KEY, "Content-Type": "application/json" },
        session && method === "PUT" ? { Authorization: "Bearer " + session.access_token } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    var j = {};
    try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error(friendly(j));
    return j;
  }
  function friendly(j) {
    var m = (j && (j.error_description || j.msg || j.message || j.error)) || "Something went wrong";
    if (/invalid login/i.test(m)) return "That email and password don't match.";
    if (/already registered/i.test(m)) return "That email already has an account — sign in instead.";
    if (/rate limit/i.test(m)) return "Too many tries — wait a minute and try again.";
    if (/password should be/i.test(m)) return "Use a password of at least 8 characters.";
    if (/email not confirmed/i.test(m)) return "Confirm your email first — check your inbox for the link.";
    return m;
  }
  function fromToken(j) {
    if (!j || !j.access_token) return null;
    return { access_token: j.access_token, refresh_token: j.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (+j.expires_in || 3600), user: j.user || null };
  }
  async function fresh() {
    if (!session) return null;
    if (session.expires_at - 60 > Date.now() / 1000) return session;
    try {
      var j = await auth("token?grant_type=refresh_token", { refresh_token: session.refresh_token });
      save(fromToken(j));
    } catch (e) {
      // a revoked/expired refresh token ends the session; a network error doesn't
      if (navigator.onLine) save(null);
    }
    return session;
  }

  // ---- data calls (own rows only, enforced by RLS) ------------------------
  async function rest(path, opts) {
    var s = await fresh();
    if (!s) throw new Error("signed out");
    opts = opts || {};
    var r = await fetch(URL_ + "/rest/v1/" + path, {
      method: opts.method || "GET",
      headers: Object.assign({ apikey: KEY, Authorization: "Bearer " + s.access_token,
        "Content-Type": "application/json" }, opts.headers || {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!r.ok) throw new Error("sync " + r.status);
    return r.status === 204 ? null : r.json().catch(function () { return null; });
  }
  async function fn(name, body) {
    var s = await fresh();
    var r = await fetch(URL_ + "/functions/v1/" + name, {
      method: "POST",
      headers: Object.assign({ apikey: KEY, "Content-Type": "application/json" },
        s ? { Authorization: "Bearer " + s.access_token } : {}),
      body: JSON.stringify(body || {}),
    });
    var j = {};
    try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error(j.error === "billing_not_configured"
      ? "Cadence+ checkout isn't open yet — check back soon." : (j.error || "Request failed"));
    return j;
  }

  // ---- sync ---------------------------------------------------------------
  // every synced key, present or not: an absent key is sent as null, so a
  // reset (which removes the key) reaches the account as a reset
  function localPrefs() {
    var o = {};
    SYNC.forEach(function (k) { o[k] = raw(k); });
    return o;
  }
  function localFavs() { try { var v = JSON.parse(raw(FAVS) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } }

  // Two kinds of sync:
  //  merge   — the moment someone signs in on a device. Whatever that device
  //            built up while signed out is folded into the account (union of
  //            favorites; the account's copy wins for settings it has), then
  //            uploaded.
  //  replace — every later app open. The account is the truth: the device
  //            takes its favorites and settings exactly, including removals
  //            and resets made elsewhere, and uploads nothing.
  // Returns whether anything on this device changed.
  async function pull(mode) {
    var uid = api.user() && api.user().id;
    if (!uid) return false;
    syncing = true;
    var changed = false;
    try {
      var prefs = await rest("preferences?select=settings&user_id=eq." + uid);
      var remote = (prefs && prefs[0] && prefs[0].settings) || {};
      var fresh = Object.keys(remote).length === 0;        // account never synced yet
      SYNC.forEach(function (k) {
        var has = Object.prototype.hasOwnProperty.call(remote, k);
        if (mode === "merge" && (fresh || !has || remote[k] == null)) return;   // keep this device's
        if (!has && mode === "replace" && fresh) return;
        var want = has ? remote[k] : null, cur = raw(k);
        if (want === cur) return;
        try { want == null ? localStorage.removeItem(k) : localStorage.setItem(k, want); changed = true; } catch (e) {}
      });
      var favRows = await rest("favorites?select=name,position&circuit=eq.dci&order=position");
      var rf = (favRows || []).map(function (r) { return r.name; });
      var lf = localFavs();
      var next = mode === "merge" ? rf.concat(lf.filter(function (n) { return rf.indexOf(n) < 0; }))
        : (fresh && !rf.length ? lf : rf);
      if (JSON.stringify(next) !== JSON.stringify(lf)) {
        try { localStorage.setItem(FAVS, JSON.stringify(next)); changed = true; } catch (e) {}
      }
    } finally { syncing = false; }
    if (mode === "merge") await push();   // the folded-in result becomes the account's
    return changed;
  }
  async function push() {
    var uid = api.user() && api.user().id;
    if (!uid) return;
    await rest("preferences", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
      body: { user_id: uid, settings: localPrefs(), updated_at: new Date().toISOString() } });
    var favs = localFavs();
    await rest("favorites?circuit=eq.dci", { method: "DELETE" });
    if (favs.length) await rest("favorites", { method: "POST",
      body: favs.map(function (n, i) { return { user_id: uid, circuit: "dci", name: n, position: i }; }) });
  }
  function schedulePush() {
    if (syncing || !session) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { push().catch(function () {}); }, 1500);
  }
  // notice the app's own writes without touching every call site
  try {
    var orig = Storage.prototype.setItem, origRm = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (k, v) {
      orig.call(this, k, v);
      if (this === window.localStorage && (k === FAVS || SYNC.indexOf(k) >= 0)) schedulePush();
    };
    Storage.prototype.removeItem = function (k) {
      origRm.call(this, k);
      if (this === window.localStorage && (k === FAVS || SYNC.indexOf(k) >= 0)) schedulePush();
    };
  } catch (e) {}

  // ---- Cadence+ -----------------------------------------------------------
  function plusCached() {
    try {
      var c = JSON.parse(raw(PLUS_CACHE) || "null");
      return !!(c && c.uid === (api.user() || {}).id && c.active && (!c.until || c.until > Date.now() - 3 * 864e5));
    } catch (e) { return false; }
  }
  async function refreshPlus() {
    if (!session) { try { localStorage.removeItem(PLUS_CACHE); } catch (e) {} emit(); return false; }
    try {
      var rows = await rest("subscriptions?select=status,current_period_end,cancel_at_period_end");
      var s = rows && rows[0];
      var active = !!(s && (s.status === "active" || s.status === "trialing"));
      var until = s && s.current_period_end ? Date.parse(s.current_period_end) : 0;
      localStorage.setItem(PLUS_CACHE, JSON.stringify({ uid: api.user().id, active: active, until: until,
        cancel: !!(s && s.cancel_at_period_end), status: (s && s.status) || "none" }));
    } catch (e) { /* offline: keep the cached answer */ }
    emit();
    return plusCached();
  }

  // ---- redirects back from Google / password reset ------------------------
  // GoTrue returns tokens in the URL fragment (redirect_to is the bare site
  // URL, so the fragment is only the tokens); this app routes on the fragment
  // too, so read them before the router does and hand it a route.
  var pendingRecovery = false;
  (function catchRedirect() {
    var h = location.hash || "";
    if (!/access_token=|error_description=/.test(h)) return;
    var p = new URLSearchParams(h.replace(/^#\/?/, ""));
    if (p.get("access_token")) {
      save({ access_token: p.get("access_token"), refresh_token: p.get("refresh_token"),
        expires_at: Math.floor(Date.now() / 1000) + (+p.get("expires_in") || 3600), user: null });
      pendingRecovery = p.get("type") === "recovery";
    }
    history.replaceState(null, "", location.pathname + location.search + "#/account" +
      (p.get("error_description") ? "?err=" + encodeURIComponent(p.get("error_description")) : ""));
  })();

  async function loadUser() {
    var s = await fresh();
    if (!s) return null;
    try {
      var r = await fetch(URL_ + "/auth/v1/user", { headers: { apikey: KEY, Authorization: "Bearer " + s.access_token } });
      if (r.ok) { s.user = await r.json(); save(s); }
    } catch (e) {}
    return s.user;
  }

  var api = {
    enabled: enabled,
    user: function () {
      var u = session && session.user;
      return u ? { id: u.id, email: u.email, name: (u.user_metadata || {}).full_name || (u.user_metadata || {}).name || "",
        avatar: (u.user_metadata || {}).avatar_url || "", provider: (u.app_metadata || {}).provider || "email" } : null;
    },
    signedIn: function () { return !!session; },
    recovering: function () { return pendingRecovery; },
    onChange: function (cb) { listeners.push(cb); },
    token: async function () { var s = await fresh(); return s && s.access_token; },

    signUp: async function (email, password) {
      var j = await auth("signup?redirect_to=" + encodeURIComponent(cfg.BASE_URL), { email: email, password: password });
      var s = fromToken(j);
      if (s) { save(s); await api.afterSignIn(); return { signedIn: true }; }
      return { confirm: true };     // email confirmation is on: check your inbox
    },
    signIn: async function (email, password) {
      save(fromToken(await auth("token?grant_type=password", { email: email, password: password })));
      await api.afterSignIn();
    },
    google: function () {
      location.href = URL_ + "/auth/v1/authorize?provider=google&redirect_to=" +
        encodeURIComponent(cfg.BASE_URL);
    },
    resetPassword: function (email) {
      return auth("recover?redirect_to=" + encodeURIComponent(cfg.BASE_URL), { email: email });
    },
    setPassword: async function (password) {
      await fresh();
      await auth("user", { password: password }, "PUT");
      pendingRecovery = false;
    },
    signOut: async function () {
      try { await fetch(URL_ + "/auth/v1/logout", { method: "POST",
        headers: { apikey: KEY, Authorization: "Bearer " + (session && session.access_token) } }); } catch (e) {}
      try { localStorage.removeItem(PLUS_CACHE); } catch (e) {}
      save(null);
    },
    deleteAccount: function () { return fn("account-delete").then(function () { save(null); }); },
    afterSignIn: async function () {
      await loadUser();
      var changed = false;
      try { changed = await pull("merge"); } catch (e) {}
      await refreshPlus();
      if (window.CadPush && CadPush.resync) CadPush.resync();   // link alerts to the account
      return changed;
    },

    // Cadence+
    plus: function () { return session ? plusCached() : false; },
    plusInfo: function () { try { return JSON.parse(raw(PLUS_CACHE) || "null"); } catch (e) { return null; } },
    refreshPlus: refreshPlus,
    checkout: async function () { var j = await fn("plus-checkout", { return_url: cfg.BASE_URL }); location.href = j.url; },
    portal: async function () { var j = await fn("plus-portal", { return_url: cfg.BASE_URL + "#/settings" }); location.href = j.url; },
  };
  window.CadAccount = api;

  // returning visitor: refresh the profile, sync and Plus status quietly
  if (session && enabled()) {
    // The app has already read favorites and settings into memory by now, so
    // if the account changed anything, reload once to show it (and so the
    // stale in-memory copy can never be written back over it). The guard
    // stops a reload loop if storage is failing.
    var boot = function () {
      loadUser().then(function (u) { return u ? pull("replace") : false; }).then(function (changed) {
        var k = "cad-sync-reloaded";
        if (changed && !sessionStorage.getItem(k)) { sessionStorage.setItem(k, "1"); location.reload(); return; }
        sessionStorage.removeItem(k);
        return refreshPlus();
      }).catch(function () {});
    };
    if (document.readyState === "complete") setTimeout(boot, 0); else addEventListener("load", boot);
  }
})();
