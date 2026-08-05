/* Cadence — hidden "Keep the Beat" mini-game (a little easter egg).
   Tap the Cadence logo three times fast to open it. Tap when the sweeping bar
   is inside the gold zone; every hit speeds things up and moves the zone. Three
   misses and it's over. Self-contained, synthesized drum hits via Web Audio,
   reuses the app's CSS variables. Namespaced (.ar-* / cad-ar-* / window.CadArcade). */
(function () {
  "use strict";
  function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lset(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  // ---- sound (lazy — needs a user gesture) -----------------------------------
  var actx;
  function ctx() {
    if (actx === undefined) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
    if (actx && actx.state === "suspended") { try { actx.resume(); } catch (e) {} }
    return actx;
  }
  function snare() {
    var a = ctx(); if (!a) return;
    var len = Math.floor(a.sampleRate * 0.14), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    var n = a.createBufferSource(); n.buffer = buf;
    var f = a.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 1400;
    var g = a.createGain(); g.gain.setValueAtTime(0.45, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.14);
    n.connect(f); f.connect(g); g.connect(a.destination); n.start();
    var o = a.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(190, a.currentTime); o.frequency.exponentialRampToValueAtTime(60, a.currentTime + 0.13);
    var g2 = a.createGain(); g2.gain.setValueAtTime(0.5, a.currentTime); g2.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.16);
    o.connect(g2); g2.connect(a.destination); o.start(); o.stop(a.currentTime + 0.18);
  }
  function womp() {
    var a = ctx(); if (!a) return;
    var o = a.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(220, a.currentTime); o.frequency.exponentialRampToValueAtTime(70, a.currentTime + 0.22);
    var g = a.createGain(); g.gain.setValueAtTime(0.28, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.24);
    o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.26);
  }

  // ---- styles ----------------------------------------------------------------
  function injectStyles() {
    if (document.getElementById("ar-style")) return;
    var css = [
      ".ar-overlay{position:fixed;inset:0;z-index:3200;display:flex;align-items:center;justify-content:center;padding:16px;}",
      ".ar-backdrop{position:absolute;inset:0;background:rgba(8,20,38,.72);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);}",
      ".ar-card{position:relative;z-index:3;width:100%;max-width:400px;background:var(--surface-1);color:var(--text-primary);border:1px solid var(--border);border-radius:20px;box-shadow:0 24px 70px rgba(8,20,38,.55);overflow:hidden;}",
      ".ar-head{background:var(--navy);color:#fff;padding:18px 20px 16px;text-align:center;position:relative;}",
      ".ar-x{position:absolute;top:10px;right:10px;width:34px;height:34px;border:0;border-radius:50%;background:rgba(255,255,255,.14);color:#fff;font-size:20px;line-height:1;cursor:pointer;display:grid;place-items:center;}",
      ".ar-x:hover{background:rgba(255,255,255,.26);}",
      ".ar-eyebrow{font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:var(--gold);}",
      ".ar-title{font-size:26px;font-weight:900;letter-spacing:-.5px;margin:5px 0 0;color:#fff;}",
      ".ar-hud{display:flex;justify-content:space-between;align-items:center;padding:12px 20px 0;font-variant-numeric:tabular-nums;}",
      ".ar-score{font-size:15px;font-weight:800;color:var(--text-primary);}",
      ".ar-score span{color:var(--muted);font-weight:700;}",
      ".ar-lives{font-size:16px;letter-spacing:2px;}",
      ".ar-body{padding:16px 20px 20px;}",
      ".ar-track{position:relative;height:52px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border);overflow:hidden;cursor:pointer;touch-action:manipulation;}",
      ".ar-zone{position:absolute;top:0;bottom:0;background:linear-gradient(180deg,rgba(240,180,41,.5),rgba(240,180,41,.28));border-left:2px solid var(--gold);border-right:2px solid var(--gold);transition:left .12s ease,width .12s ease;}",
      ".ar-marker{position:absolute;top:-2px;bottom:-2px;width:4px;border-radius:3px;background:#fff;box-shadow:0 0 10px rgba(255,255,255,.8);transform:translateX(-50%);}",
      ".ar-hint{text-align:center;font-size:13px;color:var(--muted);margin:12px 2px 0;line-height:1.4;}",
      ".ar-flash{position:absolute;inset:0;pointer-events:none;opacity:0;}",
      ".ar-flash.hit{background:rgba(47,158,68,.28);animation:ar-fl .25s ease;}",
      ".ar-flash.miss{background:rgba(224,49,49,.3);animation:ar-fl .3s ease;}",
      "@keyframes ar-fl{from{opacity:1}to{opacity:0}}",
      ".ar-btn{display:block;width:100%;margin-top:14px;border:0;border-radius:999px;padding:15px;font:inherit;font-size:17px;font-weight:900;letter-spacing:.5px;cursor:pointer;background:var(--gold);color:#16233d;}",
      ".ar-btn:active{transform:translateY(1px);}",
      ".ar-btn.ghost{background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);font-size:14px;font-weight:800;letter-spacing:0;padding:11px;margin-top:8px;}",
      ".ar-big{text-align:center;padding:6px 0 2px;}",
      ".ar-big b{display:block;font-size:40px;font-weight:900;color:var(--text-primary);font-variant-numeric:tabular-nums;line-height:1;}",
      ".ar-big span{display:block;font-size:12px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-top:6px;}",
      "@media (prefers-reduced-motion: reduce){.ar-flash.hit,.ar-flash.miss{animation:none;}}"
    ].join("\n");
    var st = document.createElement("style"); st.id = "ar-style"; st.textContent = css; document.head.appendChild(st);
  }

  // ---- game ------------------------------------------------------------------
  var overlay = null, raf = null, onKey = null;
  var pos, dir, speed, zoneC, zoneW, score, lives, playing, last;

  function close() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    if (onKey) { document.removeEventListener("keydown", onKey, true); onKey = null; }
    if (overlay) { overlay.remove(); overlay = null; }
    playing = false;
  }
  function best() { return +(lget("cad-ar-best") || 0); }

  function open() {
    injectStyles();
    if (overlay) close();
    overlay = document.createElement("div");
    overlay.className = "ar-overlay";
    overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true"); overlay.setAttribute("aria-label", "Keep the Beat mini-game");
    overlay.innerHTML =
      '<div class="ar-backdrop"></div><div class="ar-card">' +
      '<div class="ar-head"><button class="ar-x" type="button" aria-label="Close">×</button>' +
      '<div class="ar-eyebrow">Cadence Arcade</div><div class="ar-title">Keep the Beat</div></div>' +
      '<div class="ar-hud"><div class="ar-score">Score <span id="ar-scv">0</span></div><div class="ar-lives" id="ar-lv" aria-label="lives"></div></div>' +
      '<div class="ar-body" id="ar-body"></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector(".ar-backdrop").addEventListener("click", close);
    overlay.querySelector(".ar-x").addEventListener("click", close);
    onKey = function (e) {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if ((e.key === " " || e.code === "Space") && playing) { e.preventDefault(); tap(); }
    };
    document.addEventListener("keydown", onKey, true);
    startScreen();
  }

  function startScreen() {
    var body = overlay.querySelector("#ar-body");
    body.innerHTML =
      '<div class="ar-big"><b>🥁</b><span>Best ' + best() + "</span></div>" +
      '<p class="ar-hint">Tap when the white marker is inside the <b style="color:var(--gold)">gold zone</b>. Every hit gets faster.</p>' +
      '<button class="ar-btn" id="ar-start" type="button">START</button>';
    overlay.querySelector("#ar-lv").textContent = "";
    overlay.querySelector("#ar-scv").textContent = "0";
    body.querySelector("#ar-start").addEventListener("click", play);
  }

  function play() {
    pos = 0; dir = 1; speed = 0.55; zoneC = 0.5; zoneW = 0.2; score = 0; lives = 3; playing = true; last = null;
    var body = overlay.querySelector("#ar-body");
    body.innerHTML =
      '<div class="ar-track" id="ar-track"><div class="ar-zone" id="ar-zone"></div><div class="ar-marker" id="ar-marker"></div><div class="ar-flash" id="ar-flash"></div></div>' +
      '<button class="ar-btn" id="ar-tap" type="button">TAP</button>' +
      '<p class="ar-hint">Space or tap the bar works too.</p>';
    body.querySelector("#ar-tap").addEventListener("click", tap);
    body.querySelector("#ar-track").addEventListener("click", tap);
    paintHud(); paintZone(); loop();
  }
  function paintHud() {
    var lv = overlay.querySelector("#ar-lv"), sc = overlay.querySelector("#ar-scv");
    if (lv) lv.textContent = "❤️".repeat(lives) + "🖤".repeat(3 - lives);
    if (sc) sc.textContent = score;
  }
  function paintZone() {
    var z = overlay.querySelector("#ar-zone"); if (!z) return;
    z.style.left = ((zoneC - zoneW / 2) * 100) + "%";
    z.style.width = (zoneW * 100) + "%";
  }
  function loop() {
    raf = requestAnimationFrame(function step(t) {
      if (!playing) return;
      if (last == null) last = t;
      var dt = Math.min(0.05, (t - last) / 1000); last = t;
      pos += dir * speed * dt;
      if (pos >= 1) { pos = 1; dir = -1; } else if (pos <= 0) { pos = 0; dir = 1; }
      var m = overlay.querySelector("#ar-marker"); if (m) m.style.left = (pos * 100) + "%";
      raf = requestAnimationFrame(step);
    });
  }
  function flash(kind) {
    var f = overlay.querySelector("#ar-flash"); if (!f) return;
    f.className = "ar-flash"; void f.offsetWidth; f.className = "ar-flash " + kind;
  }
  function tap() {
    if (!playing) return;
    if (Math.abs(pos - zoneC) <= zoneW / 2) {
      score++; snare(); flash("hit");
      speed = Math.min(2.4, speed + 0.11);
      zoneW = Math.max(0.07, zoneW * 0.93);
      zoneC = 0.18 + rand() * 0.64; // hop the zone so you can't camp
      paintZone(); paintHud();
    } else {
      lives--; womp(); flash("miss"); paintHud();
      if (lives <= 0) return gameOver();
    }
  }
  // no Math.random ban here (browser), but keep it simple + seeded-ish by score
  function rand() { return Math.random(); }

  function gameOver() {
    playing = false;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    var isBest = score > best();
    if (isBest) lset("cad-ar-best", String(score));
    if (score >= 12 && window.CadChamp == null) {} // reserved: could celebrate
    var body = overlay.querySelector("#ar-body");
    body.innerHTML =
      '<div class="ar-big"><b>' + score + "</b><span>" + (isBest ? "New best! 🎉" : "Best " + best()) + "</span></div>" +
      '<p class="ar-hint">' + blurb(score) + "</p>" +
      '<button class="ar-btn" id="ar-again" type="button">PLAY AGAIN</button>' +
      '<button class="ar-btn ghost" id="ar-close" type="button">Done</button>';
    body.querySelector("#ar-again").addEventListener("click", play);
    body.querySelector("#ar-close").addEventListener("click", close);
  }
  function blurb(s) {
    if (s >= 25) return "Drum major material. 🥇";
    if (s >= 15) return "Locked in — clean hands!";
    if (s >= 8) return "Solid rep. Keep marking time.";
    if (s >= 3) return "Not bad — run it back.";
    return "Everybody starts at the beginning.";
  }

  // ---- trigger: tap the logo three times fast --------------------------------
  function init() {
    var brand = document.querySelector("header.topbar .brand") || document.querySelector(".brand");
    if (!brand) return;
    var taps = [];
    brand.addEventListener("click", function () {
      var now = (window.performance && performance.now) ? performance.now() : +new Date();
      taps.push(now);
      taps = taps.filter(function (t) { return now - t < 1200; });
      if (taps.length >= 3) { taps = []; try { open(); } catch (e) {} }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.CadArcade = { open: open, close: close };
})();
