/* Cadence browser QA — the whole app, driven for real.
   Serves docs/ on a local port, launches Chromium, and walks every route and
   critical flow at phone + desktop widths, both themes, and all text sizes.
   Exit code 0 = clean. Any finding prints with its section and fails the run.

   Local:  cd tests/qa && npm ci && npm test
   Alt:    PW_MODULE=$(npm root -g)/playwright PW_EXECUTABLE=/path/to/chrome npm test
   CI:     .github/workflows/qa.yml runs exactly `npm ci && npm test`. */
"use strict";
const path = require("node:path");
const { start } = require("./serve");

let pw;
try { pw = require("playwright"); }
catch (e) {
  try { pw = require(process.env.PW_MODULE || "/dev/null"); }
  catch (e2) {
    console.error("playwright not found — run `npm ci` here, or set PW_MODULE to a playwright install");
    process.exit(2);
  }
}

const EXECUTABLE = process.env.PW_EXECUTABLE || undefined;
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };
const ROUTES = ["#/", "#/?y=2019", "#/events", "#/corps", "#/corps/bluecoats", "#/stats", "#/captions",
  "#/compare", "#/champions", "#/records", "#/database", "#/predictions", "#/settings",
  "#/suggestions", "#/about", "#/ask", "#/wgi", "#/wgi?y=2019",
  "#/wgi/events", "#/wgi/units", "#/wgi/stats", "#/judges", "#/breakdown"];

const findings = [];
let currentSection = "";
const bad = msg => findings.push(`[${currentSection}] ${msg}`);

// standard localStorage seeds: an established visitor with no pending popups
const SEEDS = `
  localStorage.setItem("cad-onboard", "1");
  localStorage.setItem("cad-rc-autoseen", "1");
  localStorage.setItem("cad-install-snooze", String(Date.now() + 864e5));
  sessionStorage.setItem("cad-rc-session", "1");`;

async function ctxPage(browser, base, { viewport = PHONE, seeds = SEEDS, theme, fontSize, favs, sw = false } = {}) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: sw ? "allow" : "block" });
  await ctx.addInitScript(`(() => { try {
    ${seeds}
    ${theme ? `localStorage.setItem("cad-theme", ${JSON.stringify(theme)});` : ""}
    ${fontSize ? `localStorage.setItem("cad-fontsize", ${JSON.stringify(fontSize)});` : ""}
    ${favs ? `localStorage.setItem("cad-favs", ${JSON.stringify(JSON.stringify(favs))});` : ""}
  } catch (e) {} })()`);
  const page = await ctx.newPage();
  page._errs = [];
  page.on("pageerror", e => page._errs.push("pageerror: " + e.message.slice(0, 140)));
  page.on("console", m => {
    if (m.type() === "error" && !/favicon|manifest|sw\.js|Failed to load resource/.test(m.text()))
      page._errs.push("console: " + m.text().slice(0, 140));
  });
  page.goHash = async h => {
    await page.goto(base + "/index.html" + h, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1300);
  };
  page.overflowPx = () => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  return { ctx, page };
}

// ---------------------------------------------------------------------------
const sections = [];
const section = (name, fn) => sections.push([name, fn]);

section("routes render clean (phone + desktop)", async (browser, base) => {
  for (const viewport of [PHONE, DESKTOP]) {
    const { ctx, page } = await ctxPage(browser, base, { viewport });
    for (const h of ROUTES) {
      await page.goHash(h);
      const label = `${h} @${viewport.width}`;
      const over = await page.overflowPx();
      if (over > 1) bad(`${label}: horizontal overflow ${over}px`);
      const empty = await page.evaluate(() => {
        const m = document.getElementById("app");
        return !m || m.innerText.trim().length < 10;
      });
      if (empty) bad(`${label}: page rendered (nearly) empty`);
      const broken = await page.evaluate(() => [...document.images]
        .filter(i => i.offsetParent !== null && i.complete && i.naturalWidth === 0 && !i.hidden).length);
      if (broken) bad(`${label}: ${broken} broken image(s)`);
    }
    if (page._errs.length) bad(`@${viewport.width}: ${[...new Set(page._errs)].slice(0, 4).join(" | ")}`);
    await ctx.close();
  }
});

