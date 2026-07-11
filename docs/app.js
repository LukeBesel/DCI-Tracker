/* DCI Tracker SPA — Rankings · Compare · Seasons · Corps · Database */
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

  const score3 = v => v == null ? "—" : (+v).toFixed(3);
  const h = (strings, ...vals) => strings.map((s, i) => s + (vals[i] == null ? "" : vals[i])).join("");

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return `${MONTHS[m - 1]} ${d}`;
  }
  function dayOfSeason(iso) { // days since May 31 of that year
    const [y, m, d] = iso.split("-").map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 4, 31)) / 86400000);
  }
  function dayLabel(day) { // inverse for a non-leap reference
    const dt = new Date(Date.UTC(2001, 4, 31 + Math.round(day)));
    return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
  }

  function deltaHtml(d) {
    if (d == null) return '<span class="delta flat">—</span>';
    if (Math.abs(d) < 0.001) return '<span class="delta flat">±0.0</span>';
    return `<span class="delta ${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(2)}</span>`;
  }
  function corpsLink(name) {
    const slug = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return `<a href="#/corps/${slug}">${esc(name)}</a>`;
  }
  function setNav(route) {
    document.querySelectorAll("#nav a").forEach(a =>
      a.classList.toggle("active", a.dataset.route === route));
  }
  const CLASS_ORDER = ["World Class", "Open Class", "All-Age", "International"];
  const sortClasses = names => names.sort((a, b) => {
    const ia = CLASS_ORDER.indexOf(a), ib = CLASS_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });

  /* ============ RANKINGS (home) ============ */
  async function viewRankings() {
    setNav("rankings");
    const rk = await data("rankings.json");
    const classes = sortClasses(Object.keys(rk.standings || {}));
    if (!classes.length) {
      app.innerHTML = `<div class="card"><div class="empty">No scores yet for ${rk.season} — check back after the first show.</div></div>`;
      return;
    }
    const saved = localStorage.getItem("dt-class");
    const cls = classes.includes(saved) ? saved : classes[0];
    app.innerHTML = h`
      <h1 class="page">${esc(String(rk.season))} Rankings</h1>
      <p class="lede">Where every corps stands <b>right now</b>: each corps' most recent official score, how it moved since their last show, and the season trend. Updated nightly from DCI.org (last: ${esc(rk.generated)}).</p>
      <div class="filters" id="classTabs"></div>
      <div class="grid cols-2">
        <div class="card">
          <h2 id="standTitle"></h2>
          <div id="standings"></div>
        </div>
        <div style="display:grid;gap:14px;align-content:start">
          <div class="card" id="moveCard"></div>
          <div class="card" id="battleCard"></div>
          <div class="card" id="recentCard"></div>
        </div>
      </div>
      <div class="card" style="margin-top:14px">
        <h2>Season progression <span class="sub">score by date, top 8 — <a href="#/compare">compare years →</a></span></h2>
        <div class="chartwrap" id="trendChart"></div>
      </div>`;

    const tabs = document.getElementById("classTabs");
    classes.forEach(c => {
      const b = document.createElement("button");
      b.className = "tab" + (c === cls ? " on" : "");
      b.textContent = `${c} (${rk.standings[c].rows.length})`;
      b.onclick = () => { localStorage.setItem("dt-class", c); viewRankings(); };
      tabs.appendChild(b);
    });

    const block = rk.standings[cls];
    document.getElementById("standTitle").innerHTML =
      `${esc(cls)} standings <span class="sub">each corps' most recent score</span>`;
    document.getElementById("standings").innerHTML = `
      <table class="t standings"><thead><tr><th>#</th><th>Corps · last event</th><th class="num">Score</th><th class="num">Season high</th><th class="num">vs prev</th><th class="col-trend">Trend</th></tr></thead><tbody>
      ${block.rows.map(r => h`<tr>
        <td class="rank">${r.rank}</td>
        <td>${corpsLink(r.corps)}<div style="font-size:11.5px;color:var(--muted)">${esc(r.event)} · ${esc(fmtDate(r.date))}</div></td>
        <td class="num score">${score3(r.score)}</td>
        <td class="num">${score3(r.high)}</td>
        <td class="num">${deltaHtml(r.delta)}</td>
        <td class="col-trend"><span class="sparkcell" data-trend="${r.trend.map(t => t[1]).join(",")}"></span></td>
      </tr>`).join("")}</tbody></table>`;
    document.querySelectorAll(".sparkcell").forEach(elm => {
      sparkline(elm, elm.dataset.trend.split(",").map(Number).filter(n => !isNaN(n)), "#898781");
    });

    const jump = block.movers && block.movers[0];
    document.getElementById("moveCard").innerHTML = jump ? h`
      <h2>Biggest move <span class="sub">latest show vs previous</span></h2>
      <div style="font-size:20px;font-weight:650">${corpsLink(jump.corps)}</div>
      <div style="color:var(--text-secondary)">${score3(jump.prev_score)} → <b>${score3(jump.score)}</b> ${deltaHtml(jump.delta)}</div>
      ${block.movers.slice(1).map(m => `<div style="font-size:13px;margin-top:6px">${corpsLink(m.corps)} ${deltaHtml(m.delta)}</div>`).join("")}`
      : "<h2>Biggest move</h2><div class='empty'>Needs two shows.</div>";

    const b = block.battles && block.battles[0];
    document.getElementById("battleCard").innerHTML = b ? h`
      <h2>Closest battle <span class="sub">smallest gap in standings</span></h2>
      <table class="t">
        <tr><td class="rank">${b.ra}</td><td>${corpsLink(b.a)}</td><td class="num score">${score3(b.sa)}</td></tr>
        <tr><td class="rank">${b.rb}</td><td>${corpsLink(b.b)}</td><td class="num score">${score3(b.sb)}</td></tr>
      </table>
      <div style="margin-top:8px;font-size:13px;color:var(--text-secondary)">Gap: <b style="color:var(--bad)">${b.gap.toFixed(3)}</b></div>`
      : "<h2>Closest battle</h2><div class='empty'>—</div>";

    document.getElementById("recentCard").innerHTML = `<h2>Recent events</h2>` +
      ((rk.recent_events || []).slice(0, 6).map(ev => h`
        <div style="padding:7px 0;border-bottom:1px solid var(--grid);font-size:13px">
          <div><b>${esc(ev.name)}</b> <span class="kicker">${esc(fmtDate(ev.date))}</span></div>
          <div style="color:var(--text-secondary)">${ev.winner ? `🏆 ${esc(ev.winner.corps)} · ${score3(ev.winner.score)}` : ""}</div>
        </div>`).join("") || "<div class='empty'>—</div>") +
      `<div style="margin-top:8px"><a href="#/season/${rk.season}">All ${rk.season} events →</a></div>`;

    const top = block.rows.slice(0, 8);
    lineChart(document.getElementById("trendChart"), {
      linearX: true,
      series: top.map(r => ({ name: r.corps, points: r.trend.map(t => ({ x: dayOfSeason(t[0]), y: t[1] })) })),
      height: 330, xFmt: dayLabel, yFmt: v => v.toFixed(1),
    });
  }

  /* ============ COMPARE ============ */
  async function viewCompare() {
    setNav("compare");
    const [meta, rk, corpsIdx] = await Promise.all([data("meta.json"), data("rankings.json"), data("corps_index.json")]);
    const allYears = meta.seasons.map(s => s.year).sort((a, b) => b - a);
    const leader = (rk.standings["World Class"] || Object.values(rk.standings)[0] || { rows: [] }).rows[0];
    const state = {
      corps: sessionStorage.getItem("cmp-corps") || (leader ? leader.corps : (corpsIdx[0] || {}).name),
      years: JSON.parse(sessionStorage.getItem("cmp-years") || "null") || allYears.slice(0, 2),
    };

    app.innerHTML = `
      <h1 class="page">Compare seasons</h1>
      <p class="lede">Race one corps against its own past seasons. Pick a corps and up to four years — the lines align by calendar date, so you can see whether this year is ahead of or behind any other year at the same point in the summer.</p>
      <div class="filters">
        <select class="ctrl" id="corpsSel"></select>
        <span id="yearChips" style="display:flex;gap:6px;flex-wrap:wrap"></span>
      </div>
      <div class="card"><h2 id="cmpTitle"></h2><div class="chartwrap" id="cmpChart"><div class="loading">Loading…</div></div></div>
      <div class="card" style="margin-top:14px"><h2>Season summary</h2><div id="cmpTable"></div></div>`;

    const sel = document.getElementById("corpsSel");
    corpsIdx.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(c => sel.add(new Option(c.name, c.name)));
    if (![...sel.options].some(o => o.value === state.corps)) state.corps = sel.options[0]?.value;
    sel.value = state.corps;
    sel.onchange = () => { state.corps = sel.value; sessionStorage.setItem("cmp-corps", state.corps); draw(); };

    const chips = document.getElementById("yearChips");
    function renderChips() {
      chips.innerHTML = "";
      allYears.forEach(y => {
        const b = document.createElement("button");
        b.className = "tab" + (state.years.includes(y) ? " on" : "");
        b.textContent = y;
        b.onclick = () => {
          state.years = state.years.includes(y)
            ? state.years.filter(x => x !== y)
            : [...state.years, y].sort((a, b2) => b2 - a).slice(0, 4);
          if (!state.years.length) state.years = [y];
          sessionStorage.setItem("cmp-years", JSON.stringify(state.years));
          renderChips(); draw();
        };
        chips.appendChild(b);
      });
    }
    renderChips();

    async function draw() {
      document.getElementById("cmpTitle").innerHTML =
        `${esc(state.corps)} — ${state.years.slice().sort().join(" vs ")}`;
      const seasons = await Promise.all(state.years.map(y => data(`seasons/${y}.json`).catch(() => null)));
      const series = [];
      const summary = [];
      state.years.slice().sort().forEach((y, yi) => {
        const evs = seasons[state.years.indexOf(y)];
        if (!evs) return;
        const pts = [];
        for (const ev of evs) {
          if (!ev.date) continue;
          for (const c of ev.classes || []) {
            for (const r of c.results || []) {
              if (r.corps === state.corps && r.score) {
                pts.push({ x: dayOfSeason(ev.date), y: r.score, ev: ev.name });
              }
            }
          }
        }
        pts.sort((a, b) => a.x - b.x);
        if (pts.length) {
          series.push({ name: String(y), points: pts });
          const scores = pts.map(p => p.y);
          summary.push({
            year: y, shows: pts.length,
            first: scores[0], latest: scores[scores.length - 1],
            high: Math.max(...scores),
            gain: (scores[scores.length - 1] - scores[0]).toFixed(2),
          });
        }
      });
      if (!series.length) {
        document.getElementById("cmpChart").innerHTML = "<div class='empty'>No scored shows for this corps in the selected years.</div>";
        document.getElementById("cmpTable").innerHTML = "";
        return;
      }
      lineChart(document.getElementById("cmpChart"), {
        linearX: true, series, height: 340, xFmt: dayLabel, yFmt: v => v.toFixed(1),
      });
      document.getElementById("cmpTable").innerHTML = `
        <table class="t"><thead><tr><th>Season</th><th class="num">Shows</th><th class="num">First</th><th class="num">Latest / Final</th><th class="num">High</th><th class="num">Gain</th></tr></thead><tbody>
        ${summary.map(s => `<tr><td>${s.year}</td><td class="num">${s.shows}</td><td class="num">${score3(s.first)}</td><td class="num score">${score3(s.latest)}</td><td class="num">${score3(s.high)}</td><td class="num">${s.gain > 0 ? "+" : ""}${s.gain}</td></tr>`).join("")}
        </tbody></table>`;
    }
    draw();
  }

  /* ============ SEASONS ============ */
  async function viewSeasons() {
    setNav("seasons");
    const [meta, champs] = await Promise.all([data("meta.json"), data("champions.json").catch(() => ({}))]);
    const years = meta.seasons.slice().sort((a, b) => b.year - a.year);
    app.innerHTML = h`
      <h1 class="page">Seasons</h1>
      <p class="lede">The archive, organized by year. Tap a season to see every event in order with full results — championship events include judge-by-judge caption recaps. The champions table below is the quick reference.</p>
      <div class="card"><div class="years">
        ${years.map(s => {
          const c = champs[String(s.year)] && (champs[String(s.year)]["World Class"] || {}).corps;
          return `<a class="year" href="#/season/${s.year}">${s.year}<small>${s.events} events${c ? " · 🏆 " + esc(c) : ""}</small></a>`;
        }).join("")}
      </div></div>
      <div class="card" style="margin-top:14px"><h2>Champions <span class="sub">World Championship Finals winners in the archive</span></h2>
      <div class="recapscroll"><table class="t" id="champT"></table></div></div>`;
    const clsSet = new Set();
    Object.values(champs).forEach(byCls => Object.keys(byCls).forEach(c => clsSet.add(c)));
    const clsList = sortClasses([...clsSet]);
    document.getElementById("champT").innerHTML = `
      <thead><tr><th>Year</th>${clsList.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>
      ${Object.keys(champs).sort((a, b) => b - a).map(y => `<tr>
        <td><a href="#/season/${y}">${y}</a></td>
        ${clsList.map(c => {
          const w = champs[y][c];
          return `<td>${w ? `<b>${esc(w.corps)}</b> <span class="kicker">${score3(w.score)}</span>` : "<span style='color:var(--grid)'>·</span>"}</td>`;
        }).join("")}</tr>`).join("")}</tbody>`;
  }

  async function viewSeason(year) {
    setNav("seasons");
    let events;
    try { events = await data(`seasons/${year}.json`); }
    catch (e) { app.innerHTML = "<div class='card'><div class='empty'>No data for this season yet.</div></div>"; return; }
    app.innerHTML = h`
      <div class="crumbs"><a href="#/seasons">Seasons</a> / ${year}</div>
      <h1 class="page">${year} season <span class="kicker">· ${events.length} events</span></h1>
      <div class="card"><table class="t"><thead><tr><th>Date</th><th>Event</th><th>Top score</th><th></th></tr></thead><tbody>
      ${events.map((ev, i) => {
        let winner = null;
        for (const c of ev.classes || []) {
          const r0 = (c.results || []).find(r => r.score);
          if (r0 && (!winner || (r0.score || 0) > (winner.score || 0))) winner = r0;
        }
        return h`<tr class="rowlink" onclick="location.hash='#/event/${year}/${i}'">
          <td style="color:var(--muted);white-space:nowrap">${esc(fmtDate(ev.date) || ev.date_display || "")}</td>
          <td><b>${esc(ev.name)}</b><div style="font-size:12px;color:var(--muted)">${esc(ev.location || "")}</div></td>
          <td>${winner ? `${esc(winner.corps)} <span class="kicker">${score3(winner.score)}</span>` : ""}</td>
          <td>${(ev.recap && ev.recap.length) ? '<span class="pill">caption recap</span>' : ""}</td></tr>`;
      }).join("")}</tbody></table></div>`;
  }

  async function viewEvent(year, idx) {
    setNav("seasons");
    const events = await data(`seasons/${year}.json`);
    const ev = events[+idx];
    if (!ev) { app.innerHTML = "<div class='empty'>Event not found.</div>"; return; }
    app.innerHTML = h`
      <div class="crumbs"><a href="#/seasons">Seasons</a> / <a href="#/season/${year}">${year}</a> / ${esc(ev.name)}</div>
      <h1 class="page">${esc(ev.name)}</h1>
      <p class="lede">${esc(ev.date_display || "")}${ev.location ? " · " + esc(ev.location) : ""} · <a href="${encodeURI(ev.url || "#")}" target="_blank" rel="noopener">DCI.org ↗</a></p>
      ${(ev.classes || []).map(c => h`
        <div class="card" style="margin-bottom:14px"><h2>${esc(c.class)}</h2>
        <table class="t"><thead><tr><th>#</th><th>Corps</th><th class="num">Score</th></tr></thead><tbody>
        ${c.results.map(r => `<tr><td class="rank">${r.place ?? "—"}</td><td>${corpsLink(r.corps)}</td><td class="num score">${score3(r.score)}</td></tr>`).join("")}
        </tbody></table></div>`).join("")}
      ${(ev.recap || []).map(rc => h`
        <div class="card" style="margin-bottom:14px"><h2>Caption recap — ${esc(rc.class)}</h2>
        <div class="recapscroll"><table class="t">
          ${(rc.captions || []).length ? `<thead><tr>${rc.captions.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>` : ""}
          <tbody>${rc.rows.map(r => `<tr>${r.cells.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table></div>
        ${ev.recap_url ? `<div style="margin-top:8px;font-size:12.5px"><a href="${encodeURI(ev.recap_url)}" target="_blank" rel="noopener">Official recap ↗</a></div>` : ""}
        </div>`).join("")}`;
  }

  /* ============ CORPS ============ */
  async function viewCorpsList() {
    setNav("corps");
    const idx = await data("corps_index.json");
    app.innerHTML = `
      <h1 class="page">Corps</h1>
      <p class="lede">One page per corps: its complete scoring history, year-by-year chart, titles, and every performance on record. Covers everyone with a DCI.org-published score since 2013 — World Class, Open Class, and All-Age alike.</p>
      <div class="filters">
        <input class="ctrl" id="q" placeholder="Search corps…">
        <button class="tab on" data-f="all">All</button>
        <button class="tab" data-f="active">Active (last 2 yrs)</button>
      </div>
      <div class="card"><table class="t"><thead>
        <tr><th>Corps</th><th class="num">Seasons</th><th>Years</th><th class="num">Best score</th><th class="num">Performances</th></tr>
      </thead><tbody id="rows"></tbody></table></div>`;
    const rowsEl = document.getElementById("rows");
    const nowYear = new Date().getFullYear();
    let filter = "all";
    function render() {
      const q = document.getElementById("q").value.toLowerCase();
      const list = idx.filter(c =>
        (!q || c.name.toLowerCase().includes(q)) &&
        (filter !== "active" || c.last >= nowYear - 1))
        .sort((a, b) => b.last - a.last || (b.best || 0) - (a.best || 0));
      rowsEl.innerHTML = list.map(c => h`
        <tr class="rowlink" onclick="location.hash='#/corps/${c.slug}'">
          <td><b>${esc(c.name)}</b></td><td class="num">${c.seasons}</td>
          <td style="color:var(--muted)">${c.first === c.last ? c.first : c.first + "–" + c.last}</td>
          <td class="num score">${score3(c.best)}</td><td class="num">${c.n}</td></tr>`).join("")
        || "<tr><td colspan='5' class='empty'>No matches.</td></tr>";
    }
    document.getElementById("q").addEventListener("input", render);
    document.querySelectorAll(".tab[data-f]").forEach(bt => bt.onclick = () => {
      filter = bt.dataset.f;
      document.querySelectorAll(".tab[data-f]").forEach(x => x.classList.toggle("on", x === bt));
      render();
    });
    render();
  }

  async function viewCorps(slug) {
    setNav("corps");
    let detail;
    try { detail = await data(`corps/${slug}.json`); }
    catch (e) { app.innerHTML = "<div class='card'><div class='empty'>Corps not found.</div></div>"; return; }
    const champs = await data("champions.json").catch(() => ({}));
    const perfs = detail.performances;
    const titles = [];
    for (const [yr, byCls] of Object.entries(champs))
      for (const [cls, w] of Object.entries(byCls))
        if (w.corps === detail.name) titles.push(`${yr} ${cls}`);
    const byYear = new Map();
    perfs.forEach(p => { (byYear.get(p.y) || byYear.set(p.y, []).get(p.y)).push(p); });
    const years = [...byYear.keys()].sort();
    const bestByYear = years.map(y => Math.max(0, ...byYear.get(y).map(p => p.s || 0)) || null);
    const scored = perfs.filter(p => p.s);

    app.innerHTML = h`
      <div class="crumbs"><a href="#/corps">Corps</a> / ${esc(detail.name)}</div>
      <h1 class="page">${esc(detail.name)}</h1>
      <div class="grid cols-tiles" style="margin-bottom:14px">
        <div class="tile"><div class="label">Performances</div><div class="value">${perfs.length}</div><div class="sub">${years[0]}–${years[years.length - 1]}</div></div>
        <div class="tile"><div class="label">Best score</div><div class="value">${scored.length ? score3(Math.max(...scored.map(p => p.s))) : "—"}</div></div>
        <div class="tile"><div class="label">Titles</div><div class="value">${titles.length}</div><div class="sub">${esc(titles.slice(-3).join(" · ") || "—")}</div></div>
      </div>
      <div class="card"><h2>Season-best score by year <span class="sub"><a href="#/compare">compare specific seasons →</a></span></h2><div class="chartwrap" id="corpsChart"></div></div>
      <div class="card" style="margin-top:14px"><h2>Performance log</h2>
        <div class="filters"><select class="ctrl" id="yearSel"><option value="">All years</option>
          ${years.slice().reverse().map(y => `<option>${y}</option>`).join("")}</select></div>
        <div id="perfTable"></div></div>`;

    lineChart(document.getElementById("corpsChart"), {
      linearX: true,
      series: [{ name: "Season best", points: years.map((y, i) => ({ x: y, y: bestByYear[i] })).filter(p => p.y) }],
      height: 260, yFmt: v => v.toFixed(0), xFmt: v => String(Math.round(v)),
    });

    function renderPerfs() {
      const yv = document.getElementById("yearSel").value;
      const list = perfs.filter(p => !yv || p.y === +yv)
        .sort((a, b) => (b.d || "").localeCompare(a.d || "") || b.y - a.y);
      document.getElementById("perfTable").innerHTML = `<table class="t">
        <thead><tr><th>Date</th><th>Event</th><th>Class</th><th class="num">Place</th><th class="num">Score</th></tr></thead>
        <tbody>${list.slice(0, 400).map(p => h`<tr>
          <td style="color:var(--muted);white-space:nowrap">${esc(fmtDate(p.d) || p.y)}</td>
          <td>${esc(p.ev || "")}</td>
          <td><span class="pill">${esc(p.cls || "")}</span></td>
          <td class="num">${p.p ?? "—"}</td><td class="num score">${score3(p.s)}</td></tr>`).join("")}</tbody></table>`;
    }
    document.getElementById("yearSel").addEventListener("change", renderPerfs);
    renderPerfs();
  }

  /* ============ DATABASE ============ */
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
    app.innerHTML = `<h1 class="page">Database</h1>
      <p class="lede">The raw data, all of it: every scored performance as one big table. Sort by any column, stack filters, search anything, and export the result to CSV for your own spreadsheets. <span id="dbcount" class="kicker"></span></p>
      <div class="filters">
        <input class="ctrl" id="fq" placeholder="Search corps or event…">
        <select class="ctrl" id="fcls"><option value="">All classes</option></select>
        <select class="ctrl" id="fy1"></select>
        <select class="ctrl" id="fy2"></select>
        <button class="tab" id="csv">Export CSV</button>
      </div>
      <div class="card"><div id="dbtable"><div class="loading">Loading…</div></div></div>`;
    let rows;
    try { rows = await loadDb(); }
    catch (e) { document.getElementById("dbtable").innerHTML = "<div class='empty'>Database builds with the next data run.</div>"; return; }

    const years = [...new Set(rows.map(r => r[0]))].sort();
    const classes = [...new Set(rows.map(r => r[4]).filter(Boolean))].sort();
    const fy1 = document.getElementById("fy1"), fy2 = document.getElementById("fy2");
    years.forEach(y => { fy1.add(new Option(y, y)); fy2.add(new Option(y, y)); });
    fy1.value = years[0]; fy2.value = years[years.length - 1];
    const fcls = document.getElementById("fcls");
    classes.forEach(c => fcls.add(new Option(c, c)));

    const COLS = ["Year", "Date", "Event", "Corps", "Class", "Place", "Score"];
    let filtered = rows;

    function apply() {
      const q = document.getElementById("fq").value.toLowerCase();
      const cls = fcls.value;
      const y1 = +fy1.value, y2 = +fy2.value;
      filtered = rows.filter(r =>
        r[0] >= y1 && r[0] <= y2 && (!cls || r[4] === cls) &&
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
      document.getElementById("dbcount").textContent =
        `· ${filtered.length.toLocaleString()} rows${filtered.length > LIMIT ? ` (showing ${LIMIT} — narrow filters or export CSV)` : ""}`;
      const [ci, dir] = DB.sort;
      document.getElementById("dbtable").innerHTML =
        `<div class="recapscroll"><table class="t"><thead><tr>${COLS.map((c, i) =>
          `<th style="cursor:pointer;user-select:none" data-c="${i}">${c}${i === ci ? (dir > 0 ? " ↑" : " ↓") : ""}</th>`).join("")}</tr></thead><tbody>
        ${filtered.slice(0, LIMIT).map(r => h`<tr>
          <td class="num" style="text-align:left">${r[0]}</td>
          <td style="color:var(--muted);white-space:nowrap">${esc(fmtDate(r[1]))}</td>
          <td>${esc(r[2] || "")}</td>
          <td>${corpsLink(r[3])}</td>
          <td><span class="pill">${esc(r[4] || "")}</span></td>
          <td class="num">${r[5] ?? "—"}</td>
          <td class="num score">${score3(r[6])}</td></tr>`).join("")}</tbody></table></div>`;
      document.querySelectorAll("#dbtable th").forEach(th => th.onclick = () => {
        const c = +th.dataset.c;
        DB.sort = DB.sort[0] === c ? [c, -DB.sort[1]] : [c, c >= 5 || c === 0 ? -1 : 1];
        apply();
      });
    }

    ["fq", "fcls", "fy1", "fy2"].forEach(id =>
      document.getElementById(id).addEventListener(id === "fq" ? "input" : "change", apply));
    document.getElementById("csv").onclick = () => {
      const lines = [COLS.join(",")].concat(filtered.map(r =>
        r.map(v => v == null ? "" : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v)).join(",")));
      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "dci-tracker-database.csv";
      a.click();
      URL.revokeObjectURL(a.href);
    };
    apply();
  }

  /* ============ router ============ */
  const routes = [
    [/^#?\/?$/, viewRankings],
    [/^#\/compare$/, viewCompare],
    [/^#\/seasons$/, viewSeasons],
    [/^#\/season\/(\d{4})$/, m => viewSeason(m[1])],
    [/^#\/event\/(\d{4})\/(\d+)$/, m => viewEvent(m[1], m[2])],
    [/^#\/corps$/, viewCorpsList],
    [/^#\/corps\/([a-z0-9-]+)$/, m => viewCorps(m[1])],
    [/^#\/database$/, viewDatabase],
    // legacy routes from the first version
    [/^#\/(today|rankings)$/, viewRankings],
    [/^#\/season\/dci\/(\d{4})$/, m => viewSeason(m[1])],
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
                 <h2 style="margin:0 0 8px">First data build in progress</h2>
                 <p style="color:var(--text-secondary);max-width:52ch;margin:0 auto">Scores are being pulled from DCI.org right now. This page fills in automatically when it finishes.</p>
               </div>`
            : `<div class="card"><div class="empty">Couldn't load this view (${CCViz.esc(e.message)}). Data may be mid-update — try again in a minute.</div></div>`;
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
