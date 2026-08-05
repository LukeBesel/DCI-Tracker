/* Cadence — Daily Recaps.
   A self-contained module that turns the season data into a "what happened
   today" recap for any show day: every show's results plus fun facts (top
   score, biggest movers, new season highs, who passed whom in the standings,
   closest finish). It auto-pops the latest show day's recap the same night once
   scores are in, and a calendar button opens a searchable browser of every show
   day, every season.

   Namespaced (.rc-* / cad-rc-* localStorage / window.CadRecap) and reuses the
   app's CSS variables, so it follows the viewer's light/dark (and corps) theme.
   Reads only the static season JSON the app already ships — no backend. */
(function () {
  "use strict";

  var TZ = "America/New_York";      // scores + show days are Eastern
  var SCORES_IN_HOUR = 22;          // "same night once scores are in": ET hour after which today's show day is eligible to auto-pop (10pm)
  var DATA = "data/";

  // ---- date helpers ----------------------------------------------------------
  function etParts(d) {
    var f = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false });
    var o = {}; f.formatToParts(d || new Date()).forEach(function (p) { o[p.type] = p.value; });
    return o;
  }
  function todayET() { var p = etParts(new Date()); return p.year + "-" + p.month + "-" + p.day; }
  function hourET() { return parseInt(etParts(new Date()).hour, 10) || 0; }
  function prettyDate(ds) {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" })
        .format(new Date(ds + "T12:00:00Z"));
    } catch (e) { return ds; }
  }
  function shortDate(ds) {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })
        .format(new Date(ds + "T12:00:00Z"));
    } catch (e) { return ds; }
  }

  // ---- localStorage ----------------------------------------------------------
  function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lset(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  function reduceMotion() { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function fmt(n) { return n == null ? "—" : (Math.round(n * 1000) / 1000).toFixed(3); }
  function signed(n) { return (n > 0 ? "+" : "") + (Math.round(n * 1000) / 1000).toFixed(3); }

  // ---- data ------------------------------------------------------------------
  var yearCache = {}, metaP = null;
  function loadYear(year) {
    if (yearCache[year]) return yearCache[year];
    return (yearCache[year] = fetch(DATA + "seasons/" + year + ".json?cb=" + Date.now(), { headers: { "cache-control": "no-cache" } })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .catch(function () { yearCache[year] = null; return null; }));
  }
  function loadYears() {
    return metaP || (metaP = fetch(DATA + "meta.json?cb=" + Date.now(), { headers: { "cache-control": "no-cache" } })
      .then(function (r) { return r.json(); })
      .then(function (m) { return ((m && m.seasons) || []).map(function (s) { return s.year; }).filter(Boolean).sort(function (a, b) { return b - a; }); })
      .catch(function () { return []; }));
  }

  // ---- recap computation -----------------------------------------------------
  function scoredShowDays(evs) {
    var s = {};
    (evs || []).forEach(function (e) {
      if (e.date && (e.classes || []).some(function (c) { return (c.results || []).some(function (r) { return r.score != null; }); })) s[e.date] = 1;
    });
    return Object.keys(s).sort();
  }

  // history of every corps' scores across the season, in date order
  function buildHistory(evs) {
    var hist = {};
    (evs || []).slice().sort(byDate).forEach(function (e) {
      (e.classes || []).forEach(function (c) {
        (c.results || []).forEach(function (r) {
          if (r.score == null) return;
          (hist[r.corps] = hist[r.corps] || []).push({ date: e.date, score: r.score, event: e.name, cls: c.class });
        });
      });
    });
    return hist;
  }
  function byDate(a, b) { return (a.date || "") < (b.date || "") ? -1 : (a.date || "") > (b.date || "") ? 1 : 0; }

  function recapForDate(evs, date) {
    var hist = buildHistory(evs);
    var priorRows = function (corps) { return (hist[corps] || []).filter(function (x) { return x.date < date; }); };
    var priorScore = function (corps) { var h = priorRows(corps); return h.length ? h[h.length - 1] : null; };
    var priorBest = function (corps) { var h = priorRows(corps); return h.length ? Math.max.apply(null, h.map(function (x) { return x.score; })) : null; };

    var shows = (evs || []).filter(function (e) {
      return e.date === date && (e.classes || []).some(function (c) { return (c.results || []).some(function (r) { return r.score != null; }); });
    }).map(function (e) {
      return {
        name: e.name, location: e.location, url: e.url, recap_url: e.recap_url,
        classes: (e.classes || []).map(function (c) {
          return { cls: c.class, results: (c.results || []).filter(function (r) { return r.score != null; })
            .slice().sort(function (a, b) { return (a.place || 99) - (b.place || 99) || b.score - a.score; }) };
        }).filter(function (c) { return c.results.length; })
      };
    });

    // every row that competed today
    var rows = [];
    shows.forEach(function (s) { s.classes.forEach(function (c) { c.results.forEach(function (r) { rows.push({ corps: r.corps, score: r.score, place: r.place, event: s.name, cls: c.cls }); }); }); });

    // top score of the day
    var topScore = null;
    rows.forEach(function (r) { if (!topScore || r.score > topScore.score) topScore = r; });

    // biggest movers vs their previous outing
    var movers = rows.map(function (r) {
      var p = priorScore(r.corps);
      return p ? { corps: r.corps, score: r.score, prev: p.score, delta: +(r.score - p.score).toFixed(3), event: r.event } : null;
    }).filter(Boolean).sort(function (a, b) { return b.delta - a.delta; });

    // new season highs (beat everything they'd done before, and had a before)
    var highs = rows.filter(function (r) { var pb = priorBest(r.corps); return pb != null && r.score > pb + 1e-9; })
      .map(function (r) { return { corps: r.corps, score: r.score, event: r.event }; })
      .sort(function (a, b) { return b.score - a.score; });
    // one entry per corps
    var seenHigh = {}; highs = highs.filter(function (h) { if (seenHigh[h.corps]) return false; return (seenHigh[h.corps] = 1); });

    // who passed whom: within each class, a corps that finished ahead of one it
    // trailed at their most recent previous shared show
    var passed = [], pk = {};
    shows.forEach(function (s) {
      s.classes.forEach(function (c) {
        var rs = c.results;
        for (var i = 0; i < rs.length; i++) for (var j = i + 1; j < rs.length; j++) {
          var A = rs[i].corps, B = rs[j].corps; // A finished ahead of B today
          var ha = priorRows(A), hb = priorRows(B);
          var bByDate = {}; hb.forEach(function (x) { bByDate[x.date] = Math.max(bByDate[x.date] || -1, x.score); });
          var common = ha.filter(function (x) { return bByDate[x.date] != null; });
          if (!common.length) continue;
          var last = common[common.length - 1];
          if (bByDate[last.date] > last.score + 1e-9) { // B was ahead then, A is ahead now
            var key = A + "|" + B; if (pk[key]) continue; pk[key] = 1;
            passed.push({ a: A, b: B, cls: c.cls, event: s.name, worldish: /world/i.test(c.cls || "") });
          }
        }
      });
    });
    passed.sort(function (a, b) { return (b.worldish - a.worldish); });

    // closest finish (smallest adjacent margin within a class)
    var closest = null;
    shows.forEach(function (s) { s.classes.forEach(function (c) {
      for (var i = 1; i < c.results.length; i++) {
        var g = +(c.results[i - 1].score - c.results[i].score).toFixed(3);
        if (g >= 0 && (!closest || g < closest.gap)) closest = { a: c.results[i - 1].corps, b: c.results[i].corps, gap: g, event: s.name, cls: c.cls };
      }
    }); });

    return {
      date: date, pretty: prettyDate(date), shows: shows,
      corpsCount: Object.keys(rows.reduce(function (o, r) { o[r.corps] = 1; return o; }, {})).length,
      facts: { topScore: topScore, movers: movers.slice(0, 3), highs: highs.slice(0, 6), passed: passed.slice(0, 4), closest: closest }
    };
  }

  // ---- styles ----------------------------------------------------------------
  function injectStyles() {
    if (document.getElementById("rc-style")) return;
    var css = [
      ".rc-overlay{position:fixed;inset:0;z-index:2900;display:flex;align-items:center;justify-content:center;padding:16px;}",
      ".rc-backdrop{position:absolute;inset:0;background:rgba(8,20,38,.62);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);}",
      ".rc-card{position:relative;z-index:3;width:100%;max-width:460px;max-height:92vh;display:flex;flex-direction:column;background:var(--surface-1);color:var(--text-primary);border:1px solid var(--border);border-radius:20px;box-shadow:0 24px 70px rgba(8,20,38,.5);overflow:hidden;animation:rc-pop .3s cubic-bezier(.2,.9,.3,1.2) both;}",
      "@keyframes rc-pop{from{opacity:0;transform:translateY(12px) scale(.97);}to{opacity:1;transform:none;}}",
      "@media (prefers-reduced-motion: reduce){.rc-card{animation:none;}}",
      ".rc-head{position:relative;background:var(--navy);color:#fff;padding:20px 20px 16px;}",
      ".rc-x{position:absolute;top:10px;right:10px;width:34px;height:34px;border:0;border-radius:50%;background:rgba(255,255,255,.14);color:#fff;font-size:20px;line-height:1;cursor:pointer;display:grid;place-items:center;}",
      ".rc-x:hover{background:rgba(255,255,255,.26);}",
      ".rc-eyebrow{font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:var(--gold);}",
      ".rc-title{font-size:23px;line-height:1.1;font-weight:900;letter-spacing:-.4px;margin:6px 40px 0 0;color:#fff;}",
      ".rc-sub{font-size:12.5px;color:rgba(255,255,255,.8);margin-top:4px;}",
      ".rc-body{padding:16px 18px 18px;overflow-y:auto;-webkit-overflow-scrolling:touch;}",
      ".rc-sech{font-size:12px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--muted);margin:14px 2px 8px;}",
      ".rc-facts{display:flex;flex-direction:column;gap:8px;}",
      ".rc-fact{display:flex;gap:11px;align-items:flex-start;background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:11px 13px;}",
      ".rc-fico{font-size:20px;line-height:1.2;flex:0 0 auto;}",
      ".rc-ft{font-size:14px;line-height:1.4;color:var(--text-primary);}",
      ".rc-ft b{font-weight:800;}",
      ".rc-ft .rc-num{font-variant-numeric:tabular-nums;font-weight:800;}",
      ".rc-ft .rc-up{color:var(--good);font-weight:800;}",
      ".rc-ftk{font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:var(--muted);margin-bottom:2px;}",
      ".rc-show{border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:10px;}",
      ".rc-showh{background:var(--surface-2);padding:10px 13px;}",
      ".rc-showh b{font-size:14px;font-weight:800;color:var(--text-primary);}",
      ".rc-showh span{display:block;font-size:12px;color:var(--muted);margin-top:1px;}",
      ".rc-clsh{font-size:10.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);padding:8px 13px 2px;}",
      ".rc-row{display:flex;align-items:center;gap:10px;padding:6px 13px;font-size:13.5px;}",
      ".rc-row+.rc-row{border-top:1px solid var(--border);}",
      ".rc-pl{flex:0 0 22px;text-align:center;font-weight:800;color:var(--muted);font-variant-numeric:tabular-nums;}",
      ".rc-cn{flex:1;color:var(--text-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".rc-sc{flex:0 0 auto;font-weight:800;font-variant-numeric:tabular-nums;color:var(--text-primary);}",
      ".rc-dot{flex:0 0 auto;width:9px;height:9px;border-radius:50%;}",
      ".rc-btn{display:block;width:100%;border:0;border-radius:999px;padding:13px 18px;font:inherit;font-size:15px;font-weight:800;cursor:pointer;background:var(--gold);color:#16233d;margin-top:14px;}",
      ".rc-btn:hover{filter:brightness(1.04);}",
      ".rc-morelink{font-size:12.5px;color:var(--link);text-decoration:none;display:inline-block;margin:6px 2px 0;}",
      // browser
      ".rc-tools{display:flex;gap:8px;padding:12px 18px;border-bottom:1px solid var(--border);background:var(--surface-1);flex-wrap:wrap;}",
      ".rc-tools input,.rc-tools select{font:inherit;font-size:13px;padding:8px 10px;border-radius:9px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-primary);}",
      ".rc-tools input{flex:1;min-width:120px;}",
      ".rc-list{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:8px 12px 14px;}",
      ".rc-day{width:100%;text-align:left;display:flex;align-items:center;gap:12px;background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:11px 13px;margin-top:8px;cursor:pointer;font:inherit;color:var(--text-primary);}",
      ".rc-day:hover{border-color:var(--muted);}",
      ".rc-day .rc-dd{flex:1;min-width:0;}",
      ".rc-day .rc-dt{font-size:14px;font-weight:800;}",
      ".rc-day .rc-dm{font-size:12px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".rc-day .rc-dc{flex:0 0 auto;font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;}",
      ".rc-empty{color:var(--muted);text-align:center;padding:30px 16px;font-size:14px;}",
      ".rc-back{background:none;border:0;color:var(--gold);font:inherit;font-size:13px;font-weight:800;cursor:pointer;padding:0;margin-bottom:2px;display:inline-flex;align-items:center;gap:4px;}",
      // top-bar button
      "#rc-topbtn{display:inline-flex;align-items:center;justify-content:center;background:var(--surface-2);color:var(--text-primary);cursor:pointer;border:1px solid var(--border);border-radius:10px;padding:6px;line-height:0;order:1;}",
      "#rc-topbtn:hover{border-color:var(--muted);}",
      "#rc-topbtn svg{width:20px;height:20px;display:block;}"
    ].join("\n");
    var st = document.createElement("style"); st.id = "rc-style"; st.textContent = css; document.head.appendChild(st);
  }

  // ---- overlay plumbing ------------------------------------------------------
  var overlay = null, lastFocus = null;
  function close() {
    if (overlay) { overlay.remove(); overlay = null; }
    document.removeEventListener("keydown", onKey, true);
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }
  function onKey(e) {
    if (!overlay) return;
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "Tab") {
      var f = overlay.querySelectorAll('button, [href], input, select, [tabindex]:not([tabindex="-1"])');
      if (!f.length) return; var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  function shell(innerHtml) {
    injectStyles();
    if (overlay) close();
    lastFocus = document.activeElement;
    overlay = document.createElement("div");
    overlay.className = "rc-overlay";
    overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true"); overlay.setAttribute("aria-label", "Daily recap");
    overlay.innerHTML = '<div class="rc-backdrop"></div><div class="rc-card">' + innerHtml + "</div>";
    overlay.querySelector(".rc-backdrop").addEventListener("click", close);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);
    return overlay.querySelector(".rc-card");
  }

  // corps dot color from the app's shared palette; neutral gold as a fallback
  function dot(corps) {
    try { if (window.CadCorps && window.CadCorps.accent) return window.CadCorps.accent(corps); } catch (e) {}
    return "var(--gold)";
  }

  // ---- render: recap detail --------------------------------------------------
  function factsHtml(f) {
    var out = [];
    if (f.topScore) out.push(fact("🏆", "Top score of the day",
      "<b>" + esc(f.topScore.corps) + "</b> — <span class='rc-num'>" + fmt(f.topScore.score) + "</span> at " + esc(f.topScore.event)));
    (f.passed || []).forEach(function (p) {
      out.push(fact("↗️", "Moved ahead", "<b>" + esc(p.a) + "</b> passed <b>" + esc(p.b) + "</b> <span class='rc-ftk' style='display:inline'>· " + esc(p.cls) + "</span>"));
    });
    (f.movers || []).filter(function (m) { return m.delta > 0.001; }).slice(0, 2).forEach(function (m) {
      out.push(fact("📈", "Biggest jump", "<b>" + esc(m.corps) + "</b> <span class='rc-up'>" + signed(m.delta) + "</span> — " + fmt(m.prev) + " → <span class='rc-num'>" + fmt(m.score) + "</span>"));
    });
    if ((f.highs || []).length) out.push(fact("🔥", "New season high" + (f.highs.length > 1 ? "s" : ""),
      f.highs.map(function (h) { return "<b>" + esc(h.corps) + "</b> " + "<span class='rc-num'>" + fmt(h.score) + "</span>"; }).join(" · ")));
    if (f.closest) out.push(fact("🤏", "Closest finish",
      "<b>" + esc(f.closest.a) + "</b> over <b>" + esc(f.closest.b) + "</b> by <span class='rc-num'>" + fmt(f.closest.gap) + "</span>"));
    return out.length ? '<div class="rc-facts">' + out.join("") + "</div>" : '<p class="rc-empty">Not enough prior scores yet for fun facts — check the results below.</p>';
  }
  function fact(ico, key, txt) {
    return '<div class="rc-fact"><div class="rc-fico">' + ico + '</div><div><div class="rc-ftk">' + esc(key) + '</div><div class="rc-ft">' + txt + "</div></div></div>";
  }
  function showsHtml(shows) {
    return shows.map(function (s) {
      var cls = s.classes.map(function (c) {
        var rows = c.results.slice(0, 12).map(function (r) {
          return '<div class="rc-row"><span class="rc-pl">' + (r.place || "") + '</span>' +
            '<span class="rc-dot" style="background:' + dot(r.corps) + '"></span>' +
            '<span class="rc-cn">' + esc(r.corps) + '</span><span class="rc-sc">' + fmt(r.score) + "</span></div>";
        }).join("");
        var more = c.results.length > 12 ? '<div class="rc-row" style="color:var(--muted)"><span class="rc-pl"></span><span class="rc-cn">+ ' + (c.results.length - 12) + " more</span></div>" : "";
        return (s.classes.length > 1 ? '<div class="rc-clsh">' + esc(c.cls) + "</div>" : "") + rows + more;
      }).join("");
      var loc = s.location ? '<span>' + esc(s.location) + "</span>" : "";
      return '<div class="rc-show"><div class="rc-showh"><b>' + esc(s.name) + "</b>" + loc + "</div>" + cls + "</div>";
    }).join("");
  }
  function openRecap(recap, opts) {
    opts = opts || {};
    var card = shell(
      '<div class="rc-head"><button class="rc-x" type="button" aria-label="Close">×</button>' +
      '<div class="rc-eyebrow">Daily Recap</div>' +
      '<h2 class="rc-title" id="rc-h">' + esc(recap.pretty) + "</h2>" +
      '<div class="rc-sub">' + recap.shows.length + " show" + (recap.shows.length === 1 ? "" : "s") + " · " + recap.corpsCount + " corps</div></div>" +
      '<div class="rc-body">' +
        '<div class="rc-sech">Fun facts</div>' + factsHtml(recap.facts) +
        '<div class="rc-sech">Results</div>' + showsHtml(recap.shows) +
        (opts.browseBtn ? '<button class="rc-btn" id="rc-browse" type="button">Browse all recaps →</button>' : "") +
      "</div>");
    card.querySelector(".rc-x").addEventListener("click", close);
    var bb = card.querySelector("#rc-browse"); if (bb) bb.addEventListener("click", function () { openBrowser(); });
    var x = card.querySelector(".rc-x"); if (x) setTimeout(function () { try { x.focus(); } catch (e) {} }, 30);
  }

  // ---- render: browser -------------------------------------------------------
  var browseState = { year: null, q: "" };
  function openBrowser() {
    var card = shell(
      '<div class="rc-head"><button class="rc-x" type="button" aria-label="Close">×</button>' +
      '<div class="rc-eyebrow">Cadence</div><h2 class="rc-title">Daily Recaps</h2>' +
      '<div class="rc-sub">Every show day, every season</div></div>' +
      '<div class="rc-tools"><select id="rc-year" aria-label="Season"></select>' +
      '<input id="rc-q" type="search" placeholder="Search corps, show, place…" autocomplete="off"></div>' +
      '<div class="rc-list" id="rc-list"><p class="rc-empty">Loading…</p></div>');
    card.querySelector(".rc-x").addEventListener("click", close);
    var sel = card.querySelector("#rc-year"), q = card.querySelector("#rc-q"), list = card.querySelector("#rc-list");
    q.value = browseState.q || "";
    loadYears().then(function (years) {
      if (!years.length) { list.innerHTML = '<p class="rc-empty">Couldn’t load seasons.</p>'; return; }
      if (!browseState.year || years.indexOf(browseState.year) < 0) browseState.year = years[0];
      sel.innerHTML = years.map(function (y) { return '<option value="' + y + '"' + (y === browseState.year ? " selected" : "") + ">" + y + "</option>"; }).join("");
      renderList(list, q.value);
      sel.addEventListener("change", function () { browseState.year = +sel.value; renderList(list, q.value); });
      var t; q.addEventListener("input", function () { clearTimeout(t); browseState.q = q.value; t = setTimeout(function () { renderList(list, q.value); }, 160); });
    });
  }
  function renderList(list, query) {
    list.innerHTML = '<p class="rc-empty">Loading…</p>';
    var year = browseState.year;
    loadYear(year).then(function (evs) {
      if (!evs) { list.innerHTML = '<p class="rc-empty">No data for ' + year + ".</p>"; return; }
      var days = scoredShowDays(evs).slice().reverse(); // newest first
      var qq = (query || "").trim().toLowerCase();
      // index text per day for search
      var byDay = {};
      evs.forEach(function (e) {
        if (!e.date) return;
        var t = (e.name || "") + " " + (e.location || "") + " ";
        (e.classes || []).forEach(function (c) { (c.results || []).forEach(function (r) { t += r.corps + " "; }); });
        byDay[e.date] = (byDay[e.date] || "") + t.toLowerCase();
      });
      var rows = days.filter(function (d) { return !qq || (byDay[d] || "").indexOf(qq) >= 0; }).map(function (d) {
        var evsD = evs.filter(function (e) { return e.date === d && (e.classes || []).some(function (c) { return (c.results || []).length; }); });
        var top = null;
        evsD.forEach(function (e) { (e.classes || []).forEach(function (c) { (c.results || []).forEach(function (r) { if (r.score != null && (!top || r.score > top.score)) top = { corps: r.corps, score: r.score }; }); }); });
        var names = evsD.map(function (e) { return e.name; }).join(" · ");
        return '<button class="rc-day" data-d="' + d + '" type="button"><div class="rc-dd">' +
          '<div class="rc-dt">' + esc(shortDate(d)) + "</div>" +
          '<div class="rc-dm">' + esc(names) + (top ? " — " + esc(top.corps) + " " + fmt(top.score) : "") + "</div></div>" +
          '<div class="rc-dc">' + evsD.length + " show" + (evsD.length === 1 ? "" : "s") + "</div></button>";
      }).join("");
      list.innerHTML = rows || '<p class="rc-empty">No show days match “' + esc(query) + "”.</p>";
      Array.prototype.forEach.call(list.querySelectorAll(".rc-day"), function (b) {
        b.addEventListener("click", function () { openRecap(recapForDate(evs, b.dataset.d), { back: true }); });
      });
    });
  }

  // ---- auto-show + button ----------------------------------------------------
  // The latest show day worth popping: newest scored day this season, but if
  // that day is TODAY it only counts once it's late enough that scores are in.
  function latestEligibleDay(evs) {
    var days = scoredShowDays(evs);
    if (!days.length) return null;
    var last = days[days.length - 1], today = todayET();
    if (last > today) return null;               // future-dated (shouldn't happen)
    if (last === today && hourET() < SCORES_IN_HOUR) return null; // tonight, but scores may still be landing
    return last;
  }
  function maybeAutoShow() {
    // don't stack on top of Championship Mode / the tribute
    if (document.querySelector(".cm-overlay")) return;
    try { if (sessionStorage.getItem("cad-rc-session")) return; } catch (e) {}
    var year = +todayET().slice(0, 4);
    loadYear(year).then(function (evs) {
      if (!evs) return;
      var day = latestEligibleDay(evs);
      if (!day) return;
      if (lget("cad-rc-seen-" + day)) return;      // already saw this day's recap
      if (document.querySelector(".cm-overlay") || overlay) return;
      try { sessionStorage.setItem("cad-rc-session", "1"); } catch (e) {}
      lset("cad-rc-seen-" + day, "1");
      openRecap(recapForDate(evs, day), { browseBtn: true });
    });
  }
  function injectButton() {
    var bar = document.querySelector("header.topbar");
    if (!bar || document.getElementById("rc-topbtn")) return;
    injectStyles();
    var btn = document.createElement("button");
    btn.id = "rc-topbtn"; btn.type = "button";
    btn.title = "Daily recaps"; btn.setAttribute("aria-label", "Open daily recaps");
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/><path d="M7.5 13.5l2 2 3.5-4"/></svg>';
    var gear = document.getElementById("settingsBtn");
    if (gear) bar.insertBefore(btn, gear); else bar.appendChild(btn);
    btn.addEventListener("click", function () { openBrowser(); });
  }

  function init() {
    try { injectButton(); } catch (e) {}
    // let Championship Mode open first so the recap defers to it
    setTimeout(function () { try { maybeAutoShow(); } catch (e) {} }, 0);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.CadRecap = {
    open: openBrowser,
    show: function (year, date) { loadYear(year || +todayET().slice(0, 4)).then(function (evs) { if (evs) openRecap(recapForDate(evs, date || latestEligibleDay(evs)), { browseBtn: true }); }); },
    forDate: recapForDate, close: close
  };
})();