section("legacy routes keep redirecting", async (browser, base) => {
  const { ctx, page } = await ctxPage(browser, base);
  const cases = [
    // Captions moved out of the Stats hub to a tab of its own, so the hub now
    // lands on its own first view. #/captions remains a working top-level URL.
    ["#/data", /#\/compare/], ["#/stats", /#\/compare/],
    ["#/captions", /#\/captions/],
    ["#/seasons", /#\/(seasons|champions)/], ["#/today", /#\/(today|$)/],
    ["#/season/2025", /#\/events\?y=2025/], ["#/season/dci/2019", /#\/events\?y=2019/],
  ];
  for (const [from, want] of cases) {
    await page.goHash(from);
    const now = await page.evaluate(() => location.hash);
    if (!want.test(now)) bad(`${from} landed on ${now}`);
    const empty = await page.evaluate(() => (document.getElementById("app") || {}).innerText?.trim().length < 10);
    if (empty) bad(`${from}: destination rendered empty`);
  }
  await ctx.close();
});

section("themes, text sizes, corps colors", async (browser, base) => {
  for (const theme of ["light", "dark"]) {
    for (const fontSize of ["1", "1.1", "1.2"]) {
      const { ctx, page } = await ctxPage(browser, base, { theme, fontSize });
      for (const h of ["#/", "#/events", "#/settings"]) {
        await page.goHash(h);
        const over = await page.overflowPx();
        if (over > 2) bad(`${theme}/fs=${fontSize} ${h}: overflow ${over}px`);
      }
      if (page._errs.length) bad(`${theme}/fs=${fontSize}: ${page._errs[0]}`);
      await ctx.close();
    }
  }
  // corps colors persist and repaint
  const { ctx, page } = await ctxPage(browser, base);
  await page.goHash("#/settings");
  // skip the first chip — that's the "default look" reset, which clears the theme
  const chip = (await page.$$("[data-corps-set]"))[1];
  if (!chip) bad("no corps-theme chip in Settings");
  else {
    await chip.click();
    await page.waitForTimeout(600);
    const applied = await page.evaluate(() => document.documentElement.dataset.corps || "");
    if (!applied) bad("corps theme did not apply data-corps");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const kept = await page.evaluate(() => document.documentElement.dataset.corps || "");
    if (kept !== applied) bad(`corps theme lost on reload (${applied} → ${kept})`);
  }
  await ctx.close();
});

section("first-run onboarding → favorites → Following strip", async (browser, base) => {
  const { ctx, page } = await ctxPage(browser, base, { seeds: "" }); // true first visit
  await page.goHash("#/");
  await page.waitForTimeout(1600);
  const sheet = await page.$(".ob-sheet");
  if (!sheet) { bad("onboarding sheet did not appear on a first visit"); await ctx.close(); return; }
  await page.fill(".ob-search", "blue");
  await page.waitForTimeout(250);
  const visible = await page.$$eval(".ob-chip:not([hidden])", els => els.map(e => e.dataset.corps));
  if (!visible.length || !visible.every(n => /blue/i.test(n))) bad("onboarding search filter failed");
  await page.fill(".ob-search", "");
  const chips = await page.$$(".ob-chip");
  await chips[0].click();
  await page.click("#obDone");
  await page.waitForTimeout(900);
  if (await page.$("#obAlerts")) await page.click("#obLater");
  await page.waitForTimeout(900);
  if (await page.$(".ob-ov")) bad("sheet still open after Done");
  if (!(await page.$$(".fol-card")).length) bad("Following strip missing after picking a favorite");
  if (await page.evaluate(() => localStorage.getItem("cad-onboard")) !== "1") bad("completion key not set");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);
  if (await page.$(".ob-ov")) bad("sheet reappeared after completion");
  if (page._errs.length) bad(page._errs[0]);
  await ctx.close();
});

section("season picker: browse the archive from the Scoreboard heading", async (browser, base) => {
  const { ctx, page } = await ctxPage(browser, base, { favs: ["Bluecoats"] });
  await page.goHash("#/");
  const heading = await page.evaluate(() => document.querySelector("h1.page").innerText.replace(/\s+/g, " ").trim());
  if (!/^\d{4} Scoreboard$/.test(heading)) bad(`heading is not "<year> Scoreboard": "${heading}"`);
  const current = (await page.textContent(".yearpick")).trim();

  // opens, lists every season newest-first, marks the one being viewed
  await page.click(".yearpick");
  await page.waitForTimeout(400);
  const years = await page.$$eval(".yearopt", els => els.map(e => +e.textContent.trim()));
  if (years.length < 20) bad(`picker lists only ${years.length} seasons`);
  if (String(years[0]) !== current) bad("picker is not sorted newest-first");
  if (years.some((y, i) => i && y >= years[i - 1])) bad("picker years are not strictly descending");
  const marked = await page.$$eval(".yearopt.on", els => els.map(e => e.textContent.trim()));
  if (marked.length !== 1 || marked[0] !== current) bad(`selected season marker: ${JSON.stringify(marked)}`);
  if (await page.getAttribute(".yearpick", "aria-expanded") !== "true") bad("aria-expanded stays false when open");

  // Escape closes it and returns focus to the trigger
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  if (await page.$(".yearpanel:not([hidden])")) bad("Escape did not close the season panel");
  if (await page.evaluate(() => document.activeElement.className) !== "yearpick")
    bad("focus not returned to the year button after Escape");

  // pick an older season: URL, heading, and a real board for it
  const older = years.find(y => y <= years[0] - 5) || years[years.length - 1];
  await page.click(".yearpick");
  await page.waitForTimeout(300);
  await page.click(`.yearopt[data-y="${older}"]`);
  await page.waitForTimeout(1800);
  if (await page.evaluate(() => location.hash) !== `#/?y=${older}`) bad("URL did not carry the picked season");
  if ((await page.textContent(".yearpick")).trim() !== String(older)) bad("heading did not switch season");
  if (!(await page.$$("#standings tbody tr")).length) bad(`${older}: no standings rows`);
  if (!await page.$("#trendChart svg")) bad(`${older}: no progression chart`);
  if (!/last score of the /.test(await page.textContent("#standTitle"))) bad(`${older}: not framed as a finished season`);
  // a settled season carries no live/now modules
  if (await page.$("#followMount")) bad("past season still renders the Following strip");
  if (await page.$(".offszn")) bad("past season still renders This Day in History");
  if (await page.$(".pill.live")) bad("past season shows a LIVE badge");
  const over = await page.overflowPx();
  if (over > 1) bad(`${older} board overflows ${over}px`);

  // the class filter must actually switch the board ON an archived season —
  // its choice lives in memory, not in the device-wide saved preference
  const savedBefore = await page.evaluate(() => localStorage.getItem("dt-classes"));
  const titleBefore = await page.textContent("#standTitle");
  const rowsBefore = (await page.$$("#standings tbody tr")).length;
  await page.click("#clsSel .msel-btn");
  await page.waitForTimeout(400);
  const clsLabels = await page.$$eval("#clsSel .msel-opt", els => els.map(e => e.textContent.replace(/\s+/g, " ").trim()));
  const otherIdx = clsLabels.findIndex(l => !/^World Class/.test(l));
  if (otherIdx < 0) bad(`${older}: only one class to choose from, cannot verify the filter`);
  else {
    await (await page.$$("#clsSel .msel-opt"))[otherIdx].click();
    await page.waitForTimeout(1700);
    const titleAfter = await page.textContent("#standTitle");
    const rowsAfter = (await page.$$("#standings tbody tr")).length;
    if (titleAfter === titleBefore && rowsAfter === rowsBefore)
      bad(`${older}: picking "${clsLabels[otherIdx]}" changed nothing — the class filter is inert on archived seasons`);
    if (await page.evaluate(() => localStorage.getItem("dt-classes")) !== savedBefore)
      bad("an archived season's class choice overwrote the saved current-season preference");
  }

  // 2007's archive holds one indoor mini-corps date 91 days before the tour;
  // the season must still fill the chart rather than being squashed into a
  // corner, and the axis labels must keep telling the truth
  await page.goHash("#/?y=2007");
  await page.waitForTimeout(1500);
  const chart = await page.evaluate(() => {
    const svg = document.querySelector("#trendChart svg");
    if (!svg) return null;
    const xs = [...svg.querySelectorAll('path[d^="M"]')].flatMap(p =>
      (p.getAttribute("d").match(/[ML] ?([\d.]+)/g) || []).map(s => parseFloat(s.replace(/[ML] ?/, ""))));
    const dots = [...svg.querySelectorAll("circle")].map(c => +c.getAttribute("cx")).filter(n => !isNaN(n));
    const all = [...xs, ...dots];
    return all.length && xs.length
      ? { start: (Math.min(...xs) - Math.min(...all)) / (Math.max(...all) - Math.min(...all)) }
      : null;
  });
  if (!chart) bad("2007: no progression chart rendered");
  else if (chart.start > 0.35)
    bad(`2007: an off-tour outlier squashes the season — lines start ${(chart.start * 100).toFixed(0)}% into the plot`);

  // 1996: the DCI season ends at the championship — the archive's post-finals
  // hometown shows (a 98.1 in Montreal a week after finals) must never top
  // the board. The real 1996 result is the Blue Devils / Phantom tie at 97.4.
  await page.goHash("#/?y=1996");
  await page.waitForTimeout(1500);
  const top96 = await page.evaluate(() => {
    const r = document.querySelector("#standings tbody tr");
    return r ? r.textContent.replace(/\s+/g, " ").trim() : "";
  });
  if (!/Blue Devils|Phantom Regiment/.test(top96) || !/97\.4/.test(top96))
    bad(`1996: board is not topped by the real champions — first row reads "${top96.slice(0, 80)}"`);

  // back returns to the current season with its live modules
  await page.goHash("#/");
  await page.waitForTimeout(1200);
  if ((await page.textContent(".yearpick")).trim() !== current) bad("could not get back to the current season");

  // unknown seasons fall back instead of erroring
  for (const badHash of ["#/?y=1899", "#/?y=abc"]) {
    await page.goHash(badHash);
    if ((await page.textContent(".yearpick")).trim() !== current) bad(`${badHash} did not fall back to the current season`);
  }
  if (page._errs.length) bad(page._errs[0]);
  await ctx.close();
});

section("corps tab always opens on a corps", async (browser, base) => {
  // no favorites: it should fall back to whoever currently leads the board
  const { ctx, page } = await ctxPage(browser, base, { favs: [] });
  await page.goHash("#/corps");
  await page.waitForTimeout(1400);
  const hash = await page.evaluate(() => location.hash);
  if (!/^#\/corps\/[a-z0-9-]+$/.test(hash)) bad(`#/corps did not auto-open a corps (hash: ${hash})`);
  if (!await page.$("#corpsDetail .card")) bad("#/corps showed no corps detail with no favorites");
  // compare slugs, not heading text: the <h1> is the static word "Corps"
  const leaderSlug = await page.evaluate(async () => {
    const [rk, idx] = await Promise.all([
      fetch("data/rankings.json").then(r => r.json()),
      fetch("data/corps_index.json").then(r => r.json())]);
    const st = rk.standings || {}, order = rk.listClasses || Object.keys(st);
    const cl = order.includes("World Class") ? "World Class" : order[0];
    const top = ((st[cl] || {}).rows || [])[0];
    const hit = idx.find(c => c.name === (top && top.corps));
    return hit ? hit.slug : null;
  });
  if (leaderSlug && hash !== `#/corps/${leaderSlug}`)
    bad(`#/corps opened on ${hash} instead of the current leader (#/corps/${leaderSlug})`);
  if (page._errs.length) bad(page._errs[0]);
  await ctx.close();

  // with a favorite, that corps wins over the leader
  const b = await ctxPage(browser, base, { favs: ["Blue Devils"] });
  await b.page.goHash("#/corps");
  await b.page.waitForTimeout(1400);
  if (!/blue-devils/.test(await b.page.evaluate(() => location.hash)))
    bad("#/corps ignored the stored favorite");
  if (b.page._errs.length) bad(b.page._errs[0]);
  await b.ctx.close();
});

section("favorites drive the app (strip, standings, settings)", async (browser, base) => {
  const { ctx, page } = await ctxPage(browser, base, { favs: ["Bluecoats"] });
  await page.goHash("#/");
  const card = await page.$(".fol-card");
  if (!card) bad("no Following card for a stored favorite");
  else if (!/Bluecoats/.test(await card.textContent())) bad("Following card missing the corps");
  const favrow = await page.$("tr.favrow");
  if (!favrow) bad("standings row not highlighted for favorite");
  await page.goHash("#/settings");
  if (!/Bluecoats/.test(await page.textContent("#favSummary"))) bad("Settings favorites summary missing the corps");
  if (page._errs.length) bad(page._errs[0]);
  await ctx.close();
});

section("shows: expansion, filters panel, event page focus", async (browser, base) => {
  const { ctx, page } = await ctxPage(browser, base);
  await page.goHash("#/events");
  const head = await page.$(".evrow .evhead");
  if (!head) bad("no show rows at all");
  else {
    await head.click();
    await page.waitForTimeout(600);
    if (!await page.$(".evrow .evres, .evrow table")) bad("expanding a show revealed no results/schedule");
  }
  const ft = await page.$("#fToggle");
  if (!ft) bad("no Filters toggle");
  else {
    const panel = await page.$(".fpanel");
    const before = panel && await panel.isVisible();
    await ft.click(); await page.waitForTimeout(300);
    const after = panel && await panel.isVisible();
    if (before === after) bad("Filters toggle did not change panel visibility");
  }

  // the year is the same picker as the Scoreboard — pick a season, the URL and
  // heading follow, and a real board for it renders
  const yp = await page.$("h1.page .yearpick");
  if (!yp) bad("shows: no year picker in the heading");
  else {
    const yrs = await (async () => { await yp.click(); await page.waitForTimeout(300);
      return page.$$eval(".yearopt", els => els.map(e => +e.textContent.trim())); })();
    if (yrs.length < 20) bad(`shows: year picker lists only ${yrs.length} seasons`);
    const older = yrs.find(y => y <= yrs[0] - 5) || yrs[yrs.length - 1];
    await page.click(`.yearopt[data-y="${older}"]`);
    await page.waitForTimeout(1500);
    if (await page.evaluate(() => location.hash) !== `#/events?y=${older}`) bad("shows: picking a year did not update the URL");
    if ((await page.textContent("h1.page .yearpick")).trim() !== String(older)) bad("shows: heading did not switch season");
    if (!await page.$(".evrow, .evsection, .empty")) bad(`shows: ${older} rendered no season body`);
    await page.goHash("#/events"); await page.waitForTimeout(1000);
  }

  // "Latest from DCI": the always-open news card — a photo rail of
  // headlines, the camps list, and an All news link that stays in the app
  const rail = await page.$("#newsMount .newsrail");
  if (rail) {
    if (!await page.$("#newsMount .newsart")) bad("news: rail rendered no headline cards");
    const hadCamps = !!await page.$("#newsMount .newscamps");
    const allNews = await page.$('#newsMount a[href="#/news"]');
    if (!allNews) bad("news: All news link is missing or leaves the app");
    else {
      await allNews.click(); await page.waitForTimeout(900);
      if (await page.evaluate(() => location.hash) !== "#/news") bad("news: All news did not open #/news");
      if (!await page.$(".newsgrid .newsart")) bad("#/news: no headline grid");
      if (hadCamps && !await page.$(".newsanns .newscard")) bad("#/news: no corps announcements");
      await page.goHash("#/events"); await page.waitForTimeout(900);
    }
  }

  // deep-linked corps focus on an event page
  await page.goHash("#/go?y=2026&d=2026-08-08&e=" + encodeURIComponent("DCI World Championship Finals") + "&c=" + encodeURIComponent("Phantom Regiment"));
  await page.waitForTimeout(1600);
  const row = await page.$("tr[data-focus]");
  if (!row) bad("#/go with corps did not mark a focus row");
  else if (!await row.isVisible()) bad("focus row is hidden (collapse not expanded)");
  if (page._errs.length) bad(page._errs[0]);
  await ctx.close();
});

section("stats hub: captions sheet, compare, database, records", async (browser, base) => {
  const { ctx, page } = await ctxPage(browser, base);
  await page.goHash("#/captions");
  await page.waitForTimeout(1200);
  if (!await page.$(".capcta")) bad("captions: no Caption Winners CTA");
  // the sub-nav is an underline strip, not pills: the active view carries a
  // ~2px bottom line and none of the old rounded-pill chrome
  const subtab = await page.evaluate(() => {
    const on = document.querySelector(".subtabs a.on");
    if (!on) return null;
    const s = getComputedStyle(on);
    return { bb: parseFloat(s.borderBottomWidth), radius: parseFloat(s.borderTopLeftRadius) };
  });
  if (!subtab) bad("stats: no active sub-tab");
  else if (subtab.bb < 1.5) bad(`stats: active sub-tab has no underline (border-bottom ${subtab.bb}px)`);
  else if (subtab.radius > 8) bad(`stats: sub-tab still renders as a pill (radius ${subtab.radius}px)`);
  const sortHeader = await page.$(".capsort th[data-sort], .rt th[data-c]");
  if (sortHeader) { await sortHeader.click(); await page.waitForTimeout(300); }
  await page.goHash("#/compare");
  const msel = await page.$("#corpsSel .msel-btn");
  if (!msel) bad("compare: no corps picker");
  else {
    await msel.click(); await page.waitForTimeout(400);
    const opts = await page.$$("#corpsSel .msel-opt");
    if (opts.length < 2) bad("compare: picker has <2 options");
    else {
      await opts[0].click(); await opts[1].click();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1600);
      if (!await page.$("#cmpChart svg")) bad("compare: no chart after picking two corps");
    }
  }
  await page.goHash("#/database");
  await page.waitForTimeout(1400);
  if ((await page.$$("table tbody tr")).length < 8) bad("database: too few rows");
  // the sub-nav scrolls on a phone; the active "Database" tab (rightmost) must
  // still sit within the visible strip, not be clipped off the right edge
  const tabVis = await page.evaluate(() => {
    const strip = document.querySelector(".subtabs");
    const on = strip && strip.querySelector("a.on");
    if (!strip || !on) return null;
    const sr = strip.getBoundingClientRect(), ar = on.getBoundingClientRect();
    return ar.left >= sr.left - 1 && ar.right <= sr.right + 1;
  });
  if (tabVis === false) bad("database: active sub-tab is scrolled out of view on a phone");
  const q = await page.$("#fq");
  if (q) {
    await q.fill("Bluecoats");
    await page.waitForTimeout(800);
    const first = await page.$("table tbody tr");
    if (!first || !/Bluecoats/i.test(await first.textContent())) bad("database: corps search failed");
  } else bad("database: no search box");
  await page.goHash("#/records");
  if ((await page.$$(".card")).length < 3) bad("records: too few cards");
  if (page._errs.length) bad(page._errs[0]);
  await ctx.close();
});

section("share card opens with branding footer", async (browser, base) => {
  const { ctx, page } = await ctxPage(browser, base);
  await page.goHash("#/corps/bluecoats");
  await page.waitForTimeout(1400);
  const btn = await page.$("#corpCard");
  if (!btn) { bad("no share-card button on corps page"); await ctx.close(); return; }
  await btn.click();
  await page.waitForTimeout(2200);
  const hasCanvasImg = await page.evaluate(() =>
    !!document.querySelector("canvas, img[src^='blob:'], img[src^='data:image']"));
  if (!hasCanvasImg) bad("share overlay showed no rendered card");
  if (page._errs.length) bad(page._errs[0]);
  await ctx.close();
});

section("caption winners card: full-screen and legible", async (browser, base) => {
  const { ctx, page } = await ctxPage(browser, base);
  await page.goHash("#/captions");
  await page.waitForTimeout(1600);
  const cta = await page.$("#showCapCta");
  if (!cta) { bad("no Caption Winners CTA"); await ctx.close(); return; }
  // the CTA is one compact line, but still a legal tap target
  const ctaH = await page.evaluate(() => Math.round(document.querySelector(".capcta").getBoundingClientRect().height));
  if (ctaH > 56) bad(`caption CTA is ${ctaH}px tall — it should be a single line`);
  if (ctaH < 30) bad(`caption CTA is only ${ctaH}px tall — under the tap-target floor`);
  await cta.click();
  await page.waitForSelector(".cad-ov img.cad-img", { timeout: 20000 });
  await page.waitForTimeout(900);
  const m = await page.evaluate(() => {
    const img = document.querySelector(".cad-img");
    const r = img.getBoundingClientRect();
    return { w: img.naturalWidth, h: img.naturalHeight, cssW: r.width, cssH: r.height,
      full: !!document.querySelector(".cad-ov.cad-full"), vw: window.innerWidth, vh: window.innerHeight };
  });
  // a DPR-3 phone needs ~3x the CSS width in real pixels or the card looks
  // fuzzy; 2160 keeps it a downsample at any phone size
  if (m.w < 2160) bad(`caption card renders only ${m.w}px wide — too soft to read full-screen`);
  if (!m.full) bad("tall caption card did not open in full-screen mode");
  if (m.cssW < m.vw - 2) bad(`card is ${Math.round(m.cssW)}px wide in a ${m.vw}px viewport — not filling the screen`);
  // the smallest type on the card must clear ~12 CSS px once scaled
  const detail = 68 * (m.cssW / m.w);
  if (detail < 11.5) bad(`card detail type lands at ${detail.toFixed(1)} CSS px — under the legibility floor`);
  if (page._errs.length) bad(page._errs[0]);
  await ctx.close();
});

section("failure states: data 404s degrade with human messages", async (browser, base) => {
  const { ctx, page } = await ctxPage(browser, base);
  await page.route("**/data/rankings.json*", r => r.fulfill({ status: 404, body: "x" }));
  await page.goHash("#/");
  await page.waitForTimeout(1000);
  const txt = (await page.textContent("#app")).replace(/\s+/g, " ");
  if (!/Couldn't load|Data may be|try again/i.test(txt)) bad("rankings 404: no human error message: " + txt.slice(0, 80));
  if (/undefined|NaN|\[object/.test(txt)) bad("rankings 404: junk in error state");
  await ctx.close();
});

section("stale-data indicator", async (browser, base) => {
  const { ctx, page } = await ctxPage(browser, base);
  const old = new Date(Date.now() - 3 * 3600e3);
  const stamp = old.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  await page.route("**/data/meta.json*", async r => {
    const body = JSON.parse(require("node:fs").readFileSync(path.join(__dirname, "../../docs/data/meta.json"), "utf8"));
    body.updated = stamp;
    await r.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goHash("#/");
  const cls = await page.evaluate(() => document.getElementById("updated").className);
  if (!/stale/.test(cls)) bad("3h-old data did not trip the stale flag");
  await ctx.close();
  // fresh data must NOT trip it
  const { ctx: c2, page: p2 } = await ctxPage(browser, base);
  const fresh = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  await p2.route("**/data/meta.json*", async r => {
    const body = JSON.parse(require("node:fs").readFileSync(path.join(__dirname, "../../docs/data/meta.json"), "utf8"));
    body.updated = fresh;
    await r.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await p2.goHash("#/");
  if (/stale/.test(await p2.evaluate(() => document.getElementById("updated").className)))
    bad("fresh data wrongly flagged stale");
  await c2.close();
});

section("ask stays honestly unavailable", async (browser, base) => {
  const { ctx, page } = await ctxPage(browser, base);
  await page.goHash("#/ask");
  const txt = await page.textContent("#app");
  if (!/switched off|unavailable/i.test(txt)) bad("#/ask does not state it is unavailable");
  if (await page.$(".askform")) bad("#/ask still renders a live question form while disabled");
  await ctx.close();
});

section("accessibility: names, tap targets, contrast", async (browser, base) => {
  const { ctx, page } = await ctxPage(browser, base);
  for (const h of ["#/", "#/events", "#/captions", "#/settings", "#/about"]) {
    await page.goHash(h);
    const unnamed = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll("button, a[href]").forEach(el => {
        if (el.offsetParent === null && !el.closest("header,footer")) return;
        const name = (el.getAttribute("aria-label") || el.title || el.textContent || "").trim();
        if (!name) out.push(el.tagName + "." + (el.className || "?"));
      });
      return [...new Set(out)].slice(0, 5);
    });
    if (unnamed.length) bad(`${h}: unnamed controls: ${unnamed.join(", ")}`);
    const small = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll("button").forEach(el => {
        if (el.offsetParent === null) return;
        const r = el.getBoundingClientRect();
        const after = getComputedStyle(el, "::after");
        const extended = after.content !== "none" && after.position === "absolute";
        if (!extended && (r.width < 30 || r.height < 30))
          out.push((el.className || el.textContent.trim()).slice(0, 24) + ` ${Math.round(r.width)}x${Math.round(r.height)}`);
      });
      return [...new Set(out)].slice(0, 5);
    });
    if (small.length) bad(`${h}: small tap targets: ${small.join(" | ")}`);
  }
  // contrast spot check in both themes
  for (const theme of ["light", "dark"]) {
    const { ctx: c, page: p } = await ctxPage(browser, base, { theme });
    await p.goHash("#/");
    const fails = await p.evaluate(() => {
      const lum = rgb => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
      const parse = s => { const m = s.match(/\d+(\.\d+)?/g); return m ? m.slice(0, 3).map(Number) : null; };
      const bgOf = el => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor, p = parse(c); if (p && !/rgba?\(0, 0, 0, 0\)/.test(c)) return p; } return [255, 255, 255]; };
      const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05); };
      const out = [];
      for (const sel of [".kicker", ".sub", "td.num", ".card h2", "p.lede", ".foot div", ".fol-sub", ".otd-t", ".abouttxt", ".yearopt", ".yearopt.on"]) {
        const el = document.querySelector(sel);
        if (!el || !el.textContent.trim()) continue;
        const cs = getComputedStyle(el), fg = parse(cs.color);
        if (!fg) continue;
        const r = ratio(fg, bgOf(el));
        const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 600;
        const min = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5;
        if (r < min) out.push(`${sel} ${r.toFixed(2)} < ${min}`);
      }
      return out;
    });
    if (fails.length) bad(`${theme}: contrast: ${fails.join(", ")}`);
    await c.close();
  }
  await ctx.close();
});

section("offline: shell loads from the service worker", async (browser, base) => {
  const { ctx, page } = await ctxPage(browser, base, { sw: true });
  await page.goto(base + "/index.html#/", { waitUntil: "load" });
  await page.waitForTimeout(2500); // let the SW install and cache the shell
  const swReady = await page.evaluate(() =>
    navigator.serviceWorker.getRegistration().then(r => !!(r && (r.active || r.waiting || r.installing))));
  if (!swReady) { bad("service worker never registered on localhost"); await ctx.close(); return; }
  await page.waitForTimeout(2000);
  await ctx.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => bad("offline reload failed outright"));
  await page.waitForTimeout(1800);
  const alive = await page.evaluate(() => !!document.querySelector("#nav") && document.body.innerText.length > 50);
  if (!alive) bad("offline shell did not render");
  await ctx.setOffline(false);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const back = await page.evaluate(() => document.body.innerText.includes("Scoreboard"));
  if (!back) bad("did not recover when back online");
  await ctx.close();
});

