/* Cadence — shareable image cards ("Wrapped" style).
   Renders a corps' season (or a show day) to a canvas and shares it as a PNG via
   the native share sheet (falls back to a download). Namespaced window.CadWrapped;
   reuses the app's corps colors. No backend — reads the static season JSON. */
(function () {
  "use strict";
  var SITE_URL = "https://lukebesel.github.io/DCI-Tracker";
  var SITE_LABEL = "lukebesel.github.io/DCI-Tracker";

  // ---- color helpers ---------------------------------------------------------
  function hx(s) { s = String(s || "").replace("#", ""); if (s.length === 3) s = s.split("").map(function (c) { return c + c; }).join(""); var n = parseInt(s, 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgb(a) { return "rgb(" + a.map(function (c) { return Math.max(0, Math.min(255, Math.round(c))); }).join(",") + ")"; }
  function shade(hex, amt) { var c = hx(hex); return rgb(c.map(function (v) { return amt < 0 ? v * (1 + amt) : v + (255 - v) * amt; })); }
  function hexA(hex, al) { var c = hx(hex); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + al + ")"; }
  function ordinal(n) { if (n == null) return "—"; var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function pair(corps) {
    try { if (window.CadCorps && window.CadCorps.vars) { var v = window.CadCorps.vars(corps); if (v && v.bar) return { bar: v.bar, accent: v.accent }; } } catch (e) {}
    return { bar: "#0a3f6b", accent: "#f0b429" };
  }
  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  // ---- data ------------------------------------------------------------------
  function seasonStats(corps, year) {
    return fetch("data/seasons/" + year + ".json?cb=" + Date.now(), { headers: { "cache-control": "no-cache" } })
      .then(function (r) { return r.json(); })
      .then(function (evs) {
        var rows = [];
        (evs || []).forEach(function (ev) {
          (ev.classes || []).forEach(function (c) {
            (c.results || []).forEach(function (r) {
              if (r.corps === corps && r.score != null) rows.push({ date: ev.date, event: ev.name, loc: ev.location, score: r.score, place: r.place });
            });
          });
        });
        rows.sort(function (a, b) { return (a.date || "").localeCompare(b.date || ""); });
        if (!rows.length) return null;
        var scores = rows.map(function (r) { return r.score; });
        var places = rows.map(function (r) { return r.place; }).filter(function (p) { return p != null; });
        return {
          corps: corps, year: year, rows: rows, scores: scores,
          high: Math.max.apply(null, scores),
          first: scores[0], last: scores[scores.length - 1],
          gained: +(scores[scores.length - 1] - scores[0]).toFixed(3),
          bestPlace: places.length ? Math.min.apply(null, places) : null,
          shows: rows.length,
          wins: rows.filter(function (r) { return r.place === 1; }).length
        };
      }).catch(function () { return null; });
  }

  // ---- canvas card -----------------------------------------------------------
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function fitText(g, text, max, start, min) {
    var size = start;
    while (size > min) { g.font = "900 " + size + "px " + FONT; if (g.measureText(text).width <= max) break; size -= 4; }
    return size;
  }
  function logo(g, x, y, s, bar, accent) {
    roundRect(g, x, y, s, s, s * 0.24); g.save(); g.clip();
    g.fillStyle = "#fff"; g.fillRect(x, y, s, s);
    g.fillStyle = bar; g.beginPath(); g.moveTo(x, y); g.lineTo(x + s, y); g.lineTo(x, y + s); g.closePath(); g.fill();
    g.fillStyle = accent; g.beginPath(); g.moveTo(x + s, y); g.lineTo(x + s, y + s); g.lineTo(x, y + s); g.closePath(); g.fill();
    g.restore();
  }

  function drawSeasonCard(s) {
    var W = 1080, H = 1350, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    var g = cv.getContext("2d");
    var p = pair(s.corps), bar = p.bar, accent = p.accent, PAD = 84;
    // background
    var grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, shade(bar, 0.06)); grad.addColorStop(1, shade(bar, -0.45));
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    var rg = g.createRadialGradient(W * 0.82, H * 0.1, 0, W * 0.82, H * 0.1, W * 0.85);
    rg.addColorStop(0, hexA(accent, 0.3)); rg.addColorStop(1, hexA(accent, 0)); g.fillStyle = rg; g.fillRect(0, 0, W, H);

    // header
    g.textBaseline = "alphabetic";
    g.fillStyle = accent; g.font = "800 30px " + FONT;
    g.save(); g.translate(PAD, 120); g.fillText("C A D E N C E", 0, 0); g.restore();
    g.fillStyle = "rgba(255,255,255,.62)"; g.font = "700 30px " + FONT; g.textAlign = "right";
    g.fillText(s.year + " SEASON", W - PAD, 120); g.textAlign = "left";

    // logo + name
    logo(g, PAD, 175, 150, bar, accent);
    var nameSize = fitText(g, s.corps, W - PAD * 2, 96, 52);
    g.fillStyle = "#fff"; g.font = "900 " + nameSize + "px " + FONT;
    // wrap name if very long
    var name = s.corps, y = 175 + 150 + 96;
    if (g.measureText(name).width > W - PAD * 2) {
      var words = name.split(" "), line = "", lines = [];
      words.forEach(function (w) { var t = line ? line + " " + w : w; if (g.measureText(t).width > W - PAD * 2 && line) { lines.push(line); line = w; } else line = t; });
      if (line) lines.push(line);
      y = 175 + 150 + 78;
      lines.slice(0, 2).forEach(function (ln, i) { g.fillText(ln, PAD, y + i * (nameSize + 6)); });
      y = y + lines.slice(0, 2).length * (nameSize + 6) + 8;
    } else { g.fillText(name, PAD, y); y += 24; }
    g.fillStyle = accent; g.font = "800 34px " + FONT;
    g.fillText("Season, by the numbers", PAD, y + 20);

    // stat tiles (2x2)
    var tiles = [
      ["Season high", s.high.toFixed(3)],
      ["Best finish", ordinal(s.bestPlace)],
      ["Points gained", (s.gained >= 0 ? "+" : "") + s.gained.toFixed(2)],
      ["Shows", String(s.shows)]
    ];
    var tW = (W - PAD * 2 - 28) / 2, tH = 210, tx0 = PAD, ty0 = y + 64;
    tiles.forEach(function (t, i) {
      var tx = tx0 + (i % 2) * (tW + 28), ty = ty0 + Math.floor(i / 2) * (tH + 26);
      roundRect(g, tx, ty, tW, tH, 28); g.fillStyle = "rgba(255,255,255,.09)"; g.fill();
      roundRect(g, tx, ty, tW, tH, 28); g.lineWidth = 2; g.strokeStyle = "rgba(255,255,255,.14)"; g.stroke();
      g.fillStyle = accent; g.fillRect(tx + 30, ty + 34, 46, 6);
      g.fillStyle = "#fff"; g.font = "900 78px " + FONT; g.textBaseline = "alphabetic";
      g.fillText(t[1], tx + 30, ty + 138);
      g.fillStyle = "rgba(255,255,255,.72)"; g.font = "800 27px " + FONT;
      g.fillText(t[0].toUpperCase(), tx + 30, ty + 178);
    });

    // sparkline
    var sx = PAD, sy = ty0 + 2 * tH + 26 + 56, sw = W - PAD * 2, sh = 210;
    g.fillStyle = "rgba(255,255,255,.72)"; g.font = "800 27px " + FONT;
    g.fillText("PROGRESSION · " + s.first.toFixed(2) + " → " + s.last.toFixed(2), sx, sy - 20);
    var mn = Math.min.apply(null, s.scores), mx = Math.max.apply(null, s.scores), rng = (mx - mn) || 1;
    var n = s.scores.length;
    var X = function (i) { return sx + (n === 1 ? sw / 2 : (i / (n - 1)) * sw); };
    var Y = function (v) { return sy + sh - ((v - mn) / rng) * sh; };
    g.strokeStyle = "rgba(255,255,255,.16)"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(sx, sy + sh); g.lineTo(sx + sw, sy + sh); g.stroke();
    g.beginPath(); s.scores.forEach(function (v, i) { var xx = X(i), yy = Y(v); i ? g.lineTo(xx, yy) : g.moveTo(xx, yy); });
    g.strokeStyle = accent; g.lineWidth = 7; g.lineJoin = "round"; g.lineCap = "round"; g.stroke();
    var lx = X(n - 1), ly = Y(s.last); g.fillStyle = accent; g.beginPath(); g.arc(lx, ly, 13, 0, 6.29); g.fill();
    g.fillStyle = "#fff"; g.beginPath(); g.arc(lx, ly, 5, 0, 6.29); g.fill();

    // footer
    g.fillStyle = "rgba(255,255,255,.5)"; g.font = "700 26px " + FONT; g.textAlign = "center";
    g.fillText("Follow every score at " + SITE_LABEL, W / 2, H - 64); g.textAlign = "left";
    return cv;
  }

  // ---- share -----------------------------------------------------------------
  function shareCanvas(cv, filename, title) {
    return new Promise(function (res) {
      cv.toBlob(function (blob) {
        if (!blob) return res(false);
        var file = new File([blob], filename, { type: "image/png" });
        var data = { files: [file], title: title, text: title + " — via Cadence", url: SITE_URL };
        if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
          navigator.share(data).then(function () { res(true); }, function () { res(false); });
          return;
        }
        // fallback: download the image
        var url = URL.createObjectURL(blob), a = document.createElement("a");
        a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000); res(false);
      }, "image/png");
    });
  }

  function slug(s) { return String(s).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase(); }

  function seasonCard(corps, year) {
    return seasonStats(corps, year).then(function (s) {
      if (!s) return false;
      var cv = drawSeasonCard(s);
      return shareCanvas(cv, slug(corps) + "-" + year + "-cadence.png", corps + " · " + year + " season");
    });
  }

  window.CadWrapped = { seasonCard: seasonCard, _stats: seasonStats, _draw: drawSeasonCard };
})();
