/* Corps Central SPA */
(function () {
  const app = document.getElementById("app");
  const { lineChart, sparkline, PALETTE, esc } = window.CCViz;
  const cache = new Map();

  async function data(path) {
    if (cache.has(path)) return cache.get(path);
    const p = fetch("data/" + path).then(r => {
      if (!r.ok) throw new Error(path + " " + r.status);
      return r.json();
    });
    cache.set(path, p);
    try { return await p; } catch (e) { cache.delete(path); throw e; }
  }

  const fmtScore = v => v == null ? "—" : (+v).toFixed(3).replace(/0+$/, "").replace(/\.$/, ".0").replace(/(\.\d)$/, "$1");
  const score3 = v => v == null ? "—" : (+v).toFixed(3);
  const h = (strings, ...vals) => strings.map((s, i) => s + (vals[i] == null ? "" : vals[i])).join("");

  function deltaHtml(d) {
    if (d == null) return '<span class="delta flat">—</span>';
    if (Math.abs(d) < 0.001) return '<span class="delta flat">±0.0</span>';
    const cls = d > 0 ? "up" : "down";
    const arrow = d > 0 ? "▲" : "▼";
    return `<span class="delta ${cls}">${arrow} ${Math.abs(d).toFixed(2)}</span>`;
  }

  function corpsLink(name) {
    const slug = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return `<a href="#/corps/${slug}">${esc(name)}</a>`;
  }

  function setNav(route) {
    document.querySelectorAll("#nav a").forEach(a =>
      a.classList.toggle("active", a.dataset.route === route));
  }

  const CLASS_ORDER = ["World Class", "Open Class", "All-Age", "Class A", "Division III", "Other"];
  function sortClasses(names) {
    return names.sort((a, b) => {
      const ia = CLASS_ORDER.indexOf(a), ib = CLASS_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
  }

  /* ---------------- TODAY ---------------- */
  async function viewToday() {
    setNav("today");
    const [today, meta] = await Promise.all([data("today.json"), data("meta.json")]);
    const classes = sortClasses(Object.keys(today.standings || {}));
    if (!classes.length) {
      app.innerHTML = `<h1 class="page">Today</h1><div class="card"><div class="empty">
        No scored ${today.season} events yet — the dashboard fills in automatically as the season begins.
        Meanwhile, explore <a href="#/seasons">50+ years of seasons</a> or <a href="#/champions">champions history</a>.</div></div>`;
      renderNewsCard(document.createElement("div"));
      return;
    }
    const sel = localStorage.getItem("cc-class");
    const cls = classes.includes(sel) ? sel : classes[0];
    app.innerHTML = h`
      <h1 class="page">Season pulse <span class="kicker">· ${esc(String(today.season))} · as of ${esc(today.generated)}</span></h1>
      <div class="filters" id="classTabs"></div>
      <div class="grid cols-2">
        <div class="card">
          <h2>Latest standings <span class="sub">most recent score per corps</span></h2>
          <div id="standings"></div>
        </div>
        <div style="display:grid;gap:14px;align-content:start">
          <div class="card" id="jumpCard"></div>
          <div class="card" id="battleCard"></div>
          <div class="card" id="recentCard"></div>
        </div>
      </div>
      <div class="card" style="margin-top:14px">
        <h2>Score progression <span class="sub">season trend, top corps</span></h2>
        <div class="chartwrap" id="trendChart"></div>
      </div>
      <div class="grid cols-2" style="margin-top:14px">
        <div class="card" id="newsCard"><h2>Latest news</h2><div id="newsList"></div></div>
        <div class="card" id="metaCard"></div>
      </div>`;

    const tabs = document.getElementById("classTabs");
    classes.forEach(c => {
      const b = document.createElement("button");
      b.className = "tab" + (c === cls ? " on" : "");
      b.textContent = c + ` (${today.standings[c].rows.length})`;
      b.onclick = () => { localStorage.setItem("cc-class", c); viewToday(); };
      tabs.appendChild(b);
    });

    renderStandings(today.standings[cls]);
    renderTrend(today.standings[cls]);
    renderSide(today.standings[cls], today);
    renderNewsCard(document.getElementById("newsList"), today.news);
    document.getElementById("metaCard").innerHTML = h`
      <h2>Dataset</h2>
      <div class="grid cols-tiles">
        <div class="tile"><div class="label">Events indexed</div><div class="value">${(meta.counts.events || 0).toLocaleString()}</div><div class="sub">across DCI & DCA</div></div>
        <div class="tile"><div class="label">Corps tracked</div><div class="value">${meta.counts.corps || 0}</div><div class="sub">1972 – today</div></div>
        <div class="tile"><div class="label">Finals seasons</div><div class="value">${meta.counts.finals_years || 0}</div><div class="sub">with full results</div></div>
      </div>
      <p style="color:var(--muted);font-size:12.5px;margin:10px 0 0">Data refreshes automatically twice a day. <a href="#/about">Sources & methodology →</a></p>`;
  }

  function renderStandings(block) {
    const rows = block.rows.map(r => h`
      <tr>
        <td class="rank">${r.rank}</td>
        <td>${corpsLink(r.corps)}<div style="font-size:11.5px;color:var(--muted)">${esc(r.event)} · ${esc(r.date || "")}</div></td>
        <td class="num score">${score3(r.score)}</td>
        <td class="num">${deltaHtml(r.delta)}</td>
        <td class="col-trend"><span class="sparkcell" data-trend="${r.trend.join(",")}"></span></td>
      </tr>`).join("");
    document.getElementById("standings").innerHTML =
      `<table class="t standings"><thead><tr><th>#</th><th>Corps · last event</th><th class="num">Score</th><th class="num">vs prev</th><th class="col-trend">Trend</th></tr></thead><tbody>${rows}</tbody></table>`;
    document.querySelectorAll(".sparkcell").forEach((elm, i) => {
      const vals = elm.dataset.trend.split(",").map(Number).filter(n => !isNaN(n));
      sparkline(elm, vals, "#52514e");
    });
  }

  function renderTrend(block) {
    const top = block.rows.slice(0, 8);
    // union of dates isn't stored; chart per-outing index instead
    const maxN = Math.max(...top.map(r => r.trend.length));
    const xLabels = Array.from({ length: maxN }, (_, i) => "Show " + (i + 1 + Math.max(0, (top[0].outings || maxN) - maxN)));
    const series = top.map(r => ({
      name: r.corps,
      points: r.trend.map((v, i) => ({ x: i + (maxN - r.trend.length), y: v })),
    }));
    lineChart(document.getElementById("trendChart"), { series, xLabels, height: 330 });
  }

  function renderSide(block, today) {
    const jump = block.movers && block.movers[0];
    document.getElementById("jumpCard").innerHTML = jump ? h`
      <h2>Biggest move <span class="sub">latest outing vs previous</span></h2>
      <div class="tile" style="border:0;padding:4px 0">
        <div class="value" style="font-size:24px">${corpsLink(jump.corps)}</div>
        <div class="sub">${score3(jump.prev_score)} → <b>${score3(jump.score)}</b> ${deltaHtml(jump.delta)}</div>
      </div>
      ${(block.movers.slice(1).map(m => `<div style="font-size:13px;margin-top:6px">${corpsLink(m.corps)} ${deltaHtml(m.delta)}</div>`)).join("")}`
      : "<h2>Biggest move</h2><div class='empty'>Need two outings.</div>";

    const b = block.battles && block.battles[0];
    document.getElementById("battleCard").innerHTML = b ? h`
      <h2>Closest battle <span class="sub">smallest gap in the standings</span></h2>
      <table class="t">
        <tr><td class="rank">${b.ra}</td><td>${corpsLink(b.a)}</td><td class="num score">${score3(b.sa)}</td></tr>
        <tr><td class="rank">${b.rb}</td><td>${corpsLink(b.b)}</td><td class="num score">${score3(b.sb)}</td></tr>
      </table>
      <div style="margin-top:8px;font-size:13px;color:var(--text-secondary)">Gap: <b style="color:var(--series-6)">${b.gap.toFixed(3)}</b></div>
      ${(block.battles.slice(1).map(x => `<div style="font-size:12.5px;color:var(--muted);margin-top:5px">${esc(x.a)} vs ${esc(x.b)} · ${x.gap.toFixed(3)}</div>`)).join("")}`
      : "<h2>Closest battle</h2><div class='empty'>—</div>";

    const rec = (today.recent_events || []).slice(0, 6).map(ev => h`
      <div style="padding:7px 0;border-bottom:1px solid var(--grid);font-size:13px">
        <div><b>${esc(ev.name)}</b> <span class="kicker">${esc(ev.date || "")}</span></div>
        <div style="color:var(--text-secondary)">${ev.winner ? `🏆 ${esc(ev.winner.corps)} · ${score3(ev.winner.score)}` : ""} <span class="kicker">${esc(ev.location || "")}</span></div>
      </div>`).join("");
    document.getElementById("recentCard").innerHTML = `<h2>Recent events</h2>${rec || "<div class='empty'>—</div>"}
      <div style="margin-top:8px"><a href="#/seasons">All events →</a></div>`;
  }

  function renderNewsCard(container, items) {
    const render = list => {
      container.innerHTML = list.slice(0, 8).map(n => h`
        <div class="newsitem">
          <span class="src">${esc(n.source)}${n.date ? " · " + esc(n.date) : ""}</span>
          <div><a href="${encodeURI(n.url)}" rel="noopener" target="_blank">${esc(n.title)}</a></div>
          ${n.summary ? `<div class="sum">${esc(n.summary)}</div>` : ""}
        </div>`).join("") + `<div style="margin-top:8px"><a href="#/news">All news →</a></div>`;
    };
    if (items) render(items);
    else data("news.json").then(render).catch(() => { container.innerHTML = "<div class='empty'>—</div>"; });
  }

  /* ---------------- RANKINGS ---------------- */
  async function viewRankings() {
    setNav("rankings");
    const today = await data("today.json");
    const classes = sortClasses(Object.keys(today.standings || {}));
    app.innerHTML = `<h1 class="page">Season rankings</h1>
      <p class="lede">Every corps' latest score, season high, and full progression for the ${today.season} season, split by class.</p>
      <div id="blocks"></div>`;
    const blocks = document.getElementById("blocks");
    if (!classes.length) { blocks.innerHTML = "<div class='card'><div class='empty'>No scores yet this season.</div></div>"; return; }
    for (const cls of classes) {
      const b = today.standings[cls];
      const card = document.createElement("div");
      card.className = "card";
      card.style.marginBottom = "14px";
      const rows = b.rows.map(r => h`
        <tr><td class="rank">${r.rank}</td><td>${corpsLink(r.corps)}</td>
        <td class="num score">${score3(r.score)}</td>
        <td class="num">${score3(Math.max(...r.trend))}</td>
        <td class="num">${deltaHtml(r.delta)}</td>
        <td class="num" style="color:var(--muted)">${r.outings}</td></tr>`).join("");
      card.innerHTML = `<h2>${esc(cls)}</h2>
        <table class="t"><thead><tr><th>#</th><th>Corps</th><th class="num">Latest</th><th class="num">Season high</th><th class="num">Δ last</th><th class="num">Shows</th></tr></thead>
        <tbody>${rows}</tbody></table>
        <div class="chartwrap" style="margin-top:12px" id="rk-${cls.replace(/\W/g, "")}"></div>`;
      blocks.appendChild(card);
      const top = b.rows.slice(0, 6);
      const maxN = Math.max(...top.map(r => r.trend.length));
      lineChart(card.querySelector(".chartwrap"), {
        series: top.map(r => ({ name: r.corps, points: r.trend.map((v, i) => ({ x: i + (maxN - r.trend.length), y: v })) })),
        xLabels: Array.from({ length: maxN }, (_, i) => "Show " + (i + 1)),
        height: 280,
      });
    }
  }

  /* ---------------- SEASONS ---------------- */
  async function viewSeasons() {
    setNav("seasons");
    const meta = await data("meta.json");
    const finals = await data("finals_history.json").catch(() => []);
    const dciYears = new Map((meta.seasons.dci || []).map(s => [s.year, s.events]));
    for (const f of finals) if (!dciYears.has(f.year)) dciYears.set(f.year, 1);
    const years = [...dciYears.keys()].sort((a, b) => b - a);
    const dcaYears = (meta.seasons.dca || []).sort((a, b) => b.year - a.year);
    app.innerHTML = h`
      <h1 class="page">Season browser</h1>
      <p class="lede">Every season in the archive. Recent DCI seasons include full event-by-event results with caption recaps; 1972–2000 currently carries championship results, repertoires and caption recaps from the vault.</p>
      <div class="card"><h2>DCI <span class="sub">${years.length} seasons</span></h2><div class="years">
        ${years.map(y => `<a class="year" href="#/season/dci/${y}">${y}<small>${dciYears.get(y) > 1 ? dciYears.get(y) + " events" : "championships"}</small></a>`).join("")}
      </div></div>
      <div class="card" style="margin-top:14px"><h2>DCA <span class="sub">${dcaYears.length} seasons with events · <a href="#/champions">champions to 1965 →</a></span></h2><div class="years">
        ${dcaYears.map(s => `<a class="year" href="#/season/dca/${s.year}">${s.year}<small>${s.events} events</small></a>`).join("")}
      </div></div>`;
  }

  async function viewSeason(circuit, year) {
    setNav("seasons");
    let events = null;
    try { events = await data(`seasons/${circuit}_${year}.json`); } catch (e) { /* vault only */ }
    if (!events) {
      if (circuit === "dci") { viewVaultYear(year); return; }
      app.innerHTML = "<div class='card'><div class='empty'>No data for this season.</div></div>";
      return;
    }
    const rows = events.map((ev, i) => {
      let winner = null;
      for (const c of ev.classes || []) {
        const r0 = (c.results || []).slice().sort((a, b) => a.place - b.place)[0];
        if (r0 && (!winner || (r0.score || 0) > (winner.score || 0))) winner = { ...r0, cls: c.class };
      }
      return h`<tr class="rowlink" onclick="location.hash='#/event/${circuit}/${year}/${i}'">
        <td style="color:var(--muted);white-space:nowrap">${esc(ev.date || ev.date_display || "")}</td>
        <td><b>${esc(ev.name)}</b><div style="font-size:12px;color:var(--muted)">${esc(ev.location || "")}</div></td>
        <td>${winner ? `${esc(winner.corps)} <span class="kicker">${score3(winner.score)}</span>` : ""}</td>
        <td>${(ev.recap && ev.recap.length) ? '<span class="pill">captions</span>' : ""}</td></tr>`;
    }).join("");
    app.innerHTML = h`
      <div class="crumbs"><a href="#/seasons">Seasons</a> / ${circuit.toUpperCase()} ${year}</div>
      <h1 class="page">${circuit.toUpperCase()} ${year} <span class="kicker">· ${events.length} events</span></h1>
      <div class="card"><table class="t">
        <thead><tr><th>Date</th><th>Event</th><th>Top score</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
  }

  async function viewEvent(circuit, year, idx) {
    setNav("seasons");
    const events = await data(`seasons/${circuit}_${year}.json`);
    const ev = events[+idx];
    if (!ev) { app.innerHTML = "<div class='empty'>Event not found.</div>"; return; }
    const classBlocks = (ev.classes || []).map(c => h`
      <div class="card" style="margin-bottom:14px"><h2>${esc(c.class)}</h2>
      <table class="t"><thead><tr><th>#</th><th>Corps</th><th class="num">Score</th></tr></thead><tbody>
      ${c.results.slice().sort((a, b) => a.place - b.place).map(r =>
        `<tr><td class="rank">${r.place}</td><td>${corpsLink(r.corps)}</td><td class="num score">${score3(r.score)}</td></tr>`).join("")}
      </tbody></table></div>`).join("");
    const recapBlocks = (ev.recap || []).map(rc => {
      const caps = (rc.captions || []).filter(Boolean);
      return h`<div class="card" style="margin-bottom:14px">
        <h2>Caption recap — ${esc(rc.class)}</h2>
        <div class="recapscroll"><table class="t">
          ${caps.length ? `<thead><tr>${caps.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>` : ""}
          <tbody>${rc.rows.map(r => `<tr>${r.cells.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table></div>
        ${ev.recap_url ? `<div style="margin-top:8px;font-size:12.5px"><a href="${encodeURI(ev.recap_url)}" target="_blank" rel="noopener">Official recap ↗</a></div>` : ""}
      </div>`;
    }).join("");
    app.innerHTML = h`
      <div class="crumbs"><a href="#/seasons">Seasons</a> / <a href="#/season/${circuit}/${year}">${circuit.toUpperCase()} ${year}</a> / ${esc(ev.name)}</div>
      <h1 class="page">${esc(ev.name)}</h1>
      <p class="lede">${esc(ev.date_display || ev.date || "")}${ev.location ? " · " + esc(ev.location) : ""}
        ${ev.url ? ` · <a href="${encodeURI(ev.url)}" target="_blank" rel="noopener">source ↗</a>` : ""}</p>
      ${classBlocks}${recapBlocks}`;
  }

  /* ---------------- VAULT (pre-2001 years) ---------------- */
  async function viewVaultYear(year) {
    const finals = await data("finals_history.json").catch(() => []);
    const row = finals.find(f => f.year === +year);
    let recap = null;
    try { recap = await data(`history/finals_recap_${year}.json`); } catch (e) {}
    if (!row) { app.innerHTML = "<div class='card'><div class='empty'>No archive data for this year.</div></div>"; return; }
    app.innerHTML = h`
      <div class="crumbs"><a href="#/seasons">Seasons</a> / DCI ${year}</div>
      <h1 class="page">DCI ${year} World Championship Finals</h1>
      <div class="card"><h2>Finals results</h2>
      <table class="t"><thead><tr><th>#</th><th>Corps</th><th class="num">Score</th><th>Repertoire</th></tr></thead><tbody>
      ${row.results.map(r => h`<tr><td class="rank">${r.place}</td><td>${corpsLink(r.corps)}${r.place === 1 ? ' <span class="badge-champ">★</span>' : ""}</td>
        <td class="num score">${score3(r.score)}</td><td style="color:var(--text-secondary);font-size:12.5px">${esc(r.repertoire || "")}</td></tr>`).join("")}
      </tbody></table></div>
      ${recap && recap.text ? `<div class="card" style="margin-top:14px"><h2>Caption recap (archival)</h2><pre class="vault">${esc(recap.text)}</pre></div>` : ""}`;
  }

  async function viewVault() {
    setNav("history");
    const finals = await data("finals_history.json").catch(() => []);
    const champs = finals.map(f => {
      const w = f.results.find(r => r.place === 1);
      return { year: f.year, corps: w ? w.corps : "?", score: w ? w.score : null, n: f.results.length };
    }).sort((a, b) => b.year - a.year);
    app.innerHTML = h`
      <h1 class="page">The Vault <span class="kicker">· archival finals 1972–2004</span></h1>
      <p class="lede">Complete DCI World Championship Finals results with repertoires and archival caption recaps, courtesy of The Sound Machine archive. For 2001-present event-by-event results, use the <a href="#/seasons">season browser</a>.</p>
      <div class="card"><div class="chartwrap" id="champChart"></div></div>
      <div class="card" style="margin-top:14px"><table class="t">
        <thead><tr><th>Year</th><th>Champion</th><th class="num">Winning score</th><th class="num">Finalists</th><th></th></tr></thead>
        <tbody>${champs.map(c => h`<tr class="rowlink" onclick="location.hash='#/season/dci/${c.year}'">
          <td class="num" style="text-align:left">${c.year}</td><td><b>${esc(c.corps)}</b> <span class="badge-champ">★</span></td>
          <td class="num score">${score3(c.score)}</td><td class="num">${c.n}</td><td style="color:var(--muted)">recap →</td></tr>`).join("")}
        </tbody></table></div>`;
    const chrono = champs.slice().reverse();
    lineChart(document.getElementById("champChart"), {
      linearX: true,
      series: [{ name: "Winning score", points: chrono.map(c => ({ x: c.year, y: c.score })) }],
      height: 260, yFmt: v => v.toFixed(1), xFmt: v => String(Math.round(v)),
    });
  }

  /* ---------------- CORPS ---------------- */
  async function viewCorpsList() {
    setNav("corps");
    const idx = await data("corps_index.json");
    app.innerHTML = `
      <h1 class="page">Corps directory</h1>
      <p class="lede">Every corps with a recorded performance, DCI and DCA, 1972–today — from Blue Devils to the Govenaires. Missing someone? They'll appear as soon as a source publishes a score. Want raw rows instead? Try the <a href="#/database">full database</a>.</p>
      <div class="filters">
        <input class="ctrl" id="q" placeholder="Search corps…">
        <button class="tab" data-f="all">All</button>
        <button class="tab" data-f="active">Active (last 2 yrs)</button>
        <button class="tab" data-f="dci">DCI</button>
        <button class="tab" data-f="dca">DCA</button>
      </div>
      <div class="card"><table class="t"><thead>
        <tr><th>Corps</th><th class="num">Seasons</th><th>Years</th><th class="num">Best score</th><th class="num">Perfs</th><th>Circuit</th></tr>
      </thead><tbody id="rows"></tbody></table></div>`;
    const rowsEl = document.getElementById("rows");
    const nowYear = new Date().getFullYear();
    let filter = "all";
    function render() {
      const q = document.getElementById("q").value.toLowerCase();
      const list = idx.filter(c => {
        if (q && !c.name.toLowerCase().includes(q)) return false;
        if (filter === "active" && c.last < nowYear - 1) return false;
        if ((filter === "dci" || filter === "dca") && !c.circuits.includes(filter)) return false;
        return true;
      }).sort((a, b) => b.last - a.last || b.best - a.best);
      rowsEl.innerHTML = list.slice(0, 400).map(c => h`
        <tr class="rowlink" onclick="location.hash='#/corps/${c.slug}'">
          <td><b>${esc(c.name)}</b></td><td class="num">${c.seasons}</td>
          <td style="color:var(--muted)">${c.first}–${c.last}</td>
          <td class="num score">${score3(c.best)}</td><td class="num">${c.n}</td>
          <td>${c.circuits.map(x => `<span class="pill">${x.toUpperCase()}</span>`).join(" ")}</td></tr>`).join("")
        || "<tr><td colspan='6' class='empty'>No matches.</td></tr>";
    }
    document.getElementById("q").addEventListener("input", render);
    document.querySelectorAll(".tab[data-f]").forEach(b => b.onclick = () => {
      filter = b.dataset.f;
      document.querySelectorAll(".tab[data-f]").forEach(x => x.classList.toggle("on", x === b));
      render();
    });
    document.querySelector(".tab[data-f=all]").classList.add("on");
    render();
  }

  async function viewCorps(slug) {
    setNav("corps");
    let detail;
    try { detail = await data(`corps/${slug}.json`); }
    catch (e) { app.innerHTML = "<div class='card'><div class='empty'>Corps not found.</div></div>"; return; }
    const champs = await data("champions.json").catch(() => ({ dci: {}, dca: {} }));
    const perfs = detail.performances;
    const titles = [];
    for (const [yr, byCls] of Object.entries(champs.dci || {}))
      for (const [cls, w] of Object.entries(byCls))
        if (w.corps === detail.name) titles.push(`${yr} DCI ${cls}`);
    for (const [yr, byCls] of Object.entries(champs.dca || {}))
      for (const [cls, w] of Object.entries(byCls))
        if (w.corps === detail.name) titles.push(`${yr} DCA ${cls}`);

    const byYear = new Map();
    for (const p of perfs) {
      if (!byYear.has(p.y)) byYear.set(p.y, []);
      byYear.get(p.y).push(p);
    }
    const years = [...byYear.keys()].sort();
    const series = years.map(y => Math.max(...byYear.get(y).map(p => p.s || 0)));
    const best = Math.max(...series);
    const finalsApps = perfs.filter(p => /world championship final/i.test(p.ev || "")).length;

    app.innerHTML = h`
      <div class="crumbs"><a href="#/corps">Corps</a> / ${esc(detail.name)}</div>
      <h1 class="page">${esc(detail.name)}</h1>
      <div class="grid cols-tiles" style="margin-bottom:14px">
        <div class="tile"><div class="label">Recorded performances</div><div class="value">${perfs.length}</div><div class="sub">${years[0]}–${years[years.length - 1]}</div></div>
        <div class="tile"><div class="label">All-time best</div><div class="value">${score3(best)}</div></div>
        <div class="tile"><div class="label">Championships</div><div class="value">${titles.length}</div><div class="sub">${titles.length ? esc(titles.slice(-3).join(" · ")) : "—"}</div></div>
        <div class="tile"><div class="label">Finals appearances</div><div class="value">${finalsApps}</div><div class="sub">in dataset</div></div>
      </div>
      <div class="card"><h2>Season-best score by year</h2><div class="chartwrap" id="corpsChart"></div></div>
      <div class="card" style="margin-top:14px"><h2>Performance log</h2>
        <div class="filters"><select class="ctrl" id="yearSel"><option value="">All years</option>
          ${years.slice().reverse().map(y => `<option>${y}</option>`).join("")}</select></div>
        <div id="perfTable"></div></div>`;

    lineChart(document.getElementById("corpsChart"), {
      linearX: true,
      series: [{ name: "Season best", points: years.map((y, i) => ({ x: y, y: series[i] })) }],
      height: 280, yFmt: v => v.toFixed(0), xFmt: v => String(Math.round(v)),
    });

    function renderPerfs() {
      const yv = document.getElementById("yearSel").value;
      const list = perfs.filter(p => !yv || p.y === +yv).slice().sort((a, b) => (b.d || "").localeCompare(a.d || "") || b.y - a.y);
      document.getElementById("perfTable").innerHTML = `<table class="t">
        <thead><tr><th>Date</th><th>Event</th><th>Class</th><th class="num">Place</th><th class="num">Score</th></tr></thead>
        <tbody>${list.slice(0, 500).map(p => h`<tr>
          <td style="color:var(--muted);white-space:nowrap">${esc(p.d || p.y)}</td>
          <td>${esc(p.ev || "")}${p.rep ? `<div style="font-size:11.5px;color:var(--muted)">${esc(p.rep)}</div>` : ""}</td>
          <td><span class="pill">${esc(p.cls || "")}</span></td>
          <td class="num">${p.p ?? "—"}</td><td class="num score">${score3(p.s)}</td></tr>`).join("")}</tbody></table>`;
    }
    document.getElementById("yearSel").addEventListener("change", renderPerfs);
    renderPerfs();
  }

  /* ---------------- DATABASE (full sortable) ---------------- */
  const DB = { rows: null, sort: [0, -1] };
  async function loadDb() {
    if (DB.rows) return DB.rows;
    const idx = await data("db/index.json");
    const parts = await Promise.all(idx.map(d => data(`db/perfs_${d.decade}.json`)));
    DB.rows = parts.flat();
    return DB.rows;
  }

  async function viewDatabase() {
    setNav("database");
    app.innerHTML = `<h1 class="page">Full database</h1>
      <p class="lede">Every recorded performance in the archive — DCI and DCA, 1972 to today. Click a column header to sort; combine filters freely. <span id="dbcount" class="kicker"></span></p>
      <div class="filters">
        <input class="ctrl" id="fq" placeholder="Search corps or event…">
        <select class="ctrl" id="fcir"><option value="">Both circuits</option><option value="dci">DCI</option><option value="dca">DCA</option></select>
        <select class="ctrl" id="fcls"><option value="">All classes</option></select>
        <select class="ctrl" id="fy1"></select>
        <select class="ctrl" id="fy2"></select>
        <button class="tab" id="csv">Export CSV</button>
      </div>
      <div class="card"><div id="dbtable"><div class="loading">Loading full archive…</div></div></div>`;
    let rows;
    try { rows = await loadDb(); }
    catch (e) { document.getElementById("dbtable").innerHTML = "<div class='empty'>The database builds with the first data run — check back shortly.</div>"; return; }

    const years = [...new Set(rows.map(r => r[0]))].sort();
    const classes = [...new Set(rows.map(r => r[4]).filter(Boolean))].sort();
    const fy1 = document.getElementById("fy1"), fy2 = document.getElementById("fy2");
    years.forEach(y => { fy1.add(new Option(y, y)); fy2.add(new Option(y, y)); });
    fy1.value = years[0]; fy2.value = years[years.length - 1];
    const fcls = document.getElementById("fcls");
    classes.forEach(c => fcls.add(new Option(c, c)));

    const COLS = ["Year", "Date", "Event", "Corps", "Class", "Circuit", "Place", "Score"];
    let filtered = rows;

    function apply() {
      const q = document.getElementById("fq").value.toLowerCase();
      const cir = document.getElementById("fcir").value;
      const cls = fcls.value;
      const y1 = +fy1.value, y2 = +fy2.value;
      filtered = rows.filter(r =>
        r[0] >= y1 && r[0] <= y2 &&
        (!cir || r[5] === cir) &&
        (!cls || r[4] === cls) &&
        (!q || (r[3] || "").toLowerCase().includes(q) || (r[2] || "").toLowerCase().includes(q)));
      const [ci, dir] = DB.sort;
      filtered = filtered.slice().sort((a, b) => {
        const av = a[ci], bv = b[ci];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (typeof av === "number" ? av - bv : String(av).localeCompare(String(bv))) * dir;
      });
      render();
    }

    function render() {
      const LIMIT = 800;
      document.getElementById("dbcount").textContent = `· ${filtered.length.toLocaleString()} performances${filtered.length > LIMIT ? ` (showing first ${LIMIT} — narrow with filters or export CSV)` : ""}`;
      const [ci, dir] = DB.sort;
      const head = COLS.map((c, i) =>
        `<th style="cursor:pointer;user-select:none" data-c="${i}">${c}${i === ci ? (dir > 0 ? " ↑" : " ↓") : ""}</th>`).join("");
      const body = filtered.slice(0, LIMIT).map(r => h`<tr>
        <td class="num" style="text-align:left">${r[0]}</td>
        <td style="color:var(--muted);white-space:nowrap">${esc(r[1] || "")}</td>
        <td>${esc(r[2] || "")}</td>
        <td>${corpsLink(r[3])}</td>
        <td><span class="pill">${esc(r[4] || "")}</span></td>
        <td style="color:var(--muted)">${(r[5] || "").toUpperCase()}</td>
        <td class="num">${r[6] ?? "—"}</td>
        <td class="num score">${score3(r[7])}</td></tr>`).join("");
      document.getElementById("dbtable").innerHTML =
        `<div class="recapscroll"><table class="t"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
      document.querySelectorAll("#dbtable th").forEach(th => th.onclick = () => {
        const c = +th.dataset.c;
        DB.sort = DB.sort[0] === c ? [c, -DB.sort[1]] : [c, c >= 6 || c === 0 ? -1 : 1];
        apply();
      });
    }

    ["fq", "fcir", "fcls", "fy1", "fy2"].forEach(id =>
      document.getElementById(id).addEventListener(id === "fq" ? "input" : "change", apply));
    document.getElementById("csv").onclick = () => {
      const lines = [COLS.join(",")].concat(filtered.map(r =>
        r.map(v => v == null ? "" : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v)).join(",")));
      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "corps-central-database.csv";
      a.click();
      URL.revokeObjectURL(a.href);
    };
    apply();
  }

  /* ---------------- CHAMPIONS ---------------- */
  async function viewChampions() {
    setNav("champions");
    const champs = await data("champions.json");
    const dciYears = Object.keys(champs.dci).sort((a, b) => b - a);
    const dcaYears = Object.keys(champs.dca).sort((a, b) => b - a);
    const allCls = new Set();
    dciYears.forEach(y => Object.keys(champs.dci[y]).forEach(c => allCls.add(c)));
    const clsList = sortClasses([...allCls]);
    app.innerHTML = h`
      <h1 class="page">Champions</h1>
      <p class="lede">Every DCI World Champion since 1972 across classes, and DCA champions back to the 1960s.</p>
      <div class="card"><h2>DCI World Champions</h2>
      <div class="recapscroll"><table class="t"><thead><tr><th>Year</th>${clsList.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${dciYears.map(y => `<tr><td class="num" style="text-align:left"><a href="#/season/dci/${y}">${y}</a></td>
        ${clsList.map(c => {
          const w = champs.dci[y][c];
          return `<td>${w ? `<b>${esc(w.corps)}</b> <span class="kicker">${w.score != null ? score3(w.score) : ""}</span>` : "<span style='color:var(--grid)'>·</span>"}</td>`;
        }).join("")}</tr>`).join("")}</tbody></table></div></div>
      <div class="card" style="margin-top:14px"><h2>DCA Champions <span class="sub">All-age circuit</span></h2>
      <div class="recapscroll"><table class="t"><thead><tr><th>Year</th><th>Champion</th><th class="num">Score</th></tr></thead>
      <tbody>${dcaYears.map(y => {
        const w = champs.dca[y]["Open Class"] || Object.values(champs.dca[y])[0];
        return w ? `<tr><td>${y}</td><td><b>${esc(w.corps)}</b></td><td class="num score">${w.score != null ? score3(w.score) : "—"}</td></tr>` : "";
      }).join("")}</tbody></table></div></div>`;
  }

  /* ---------------- NEWS / ABOUT ---------------- */
  async function viewNews() {
    setNav("news");
    const news = await data("news.json");
    const sources = [...new Set(news.map(n => n.source))];
    app.innerHTML = `<h1 class="page">News</h1>
      <div class="filters" id="srcTabs"><button class="tab on" data-s="">All sources</button>
      ${sources.map(s => `<button class="tab" data-s="${esc(s)}">${esc(s)}</button>`).join("")}</div>
      <div class="card" id="list"></div>`;
    function render(src) {
      document.getElementById("list").innerHTML = news
        .filter(n => !src || n.source === src).slice(0, 60)
        .map(n => h`<div class="newsitem"><span class="src">${esc(n.source)}${n.date ? " · " + esc(n.date) : ""}</span>
          <div><a href="${encodeURI(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a></div>
          ${n.summary ? `<div class="sum">${esc(n.summary)}</div>` : ""}</div>`).join("") || "<div class='empty'>No items.</div>";
    }
    document.querySelectorAll("#srcTabs .tab").forEach(b => b.onclick = () => {
      document.querySelectorAll("#srcTabs .tab").forEach(x => x.classList.toggle("on", x === b));
      render(b.dataset.s);
    });
    render("");
  }

  async function viewAbout() {
    setNav("about");
    const meta = await data("meta.json");
    app.innerHTML = h`
      <h1 class="page">About this dashboard</h1>
      <div class="card">
        <p>Corps Central is an unofficial, fan-built dashboard for Drum Corps International (DCI) and Drum Corps Associates (DCA) scores, history and news. It rebuilds itself automatically twice a day during the season via GitHub Actions — no human in the loop.</p>
        <p><b>Coverage.</b> Event-by-event results with caption recaps for recent DCI seasons (2013–present, via DCI.org / Competition Suite), event-level results 2001–2012 (drum-corps.net archives), DCI World Championship Finals back to 1972 with repertoires and archival caption recaps (The Sound Machine), DCA results (drum-corps.net & dcacorps.org) and DCA champions to the 1960s (Wikipedia).</p>
        <p><b>Accuracy.</b> Data is scraped from public sources and normalized automatically; typos and gaps in the sources carry through. Scores are official only as published by DCI/DCA. Found an issue? <a href="https://github.com/LukeBesel/DCI-Tracker/issues" rel="noopener">Open a ticket</a>.</p>
        <h3>Sources</h3>
        ${(meta.sources || []).map(s => `<div style="padding:4px 0">• <a href="${encodeURI(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></div>`).join("")}
        <p style="color:var(--muted);font-size:12.5px">Last data refresh: ${esc(meta.updated)}. All trademarks belong to their owners; this site is not affiliated with DCI or DCA.</p>
      </div>`;
  }

  /* ---------------- router ---------------- */
  const routes = [
    [/^#?\/?$/, viewToday],
    [/^#\/rankings$/, viewRankings],
    [/^#\/seasons$/, viewSeasons],
    [/^#\/season\/(dci|dca)\/(\d{4})$/, (m) => viewSeason(m[1], m[2])],
    [/^#\/event\/(dci|dca)\/(\d{4})\/(\d+)$/, (m) => viewEvent(m[1], m[2], m[3])],
    [/^#\/corps$/, viewCorpsList],
    [/^#\/corps\/([a-z0-9-]+)$/, (m) => viewCorps(m[1])],
    [/^#\/database$/, viewDatabase],
    [/^#\/champions$/, viewChampions],
    [/^#\/history$/, viewVault],
    [/^#\/news$/, viewNews],
    [/^#\/about$/, viewAbout],
  ];

  let firstBuildPending = false;
  async function route() {
    const hashv = location.hash || "#/";
    window.scrollTo(0, 0);
    for (const [re, fn] of routes) {
      const m = hashv.match(re);
      if (m) {
        try { await fn(m); } catch (e) {
          console.error(e);
          app.innerHTML = firstBuildPending
            ? `<div class="card" style="text-align:center;padding:48px 20px">
                 <div style="font-size:40px;margin-bottom:10px">🥁</div>
                 <h2 style="margin:0 0 8px">Warming up the corps…</h2>
                 <p style="color:var(--text-secondary);max-width:52ch;margin:0 auto">The very first data build is crawling 50+ years of DCI &amp; DCA scores right now.
                 It usually takes an hour or two, then this page fills in automatically — no refresh regimen needed, though refreshing won't hurt.</p>
               </div>`
            : `<div class="card"><div class="empty">Couldn't load this view (${CCViz.esc(e.message)}). Data may still be updating — try again shortly.</div></div>`;
        }
        return;
      }
    }
    app.innerHTML = "<div class='empty'>Page not found.</div>";
  }
  addEventListener("hashchange", route);

  data("meta.json").then(m => {
    document.getElementById("updated").textContent = "data: " + m.updated;
    route();
  }).catch(() => {
    firstBuildPending = true;
    document.getElementById("updated").textContent = "awaiting first data build";
    route();
  });
})();