section("2027 rollover: a new season appears with zero code changes", async (browser, base) => {
  const { ctx, page } = await ctxPage(browser, base);
  const fs = require("node:fs");
  const dataDir = path.join(__dirname, "../../docs/data");
  const meta = JSON.parse(fs.readFileSync(path.join(dataDir, "meta.json"), "utf8"));
  meta.seasons = [{ year: 2027, events: 1 }, ...meta.seasons];
  const rk = { season: 2027, standings: { "World Class": { rows: [
    { rank: 1, corps: "Bluecoats", class: "World Class", score: 72.5, date: "2027-06-20",
      event: "First Show 2027", delta: null, prev_score: null, high: 72.5,
      high_event: "First Show 2027", high_date: "2027-06-20", trend: [["2027-06-20", 72.5]] },
    { rank: 2, corps: "Blue Devils", class: "World Class", score: 72.1, date: "2027-06-20",
      event: "First Show 2027", delta: null, prev_score: null, high: 72.1,
      high_event: "First Show 2027", high_date: "2027-06-20", trend: [["2027-06-20", 72.1]] },
  ] } } };
  const season27 = [{ name: "First Show 2027", date: "2027-06-20", location: "Akron, OH",
    classes: [{ class: "World Class", results: [
      { place: 1, corps: "Bluecoats", score: 72.5 }, { place: 2, corps: "Blue Devils", score: 72.1 }] }] }];
  await page.route("**/data/meta.json*", r => r.fulfill({ contentType: "application/json", body: JSON.stringify(meta) }));
  await page.route("**/data/rankings.json*", r => r.fulfill({ contentType: "application/json", body: JSON.stringify(rk) }));
  await page.route("**/data/seasons/2027.json*", r => r.fulfill({ contentType: "application/json", body: JSON.stringify(season27) }));
  await page.goHash("#/");
  const h1 = await page.textContent("h1.page");
  if (!/2027 Scoreboard/.test(h1)) bad(`scoreboard did not roll over: "${h1.trim()}"`);
  if (!/Bluecoats/.test(await page.textContent("#standings"))) bad("2027 standings not rendered");
  await page.goHash("#/events");
  await page.waitForTimeout(600);
  if (!/First Show 2027/.test(await page.textContent("#app"))) bad("2027 events not listed");
  if (page._errs.length) bad(page._errs[0]);
  await ctx.close();
});

// The "show all / show N more" control used to be position:sticky;bottom, which
// pins it to the VIEWPORT — so on any table taller than the screen it floated
// on top of the rows and hid real data. The a11y section passed throughout
// (the control was named, sized and contrasted fine), so nothing caught it.
// This asserts the thing that actually matters: no control may cover a cell.
section("no control covers table data", async (browser, base) => {
  for (const viewport of [PHONE, DESKTOP]) {
    const { ctx, page } = await ctxPage(browser, base, { viewport });
    for (const hash of ["#/records", "#/database", "#/"]) {
      await page.goHash(hash);
      await page.waitForTimeout(1200);
      const covered = await page.evaluate(() => {
        const hits = [];
        document.querySelectorAll(".expandwrap .tab, .expandwrap button").forEach(btn => {
          const r = btn.getBoundingClientRect();
          if (r.width < 4 || r.height < 4) return;
          for (const dx of [0.2, 0.5, 0.8]) {
            const x = r.left + r.width * dx, y = r.top + r.height / 2;
            if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
            const stack = document.elementsFromPoint(x, y);
            const i = stack.indexOf(btn);
            if (i < 0) continue;
            const cell = stack.slice(i + 1).find(e => e.tagName === "TD" || e.tagName === "TH");
            if (cell && (cell.innerText || "").trim())
              hits.push(`"${btn.innerText.trim().slice(0, 24)}" covers "${cell.innerText.trim().slice(0, 24)}"`);
          }
        });
        return [...new Set(hits)];
      });
      if (covered.length)
        bad(`${hash} @${viewport.width}px: ${covered.join("; ")}`);
    }
    if (page._errs.length) bad(page._errs[0]);
    await ctx.close();
  }
});

// The Database exists to answer "what did this corps score". On a phone the
// dense table's white-space:nowrap once let a long event name push CORPS and
// SCORE into the off-screen scroll, so the view showed ten identical event
// names and none of the answer. Assert the answer columns stay on screen.
section("database keeps corps and score on screen (phone)", async (browser, base) => {
  const { ctx, page } = await ctxPage(browser, base, { viewport: PHONE });
  await page.goHash("#/database");
  await page.waitForSelector("#dbtable tbody tr", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => {
    const sc = document.querySelector("#dbtable .tscroll");
    const row = document.querySelector("#dbtable tbody tr");
    if (!sc || !row) return null;
    const shown = [...row.children].filter(td => getComputedStyle(td).display !== "none");
    return {
      overflow: sc.scrollWidth - sc.clientWidth,
      last: shown.length ? shown[shown.length - 1].innerText.replace(/\s+/g, " ").trim() : "",
      cols: shown.length,
    };
  });
  if (!m) { bad("database table did not render"); await ctx.close(); return; }
  if (m.overflow > 2) bad(`table overflows its scroller by ${m.overflow}px — a column is cut off`);
  if (!/^\d+\.\d/.test(m.last)) bad(`last visible column is "${m.last}", expected the score`);
  if (m.cols < 4) bad(`only ${m.cols} columns visible on a phone`);
  if (page._errs.length) bad(page._errs[0]);
  await ctx.close();
});

// WGI is a second circuit with its own data namespace, divisions and classes.
// The things that must hold: it reaches a real standings table, the circuit
// strip gets you back to DCI, a division/class switch actually changes the
// rows, and a pre-2024 year admits it is championships-only rather than
// implying a whole season is listed.
section("wgi: circuit, division and class all switch", async (browser, base) => {
  const { ctx, page } = await ctxPage(browser, base, { viewport: PHONE });
  await page.goHash("#/wgi");
  await page.waitForTimeout(1500);

  // the wordmark is the circuit picker: it must open, list every mode, and
  // name the current one ("Cadence WGI Percussion")
  await page.click("#brandBtn");
  await page.waitForTimeout(400);
  const modes = await page.$$eval(".modeitem", as => as.map(a => a.dataset.mode));
  for (const want of ["dci", "wgi", "wgi:Color Guard", "wgi:Percussion", "wgi:Winds"])
    if (!modes.includes(want)) bad(`circuit menu is missing "${want}": ${JSON.stringify(modes)}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  if (!(await page.evaluate(() => document.getElementById("modeMenu").hidden)))
    bad("circuit menu did not close on Escape");

  const rows = await page.$$eval("#wgiBody tbody tr", trs => trs.length);
  if (!rows) { bad("no WGI standings rows rendered"); await ctx.close(); return; }

  const firstUnit = () => page.$eval("#wgiBody tbody tr td:nth-child(2)", td => td.innerText.trim());
  const before = await firstUnit();

  // switching class must change what is listed
  const chips = await page.$$eval(".chiprow a", as => as.map(a => a.getAttribute("href")));
  if (chips.length > 1) {
    const other = chips.find(h => !/\bon\b/.test(h)) || chips[1];
    await page.goHash(other.replace(/^#/, ""));
    await page.waitForTimeout(1200);
    const after = await firstUnit().catch(() => "");
    if (after && after === before)
      bad(`class switch did not change the standings (still "${before}")`);
  }

  // a finals-only (pre-2024) year must say so
  await page.goHash("#/wgi?y=2019");
  await page.waitForTimeout(1200);
  const body = await page.textContent("#app");
  if (!/World Championship/i.test(body))
    bad("a pre-2024 WGI year does not disclose that it is championships-only");

  // picking an activity names it in the wordmark and switches the data
  await page.goHash("#/wgi?d=Percussion");
  await page.waitForTimeout(1400);
  const brand = (await page.textContent(".brand")).replace(/\s+/g, " ").trim();
  if (!/WGI Percussion/.test(brand))
    bad(`wordmark does not name the active circuit: "${brand}"`);
  if (!/Percussion/.test(await page.textContent("h1.page")))
    bad("heading does not name the active activity");

  // A mode you can leave by tapping the next tab isn't a mode: every nav tab
  // must stay inside WGI, and none of them may land on "Page not found".
  for (const tab of ["Shows", "Units", "Stats", "Scoreboard"]) {
    const el = await page.$(`#nav a:has-text("${tab}")`);
    if (!el) { bad(`nav tab "${tab}" missing in WGI mode`); continue; }
    await el.click();
    await page.waitForTimeout(2200);
    const state = await page.evaluate(() => ({
      hash: location.hash,
      brand: document.querySelector(".brand").innerText.replace(/\s+/g, " ").trim(),
      notFound: /page not found/i.test(document.body.innerText),
    }));
    if (!state.hash.startsWith("#/wgi")) bad(`"${tab}" left WGI mode -> ${state.hash}`);
    if (state.notFound) bad(`"${tab}" in WGI mode is a dead route (${state.hash})`);
    if (!/WGI/.test(state.brand)) bad(`"${tab}" dropped the circuit from the wordmark`);
  }

  // and the menu gets back to DCI, where the wordmark and tabs revert
  await page.goHash("#/");
  await page.waitForTimeout(1200);
  if (!/Scoreboard/.test(await page.textContent("h1.page")))
    bad("did not return to the DCI scoreboard");
  const home = (await page.textContent(".brand")).replace(/\s+/g, " ").trim();
  if (/WGI/.test(home)) bad(`wordmark still says WGI on the DCI board: "${home}"`);
  const dciHrefs = await page.$$eval("#nav a", as => as.map(a => a.getAttribute("href")));
  if (dciHrefs.some(h => h.startsWith("#/wgi")))
    bad(`DCI nav still points into WGI: ${JSON.stringify(dciHrefs)}`);

  if (page._errs.length) bad(page._errs[0]);
  await ctx.close();
});

// Judge analytics publish numbers people will quote, so the view has to be
// honest about what is behind them: no agreement figure may appear without
// enough rooms under it, filters must actually filter, and the page must say
// what the numbers mean rather than leaving them to be guessed at.
section("judges: sampled honestly and explained", async (browser, base) => {
  const { ctx, page } = await ctxPage(browser, base, { viewport: PHONE });
  await page.goHash("#/judges");
  await page.waitForTimeout(1800);

  const rows = await page.$$eval("tbody tr", trs => trs.length);
  if (!rows) { bad("judges view rendered no rows"); await ctx.close(); return; }

  // the floor the build applied, read from the data rather than hard-coded
  const floor = await page.evaluate(async () => {
    const idx = await fetch("data/judges/index.json").then(r => r.json());
    const y = (idx.years || []).find(v => v.judges > 0);
    const doc = await fetch(`data/judges/${y.year}.json`).then(r => r.json());
    return {
      min: doc.floors.agreement_rooms,
      offenders: doc.judges.filter(j => j.agreement != null
                                   && j.agreement_rooms < doc.floors.agreement_rooms).length,
      shown: doc.judges.filter(j => j.agreement != null).length,
      total: doc.judges.length,
    };
  });
  if (floor.offenders)
    bad(`${floor.offenders} seats publish an agreement figure below the ${floor.min}-room floor`);
  if (!floor.shown) bad("no seat qualifies for an agreement figure at all");
  if (floor.shown === floor.total)
    bad("every seat shows agreement — the sample floor is not being applied");

  // the page must explain the numbers, not just print them
  const body = await page.textContent("#app");
  for (const term of ["Agreement", "Spread", "vs caption"])
    if (!body.includes(term)) bad(`the judges view never explains "${term}"`);

  // a caption filter narrows the table
  const chips = await page.$$eval(".chiprow a", as => as.map(a => a.getAttribute("href")));
  const capChip = chips.find(h => /[?&]c=[^&]+/.test(h) && !/c=&/.test(h));
  if (capChip) {
    await page.goHash(capChip);          // goHash wants the leading '#'
    await page.waitForTimeout(1200);
    const narrowed = await page.$$eval("tbody tr", trs => trs.length);
    if (narrowed >= rows) bad(`caption filter did not narrow the table (${rows} -> ${narrowed})`);
    const caps = await page.$$eval("tbody tr", trs =>
      [...new Set(trs.map(t => t.innerText.replace(/\s+/g, " ")))].length);
    if (!caps) bad("caption filter emptied the table");
  }

  if (page._errs.length) bad(page._errs[0]);
  await ctx.close();
});

// Captions is the thing most people open the app for, so it is a tab rather
// than a sub-tab of a seven-item Stats pile. The grouping has to hold: the
// caption-derived views sit together under Captions, the reference tools under
// Stats, and no tab may lead somewhere that doesn't exist in the current mode.
section("captions is a tab of its own", async (browser, base) => {
  const { ctx, page } = await ctxPage(browser, base, { viewport: PHONE });
  const visible = () => page.evaluate(() => [...document.querySelectorAll("#nav a")]
    .filter(a => !a.hidden)
    .map(a => ({ label: a.querySelector("span").textContent, href: a.getAttribute("href"),
                 on: a.classList.contains("active") })));

  await page.goHash("#/captions");
  await page.waitForTimeout(1200);
  const tabs = await visible();
  if (!tabs.some(t => t.label === "Captions")) bad("no Captions tab on DCI");
  if (!tabs.find(t => t.label === "Captions")?.on)
    bad("the Captions tab is not active on a captions view");

  // the three caption views sit under it, and keep it lit
  for (const [hash, sub] of [["#/captions", "Sheets"], ["#/breakdown", "Breakdown"], ["#/judges", "Judges"]]) {
    await page.goHash(hash);
    await page.waitForTimeout(1300);
    const subs = await page.$$eval(".subtabs a", as => as.map(a => a.innerText.trim()));
    for (const want of ["Sheets", "Breakdown", "Judges"])
      if (!subs.includes(want)) bad(`${hash}: caption sub-tabs missing "${want}"`);
    if (subs.includes("Database")) bad(`${hash}: still showing the Stats sub-tabs`);
    const nav = await visible();
    if (!nav.find(t => t.label === "Captions")?.on) bad(`${hash} does not light the Captions tab`);
  }

  // Stats keeps the reference tools and nothing caption-derived
  await page.goHash("#/compare");
  await page.waitForTimeout(1300);
  const statSubs = await page.$$eval(".subtabs a", as => as.map(a => a.innerText.trim()));
  for (const want of ["Compare", "Champions", "Records", "Database"])
    if (!statSubs.includes(want)) bad(`Stats sub-tabs missing "${want}"`);
  for (const gone of ["Sheets", "Breakdown", "Judges"])
    if (statSubs.includes(gone)) bad(`"${gone}" is still under Stats`);

  // WGI has no caption data yet, so it must not show a tab that leads nowhere
  await page.goHash("#/wgi?d=Percussion");
  await page.waitForTimeout(1500);
  const wgiTabs = await visible();
  if (wgiTabs.some(t => t.label === "Captions"))
    bad("WGI shows a Captions tab but has no caption data behind it");
  for (const t of wgiTabs)
    if (!/^#\/wgi/.test(t.href)) bad(`WGI nav tab "${t.label}" points outside the circuit (${t.href})`);

  if (page._errs.length) bad(page._errs[0]);
  await ctx.close();
});

// The breakdown is a diagnostic: someone reads it to decide what to fix. So
// it must not quietly omit a caption the sheet lacks (roughly 2-5% of rows,
// including the 2026 Finals sheet), and the head-to-head must actually
// account for the margin it claims.
section("breakdown: complete captions and an honest margin", async (browser, base) => {
  const { ctx, page } = await ctxPage(browser, base, { viewport: PHONE });
  await page.goHash("#/breakdown");
  await page.waitForTimeout(2000);
  if (!/Where they stand/.test(await page.textContent("#app")))
    { bad("breakdown did not render"); await ctx.close(); return; }

  // every caption the app knows about appears, present or explicitly absent
  const labels = await page.$$eval("tbody tr td:first-child",
    tds => tds.map(t => t.innerText.trim()));
  for (const want of ["GE 1", "GE 2", "General Effect", "Brass", "Music"])
    if (!labels.includes(want)) bad(`standing table is missing the "${want}" line`);

  // a sheet missing a caption must say so rather than drop the row
  const missing = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("tbody tr")];
    return rows.filter(r => /not on this sheet/i.test(r.innerText)).length;
  });
  const note = await page.$eval("#app", el => el.innerText);
  if (missing && !/didn't carry/.test(note))
    bad("a caption is blank but nothing explains why");

  // head-to-head: the caption margins must sum to the stated total margin
  await page.goHash("#/breakdown?y=2026&cl=World%20Class&c=Blue%20Devils&v=Bluecoats");
  await page.waitForTimeout(2000);
  const h2h = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".card")].find(c => /^Against /.test(c.querySelector("h2")?.innerText || ""));
    if (!card) return null;
    const stated = (card.querySelector(".evdone")?.innerText.match(/([+-]\d+\.\d+)/) || [])[1];
    const rows = [...card.querySelectorAll("tbody tr")].map(r => {
      const td = [...r.children];
      return { label: td[0].innerText.trim(), delta: parseFloat(td[td.length - 1].innerText) };
    });
    return { stated: stated == null ? null : parseFloat(stated), rows };
  });
  if (!h2h) { bad("head-to-head card did not render for a known pairing"); await ctx.close(); return; }
  if (h2h.stated == null) bad("head-to-head states no total margin");
  const groups = h2h.rows.filter(r => ["General Effect", "Visual", "Music"].includes(r.label));
  if (groups.length === 3 && h2h.stated != null) {
    const sum = +groups.reduce((n, r) => n + r.delta, 0).toFixed(3);
    // group totals are what the published total is built from; a penalty can
    // shift it, so allow a small slack rather than demanding exactness
    if (Math.abs(sum - h2h.stated) > 0.2)
      bad(`head-to-head margins don't account for the total: groups ${sum} vs stated ${h2h.stated}`);
  }
  if (page._errs.length) bad(page._errs[0]);
  await ctx.close();
});

// ---------------------------------------------------------------------------
(async () => {
  const { srv, port } = await start();
  const base = `http://127.0.0.1:${port}`;
  const browser = await pw.chromium.launch({ executablePath: EXECUTABLE });
  const t0 = Date.now();
  for (const [name, fn] of sections) {
    currentSection = name;
    const n0 = findings.length;
    const s0 = Date.now();
    try { await fn(browser, base); }
    catch (e) { bad("CRASHED: " + e.message.slice(0, 200)); }
    const dt = ((Date.now() - s0) / 1000).toFixed(1);
    console.log(`${findings.length === n0 ? "  ok " : "  FAIL"} ${name} (${dt}s)`);
  }
  await browser.close();
  srv.close();
  console.log(`\n${sections.length} sections in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (findings.length) {
    console.log(`\n${findings.length} finding(s):`);
    findings.forEach(f => console.log("  - " + f));
    process.exit(1);
  }
  console.log("QA CLEAN");
})();
