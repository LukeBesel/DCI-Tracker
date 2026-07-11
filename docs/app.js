/* DCI Tracker SPA — Rankings · Corps (compare) · Seasons · Database */
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
  const slugOf = name => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  function corpsLink(name) {
    return `<a href="#/corps/${slugOf(name)}">${esc(name)}</a>`;
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

  /* ============ multiselect dropdown ============ */
  // Document-level listeners: outside click / Escape close any open panel.
  function closeMsels() {
    document.querySelectorAll(".msel.open").forEach(ms => {
      ms.classList.remove("open");
      const b = ms.querySelector(".msel-btn");
      if (b) b.setAttribute("aria-expanded", "false");
    });
  }
  document.addEventListener("click", e => {
    document.querySelectorAll(".msel.open").forEach(ms => {
      if (!ms.contains(e.target)) {
        ms.classList.remove("open");
        const b = ms.querySelector(".msel-btn");
        if (b) b.setAttribute("aria-expanded", "false");
      }
    });
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeMsels(); });

  function multiSelect(mount, cfg) {
    // cfg: {label, options:[{value,label,hint?}], selected:Set<string>, onChange, searchable?}
    mount.classList.add("msel");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ctrl msel-btn";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    const panel = document.createElement("div");
    panel.className = "msel-panel";
    panel.setAttribute("role", "listbox");
    let q = "";

    function summary() {
      const n = cfg.selected.size;
      if (!n) return cfg.label;
      const lbls = [...cfg.selected].map(v =>
        (cfg.options.find(o => String(o.value) === String(v)) || { label: v }).label);
      return n <= 2 ? lbls.join(", ") : `${lbls[0]}, ${lbls[1]} +${n - 2}`;
    }
    function renderBtn() {
      btn.innerHTML = `<span class="msel-sum">${esc(summary())}</span><span class="msel-caret">▾</span>`;
    }
    function renderPanel() {
      panel.innerHTML = "";
      if (cfg.bulk) {
        const bar = document.createElement("div");
        bar.className = "msel-bulk";
        const mk = (txt, fn) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "msel-bulk-btn";
          b.textContent = txt;
          b.onclick = e => {
            e.stopPropagation();
            fn();
            renderBtn();
            renderPanel();
            cfg.onChange([...cfg.selected]);
          };
          return b;
        };
        bar.appendChild(mk("Select all", () => cfg.options.forEach(o => cfg.selected.add(String(o.value)))));
        bar.appendChild(mk("None", () => cfg.selected.clear()));
        panel.appendChild(bar);
      }
      if (cfg.searchable) {
        const inp = document.createElement("input");
        inp.className = "ctrl msel-search";
        inp.placeholder = "Search…";
        inp.value = q;
        inp.oninput = () => { q = inp.value.toLowerCase(); renderList(); };
        inp.onclick = e => e.stopPropagation();
        panel.appendChild(inp);
        // don't auto-focus on touch devices — focusing pops the keyboard
        if (!matchMedia("(pointer: coarse)").matches) setTimeout(() => inp.focus(), 0);
      }
      const list = document.createElement("div");
      list.className = "msel-list";
      panel.appendChild(list);

      function renderList() {
        list.innerHTML = "";
        const opts = cfg.options.filter(o => !q || o.label.toLowerCase().includes(q));
        if (!opts.length) list.innerHTML = "<div class='empty' style='padding:10px'>No matches</div>";
        opts.forEach(o => {
          const row = document.createElement("label");
          row.className = "msel-opt";
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = cfg.selected.has(String(o.value));
          cb.onchange = () => {
            const k = String(o.value);
            cb.checked ? cfg.selected.add(k) : cfg.selected.delete(k);
            renderBtn();
            cfg.onChange([...cfg.selected]);
          };
          row.appendChild(cb);
          const sp = document.createElement("span");
          sp.textContent = o.label;
          row.appendChild(sp);
          if (o.hint) {
            const ht = document.createElement("span");
            ht.className = "hint";
            ht.textContent = o.hint;
            row.appendChild(ht);
          }
          row.onclick = e => e.stopPropagation();
          list.appendChild(row);
        });
      }
      renderList();
    }
    btn.onclick = e => {
      e.stopPropagation();
      const open = mount.classList.contains("open");
      closeMsels();
      if (!open) {
        mount.classList.add("open");
        btn.setAttribute("aria-expanded", "true");
        q = "";
        renderPanel();
      }
    };
    renderBtn();
    mount.append(btn, panel);
    return { refresh: renderBtn };
  }

  /* ============ RANKINGS (home) ============ */
  async function viewRankings(_m, stale) {
    setNav("rankings");
    const rk = await data("rankings.json");
    if (stale()) return;
    const classes = sortClasses(Object.keys(rk.standings || {}));
    if (!classes.length) {
      app.innerHTML = `<div class="card"><div class="empty">No scores yet for ${rk.season} — check back after the first show.</div></div>`;
      return;
    }
    const saved = localStorage.getItem("dt-class");
    const cls = classes.includes(saved) ? saved : classes[0];
    app.innerHTML = h`
      <h1 class="page">${esc(String(rk.season))} Rankings</h1>
      <div class="filters" id="classTabs"></div>
      <div class="grid cols-2">
        <div class="card">
          <h2 id="standTitle"></h2>
          <div id="standings"></div>
        </div>
        <div style="display:grid;gap:14px;align-content:start">
          <div class="card" id="upcomingCard"></div>
          <div class="card" id="moveCard"></div>
          <div class="card" id="battleCard"></div>
        </div>
      </div>
      <div class="card" style="margin-top:14px">
        <h2 id="trendTitle">Season progression <span class="sub">score by date, top 8 — <a href="#/corps">full compare →</a></span></h2>
        <div class="chartwrap" id="trendChart"></div>
      </div>
      <p class="pagenote">Each corps' most recent official score, movement since their last show, and the season race. Updated nightly from DCI.org (last: ${esc(rk.generated)}).</p>`;

    const tabs = document.getElementById("classTabs");
    classes.forEach(c => {
      const b = document.createElement("button");
      b.className = "tab" + (c === cls ? " on" : "");
      b.textContent = `${c} (${rk.standings[c].rows.length})`;
      b.onclick = () => { localStorage.setItem("dt-class", c); viewRankings(null, stale); };
      tabs.appendChild(b);
    });

    const block = rk.standings[cls];
    const top = block.rows.slice(0, 8);
    lineChart(document.getElementById("trendChart"), {
      linearX: true,
      series: top.map(r => ({ name: r.corps, points: r.trend.map(t => ({ x: dayOfSeason(t[0]), y: t[1] })) })),
      height: 340, xFmt: dayLabel, yFmt: v => v.toFixed(1),
    });

    document.getElementById("standTitle").innerHTML =
      `${esc(cls)} standings <span class="sub">each corps' most recent score</span>`;
    document.getElementById("standings").innerHTML = `
      <table class="t standings"><thead><tr><th>#</th><th>Corps · last event</th><th class="num">Score</th><th class="num col-high">Season high</th><th class="num">vs prev</th><th class="col-trend">Trend</th></tr></thead><tbody>
      ${block.rows.map(r => h`<tr>
        <td class="rank">${r.rank}</td>
        <td>${corpsLink(r.corps)}<div style="font-size:11.5px;color:var(--muted)">${esc(r.event)} · ${esc(fmtDate(r.date))}</div></td>
        <td class="num score">${score3(r.score)}</td>
        <td class="num col-high">${score3(r.high)}</td>
        <td class="num">${deltaHtml(r.delta)}</td>
        <td class="col-trend"><span class="sparkcell" data-trend="${r.trend.map(t => t[1]).join(",")}"></span></td>
      </tr>`).join("")}</tbody></table>`;
    document.querySelectorAll(".sparkcell").forEach(elm => {
      sparkline(elm, elm.dataset.trend.split(",").map(Number).filter(n => !isNaN(n)), "#898781");
    });

    // Upcoming events with lineups
    const up = await data("upcoming.json").catch(() => []);
    const upEl = document.getElementById("upcomingCard");
    if (stale() || !upEl) return; // user navigated away while loading
    if (up.length) {
      upEl.innerHTML = `<h2>Upcoming events <span class="sub">who's performing next</span></h2>` +
        up.slice(0, 6).map(ev => {
          const lineup = ev.lineup || [];
          const names = lineup.slice(0, 7).map(c => corpsLink(c)).join(", ");
          const more = lineup.length > 7 ? ` <span class="kicker">+${lineup.length - 7} more</span>` : "";
          return h`<div class="upitem">
            <div><b>${esc(ev.name)}</b> <span class="kicker">${esc(fmtDate(ev.date))}</span></div>
            <div style="color:var(--muted);font-size:12px">${esc(ev.location || "")}</div>
            ${lineup.length ? `<div class="lineup">${names}${more}</div>` : ""}
          </div>`;
        }).join("") +
        `<div style="margin-top:8px"><a href="#/season/${rk.season}">All ${rk.season} results →</a></div>`;
    } else {
      upEl.innerHTML = `<h2>Upcoming events</h2>
        <div class="empty" style="padding:12px 0">Schedule updates with the nightly data run.</div>
        <div><a href="#/season/${rk.season}">All ${rk.season} results →</a></div>`;
    }

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
  }

  /* ============ CORPS HUB (directory + compare) ============ */
  const YEAR_DASHES = ["", "6 4", "2 4", "9 3 2 3"]; // newest → oldest

  function parseHashQuery(qs) {
    const out = {};
    (qs || "").split("&").forEach(kv => {
      const [k, v] = kv.split("=");
      if (k && v != null) {
        try { out[k] = decodeURIComponent(v); } catch (e) { out[k] = ""; }
      }
    });
    return out;
  }

  async function viewCorpsHub(qs, stale) {
    setNav("corps");
    const [meta, idx, rk] = await Promise.all([
      data("meta.json"), data("corps_index.json"), data("rankings.json").catch(() => null)]);
    if (stale()) return;
    const allYears = meta.seasons.map(s => s.year).sort((a, b) => b - a);
    const bySlug = new Map(idx.map(c => [c.slug, c]));

    // --- selection state: hash query > session > sensible default ---
    const params = parseHashQuery(qs);
    const explicit = params.c != null || params.y != null;
    let corpsSel, yearsSel;
    if (explicit) {
      corpsSel = (params.c || "").split(",").filter(s => bySlug.has(s));
      yearsSel = (params.y || "").split(",").map(Number).filter(y => allYears.includes(y));
    } else {
      try {
        corpsSel = JSON.parse(sessionStorage.getItem("cmp-corps") || "null") || [];
        yearsSel = JSON.parse(sessionStorage.getItem("cmp-years") || "null") || [];
      } catch (e) { corpsSel = []; yearsSel = []; }
      if (!Array.isArray(corpsSel)) corpsSel = [];
      if (!Array.isArray(yearsSel)) yearsSel = [];
      corpsSel = corpsSel.filter(s => bySlug.has(s));
      yearsSel = yearsSel.filter(y => allYears.includes(y));
    }
    // an explicitly empty selection (user cleared, or shared a cleared URL)
    // stays empty; only a fresh arrival gets the default matchup
    if (!explicit && !corpsSel.length && !yearsSel.length) {
      const rows = rk && rk.standings && (rk.standings["World Class"] || Object.values(rk.standings)[0] || {}).rows;
      corpsSel = (rows || []).slice(0, 2).map(r => slugOf(r.corps)).filter(s => bySlug.has(s));
      if (!corpsSel.length) corpsSel = idx.slice(0, 2).map(c => c.slug);
      yearsSel = allYears.slice(0, 2);
    }

    function persist() {
      if (stale()) return; // never rewrite the URL of a view we've left
      sessionStorage.setItem("cmp-corps", JSON.stringify(corpsSel));
      sessionStorage.setItem("cmp-years", JSON.stringify(yearsSel));
      const q = `c=${corpsSel.join(",")}&y=${yearsSel.slice().sort((a, b) => b - a).join(",")}`;
      history.replaceState(null, "", `#/corps?${q}`);
    }

    app.innerHTML = `
      <h1 class="page">Corps</h1>
      <div class="card">
        <h2>Compare <span class="sub">any corps, any seasons, one chart</span></h2>
        <div class="filters" style="margin-bottom:10px">
          <div id="corpsSel"></div>
          <div id="yearSel"></div>
          <button class="tab" id="clearSel" title="Reset selection">Clear</button>
        </div>
        <div id="cmpNotice"></div>
        <div class="chartwrap" id="cmpChart"><div class="loading">Loading…</div></div>
        <div id="cmpTable" style="margin-top:12px"></div>
      </div>
      <div class="card" style="margin-top:14px">
        <h2>All corps <span class="sub">tap a corps for its full history · ⊕ adds it to the chart</span></h2>
        <div class="filters">
          <input class="ctrl" id="q" placeholder="Search corps…">
          <button class="tab on" data-f="all">All</button>
          <button class="tab" data-f="active">Active (last 2 yrs)</button>
        </div>
        <div class="tscroll"><table class="t"><thead>
          <tr><th></th><th>Corps</th><th class="num">Seasons</th><th>Years</th><th class="num">Best score</th><th class="num col-perfs">Performances</th></tr>
        </thead><tbody id="rows"></tbody></table></div>
      </div>
      <p class="pagenote">Lines align by calendar date, so you can see who's ahead at the same point in any summer — or race a corps against its own past seasons.</p>`;

    // --- multiselects ---
    const corpsSet = new Set(corpsSel);
    const yearSet = new Set(yearsSel.map(String));
    const msCorps = multiSelect(document.getElementById("corpsSel"), {
      label: "Select corps…", searchable: true,
      options: idx.slice().sort((a, b) => b.last - a.last || a.name.localeCompare(b.name))
        .map(c => ({ value: c.slug, label: c.name, hint: c.first === c.last ? String(c.first) : `${c.first}–${c.last}` })),
      selected: corpsSet,
      onChange: v => { corpsSel = v; persist(); draw(); renderRows(); },
    });
    const msYears = multiSelect(document.getElementById("yearSel"), {
      label: "Select seasons…", searchable: allYears.length > 15, bulk: true,
      options: allYears.map(y => ({ value: String(y), label: String(y) })),
      selected: yearSet,
      onChange: v => { yearsSel = v.map(Number).sort((a, b) => b - a); persist(); draw(); },
    });
    document.getElementById("clearSel").onclick = () => {
      corpsSet.clear(); yearSet.clear();
      corpsSel = []; yearsSel = [];
      msCorps.refresh(); msYears.refresh();
      persist();
      draw();
      renderRows();
    };

    // --- chart ---
    const MAX_SERIES = 12;
    let drawGen = 0;
    async function draw() {
      const gen = ++drawGen;
      const chartEl = document.getElementById("cmpChart");
      const tableEl = document.getElementById("cmpTable");
      const noticeEl = document.getElementById("cmpNotice");
      if (!chartEl) return;
      noticeEl.innerHTML = "";
      if (!corpsSel.length || !yearsSel.length) {
        chartEl.innerHTML = "<div class='empty'>Pick at least one corps and one season.</div>";
        tableEl.innerHTML = "";
        return;
      }
      // snapshot BOTH selections before awaiting so a stale run can't mix
      // old years with new corps
      const corps = corpsSel.slice();
      const years = yearsSel.slice().sort((a, b) => b - a);
      const seasons = await Promise.all(years.map(y => data(`seasons/${y}.json`).catch(() => null)));
      if (gen !== drawGen || stale()) return; // selection changed or view left while loading
      const multiCorps = corps.length > 1, multiYears = years.length > 1;
      const series = [], summary = [];
      let combos = 0, truncated = false;
      for (let ci = 0; ci < corps.length; ci++) {
        const name = bySlug.get(corps[ci]).name;
        for (let yi = 0; yi < years.length; yi++) {
          if (combos >= MAX_SERIES) { truncated = true; break; }
          const evs = seasons[yi];
          if (!evs) continue;
          const pts = [];
          for (const ev of evs) {
            if (!ev.date) continue;
            for (const c of ev.classes || []) {
              for (const r of c.results || []) {
                if (r.corps === name && r.score) pts.push({ x: dayOfSeason(ev.date), y: r.score });
              }
            }
          }
          pts.sort((a, b) => a.x - b.x);
          if (!pts.length) continue;
          combos++;
          const label = multiYears || !multiCorps ? `${name} ’${String(years[yi]).slice(2)}` : name;
          series.push({
            name: label, points: pts,
            color: PALETTE[(multiCorps ? ci : yi) % PALETTE.length],
            dash: multiCorps && multiYears ? YEAR_DASHES[yi % YEAR_DASHES.length] : "",
          });
          const scores = pts.map(p => p.y);
          summary.push({
            corps: name, year: years[yi], shows: pts.length,
            first: scores[0], latest: scores[scores.length - 1],
            high: Math.max(...scores),
            gain: (scores[scores.length - 1] - scores[0]).toFixed(2),
          });
        }
        if (truncated) break;
      }
      if (truncated) {
        noticeEl.innerHTML = `<div class="notice" style="margin-bottom:10px">Showing the first ${MAX_SERIES} corps-season lines — trim the selection for a cleaner read.</div>`;
      }
      if (!series.length) {
        chartEl.innerHTML = "<div class='empty'>No scored shows for this selection — try other seasons.</div>";
        tableEl.innerHTML = "";
        return;
      }
      lineChart(chartEl, { linearX: true, series, height: 360, xFmt: dayLabel, yFmt: v => v.toFixed(1) });
      summary.sort((a, b) => b.year - a.year || (b.latest || 0) - (a.latest || 0));
      tableEl.innerHTML = `
        <div class="tscroll"><table class="t"><thead><tr><th>Corps</th><th class="num">Season</th><th class="num">Shows</th><th class="num">First</th><th class="num">Latest / Final</th><th class="num">High</th><th class="num">Gain</th></tr></thead><tbody>
        ${summary.map(s => h`<tr><td>${corpsLink(s.corps)}</td><td class="num">${s.year}</td><td class="num">${s.shows}</td><td class="num">${score3(s.first)}</td><td class="num score">${score3(s.latest)}</td><td class="num">${score3(s.high)}</td><td class="num">${s.gain > 0 ? "+" : ""}${s.gain}</td></tr>`).join("")}
        </tbody></table></div>`;
    }

    // --- directory ---
    const rowsEl = document.getElementById("rows");
    const nowYear = new Date().getFullYear();
    let filter = "all";
    function renderRows() {
      const q = (document.getElementById("q").value || "").toLowerCase();
      const list = idx.filter(c =>
        (!q || c.name.toLowerCase().includes(q)) &&
        (filter !== "active" || c.last >= nowYear - 1))
        .sort((a, b) => b.last - a.last || (b.best || 0) - (a.best || 0));
      rowsEl.innerHTML = list.map(c => h`
        <tr class="rowlink" data-slug="${c.slug}">
          <td class="addcell"><button class="addbtn${corpsSet.has(c.slug) ? " on" : ""}" data-add="${c.slug}" title="${corpsSet.has(c.slug) ? "Remove from" : "Add to"} compare">${corpsSet.has(c.slug) ? "✓" : "+"}</button></td>
          <td><b>${esc(c.name)}</b></td><td class="num">${c.seasons}</td>
          <td style="color:var(--muted)">${c.first === c.last ? c.first : c.first + "–" + c.last}</td>
          <td class="num score">${score3(c.best)}</td><td class="num col-perfs">${c.n}</td></tr>`).join("")
        || "<tr><td colspan='6' class='empty'>No matches.</td></tr>";
      rowsEl.querySelectorAll("tr[data-slug]").forEach(tr => {
        tr.onclick = e => {
          if (e.target.closest(".addbtn")) return;
          location.hash = `#/corps/${tr.dataset.slug}`;
        };
      });
      rowsEl.querySelectorAll(".addbtn").forEach(bt => bt.onclick = () => {
        const s = bt.dataset.add;
        corpsSet.has(s) ? corpsSet.delete(s) : corpsSet.add(s);
        corpsSel = [...corpsSet];
        msCorps.refresh();
        persist(); draw(); renderRows();
      });
    }
    document.getElementById("q").addEventListener("input", renderRows);
    document.querySelectorAll(".tab[data-f]").forEach(bt => bt.onclick = () => {
      filter = bt.dataset.f;
      document.querySelectorAll(".tab[data-f]").forEach(x => x.classList.toggle("on", x === bt));
      renderRows();
    });

    persist();
    renderRows();
    draw();
  }

  /* ============ CORPS DETAIL ============ */
  async function viewCorps(slug, stale) {
    setNav("corps");
    let detail;
    try { detail = await data(`corps/${slug}.json`); }
    catch (e) {
      if (stale()) return;
      app.innerHTML = `<div class="card" style="text-align:center;padding:36px 20px">
        <div class="empty" style="padding:0 0 10px">No scores on record for this corps yet.</div>
        <a href="#/corps">Browse all corps →</a></div>`;
      return;
    }
    const champs = await data("champions.json").catch(() => ({}));
    if (stale()) return;
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
    const cmpYears = years.slice(-3).reverse().join(",");

    app.innerHTML = h`
      <div class="crumbs"><a href="#/corps">Corps</a> / ${esc(detail.name)}</div>
      <h1 class="page">${esc(detail.name)}</h1>
      <div class="filters"><select class="ctrl" id="yearSel2"><option value="">All years</option>
        ${years.slice().reverse().map(y => `<option>${y}</option>`).join("")}</select></div>
      <div class="card"><h2 id="corpsChartTitle"></h2><div class="chartwrap" id="corpsChart"></div></div>
      <div class="card" style="margin-top:14px"><h2 id="perfTitle">Performance log</h2>
        <div id="perfTable"></div></div>
      <div class="grid cols-tiles" style="margin-top:14px">
        <div class="tile"><div class="label">Performances</div><div class="value">${perfs.length}</div><div class="sub">${years[0]}–${years[years.length - 1]}</div></div>
        <div class="tile"><div class="label">Best score</div><div class="value">${scored.length ? score3(Math.max(...scored.map(p => p.s))) : "—"}</div></div>
        <div class="tile"><div class="label">Titles</div><div class="value">${titles.length}</div><div class="sub">${esc(titles.slice(-3).join(" · ") || "—")}</div></div>
      </div>`;

    // the year filter drives BOTH the chart and the log
    function renderChart() {
      const yv = document.getElementById("yearSel2").value;
      const title = document.getElementById("corpsChartTitle");
      if (yv) {
        title.innerHTML = `${yv} season progression <span class="sub">score by date · <a href="#/corps?c=${slug}&y=${cmpYears}">compare seasons →</a></span>`;
        const pts = (byYear.get(+yv) || []).filter(p => p.s && p.d)
          .map(p => ({ x: dayOfSeason(p.d), y: p.s })).sort((a, b) => a.x - b.x);
        lineChart(document.getElementById("corpsChart"), {
          linearX: true, series: [{ name: yv, points: pts }],
          height: 260, xFmt: dayLabel, yFmt: v => v.toFixed(1),
        });
        return;
      }
      // All years: every scored performance in time order — no smoothing, no
      // interpolation across seasons the corps didn't march (line breaks there)
      const dated = perfs.filter(p => p.s && p.d)
        .map(p => ({ x: p.y + Math.min(Math.max(dayOfSeason(p.d), 0), 120) / 130, y: p.s }))
        .sort((a, b) => a.x - b.x);
      if (dated.length >= 5) {
        title.innerHTML = `Every scored performance <span class="sub">${years[0]}–${years[years.length - 1]} · gaps = seasons not marched · <a href="#/corps?c=${slug}&y=${cmpYears}">compare seasons →</a></span>`;
        const segs = [];
        let cur = [];
        for (const p of dated) {
          if (cur.length && p.x - cur[cur.length - 1].x > 1.2) { segs.push(cur); cur = []; }
          cur.push(p);
        }
        if (cur.length) segs.push(cur);
        lineChart(document.getElementById("corpsChart"), {
          linearX: true, noLegend: true,
          series: segs.map(pts => ({ name: "Score", points: pts, color: PALETTE[0] })),
          height: 260, yFmt: v => v.toFixed(0), xFmt: v => String(Math.floor(v)),
        });
      } else {
        title.innerHTML = `Season-best score by year <span class="sub"><a href="#/corps?c=${slug}&y=${cmpYears}">compare seasons on one chart →</a></span>`;
        lineChart(document.getElementById("corpsChart"), {
          linearX: true,
          series: [{ name: "Season best", points: years.map((y, i) => ({ x: y, y: bestByYear[i] })).filter(p => p.y) }],
          height: 260, yFmt: v => v.toFixed(0), xFmt: v => String(Math.round(v)),
        });
      }
    }

    function renderPerfs() {
      const yv = document.getElementById("yearSel2").value;
      document.getElementById("perfTitle").innerHTML =
        `Performance log${yv ? ` <span class="sub">${esc(yv)} only</span>` : ""}`;
      const list = perfs.filter(p => !yv || p.y === +yv)
        .sort((a, b) => (b.d || "").localeCompare(a.d || "") || b.y - a.y);
      document.getElementById("perfTable").innerHTML = `<div class="tscroll"><table class="t">
        <thead><tr><th>Date</th><th>Event</th><th>Class</th><th class="num">Place</th><th class="num">Score</th></tr></thead>
        <tbody>${list.slice(0, 400).map(p => h`<tr>
          <td style="color:var(--muted);white-space:nowrap">${esc(fmtDate(p.d) || p.y)}</td>
          <td>${esc(p.ev || "")}</td>
          <td><span class="pill">${esc(p.cls || "")}</span></td>
          <td class="num">${p.p ?? "—"}</td><td class="num score">${score3(p.s)}</td></tr>`).join("")}</tbody></table></div>`;
    }
    document.getElementById("yearSel2").addEventListener("change", () => { renderChart(); renderPerfs(); });
    renderChart();
    renderPerfs();
  }

  /* ============ SEASONS ============ */
  async function viewSeasons(_m, stale) {
    setNav("seasons");
    const [meta, champs] = await Promise.all([data("meta.json"), data("champions.json").catch(() => ({}))]);
    if (stale()) return;
    const years = meta.seasons.slice().sort((a, b) => b.year - a.year);
    app.innerHTML = h`
      <h1 class="page">Seasons</h1>
      <div class="card"><div class="years">
        ${years.map(s => {
          const c = champs[String(s.year)] && (champs[String(s.year)]["World Class"] || {}).corps;
          return `<a class="year" href="#/season/${s.year}">${s.year}<small>${s.events} events${c ? " · 🏆 " + esc(c) : ""}</small></a>`;
        }).join("")}
      </div></div>
      <div class="card" style="margin-top:14px"><h2>Champions <span class="sub">World Championship Finals winners in the archive</span></h2>
      <div class="tscroll dense"><table class="t" id="champT"></table></div></div>
      <p class="pagenote">Open a year to see each show that happened — who performed, in what class, and every score — with caption recaps where DCI published them.</p>`;
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

  function eventWinner(ev) {
    let winner = null;
    for (const c of ev.classes || []) {
      const r0 = (c.results || []).find(r => r.score);
      if (r0 && (!winner || (r0.score || 0) > (winner.score || 0))) winner = r0;
    }
    return winner;
  }

  function eventBodyHtml(ev, year, i) {
    return h`
      ${(ev.classes || []).map(c => h`
        <h3 class="evcls">${esc(c.class)} <span class="kicker">${c.results.length} corps</span></h3>
        <table class="t"><tbody>
        ${c.results.map(r => `<tr><td class="rank">${r.place ?? "—"}</td><td>${corpsLink(r.corps)}</td><td class="num score">${score3(r.score)}</td></tr>`).join("")}
        </tbody></table>`).join("")}
      <div style="margin-top:10px;font-size:13px">
        <a href="#/event/${year}/${i}">${(ev.recap && ev.recap.length) ? "Caption recap & full page →" : "Event page →"}</a>
      </div>`;
  }

  const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  async function viewSeason(year, stale) {
    setNav("seasons");
    let events;
    try { events = await data(`seasons/${year}.json`); }
    catch (e) {
      if (!stale()) app.innerHTML = "<div class='card'><div class='empty'>No data for this season yet.</div></div>";
      return;
    }
    if (stale()) return;

    // filter option sets from the actual data
    const clsSet = new Set();
    const monthSet = new Set();
    events.forEach(ev => {
      (ev.classes || []).forEach(c => clsSet.add(c.class));
      if (ev.date) monthSet.add(+ev.date.split("-")[1]);
    });
    const clsList = sortClasses([...clsSet]);
    const monthList = [...monthSet].sort((a, b) => a - b);

    app.innerHTML = h`
      <div class="crumbs"><a href="#/seasons">Seasons</a> / ${year}</div>
      <h1 class="page">${year} season <span class="kicker">· ${events.length} events</span></h1>
      <div class="filters">
        <select class="ctrl" id="fCls"><option value="">All classes</option>
          ${clsList.map(c => `<option>${esc(c)}</option>`).join("")}</select>
        <select class="ctrl" id="fMon"><option value="">All months</option>
          ${monthList.map(m => `<option value="${m}">${MONTH_FULL[m - 1]}</option>`).join("")}</select>
        <input class="ctrl" id="fQ" placeholder="Search event, city or corps…">
        <button class="tab" id="expandAll">Expand all</button>
        <button class="tab" id="collapseAll">Collapse all</button>
      </div>
      <div id="evcount" class="kicker" style="margin:-6px 0 10px"></div>
      <div id="evlist"></div>
      <p class="pagenote">Every show of the summer in date order. Tap any event to unfold the complete results — every corps, every class, every score.</p>`;

    const list = document.getElementById("evlist");

    function toggle(row, force) {
      const body = row.querySelector(".evbody");
      const head = row.querySelector(".evhead");
      const open = force != null ? force : body.hidden;
      if (open && !body.dataset.filled) {
        const i = +row.dataset.i;
        body.innerHTML = eventBodyHtml(events[i], year, i);
        body.dataset.filled = "1";
      }
      body.hidden = !open;
      row.classList.toggle("open", open);
      head.setAttribute("aria-expanded", String(open));
    }

    function matches(ev, cls, mon, q) {
      if (cls && !(ev.classes || []).some(c => c.class === cls)) return false;
      if (mon && (!ev.date || +ev.date.split("-")[1] !== +mon)) return false;
      if (q) {
        const hay = (ev.name + " " + (ev.location || "")).toLowerCase();
        const inCorps = (ev.classes || []).some(c =>
          (c.results || []).some(r => (r.corps || "").toLowerCase().includes(q)));
        if (!hay.includes(q) && !inCorps) return false;
      }
      return true;
    }

    function render() {
      const cls = document.getElementById("fCls").value;
      const mon = document.getElementById("fMon").value;
      const q = document.getElementById("fQ").value.trim().toLowerCase();
      const idxs = events.map((ev, i) => [ev, i]).filter(([ev]) => matches(ev, cls, mon, q));
      document.getElementById("evcount").textContent =
        idxs.length === events.length ? "" : `${idxs.length} of ${events.length} events match`;
      list.innerHTML = idxs.map(([ev, i]) => {
        const winner = eventWinner(ev);
        return h`<div class="evrow card" data-i="${i}">
          <button class="evhead" aria-expanded="false">
            <span class="evwhen">${esc(fmtDate(ev.date) || ev.date_display || "")}</span>
            <span class="evmain"><b>${esc(ev.name)}${(ev.recap && ev.recap.length) ? ' <span class="pill evpill">recap</span>' : ""}</b><span class="evloc">${esc(ev.location || "")}</span></span>
            <span class="evwin">${winner ? h`${esc(winner.corps)}<b>${score3(winner.score)}</b>` : ""}</span>
            <span class="caret">▸</span>
          </button>
          <div class="evbody" hidden></div>
        </div>`;
      }).join("") || "<div class='card'><div class='empty'>No events match those filters.</div></div>";
      list.querySelectorAll(".evrow").forEach(row => {
        row.querySelector(".evhead").onclick = () => toggle(row);
      });
    }

    ["fCls", "fMon", "fQ"].forEach(id =>
      document.getElementById(id).addEventListener(id === "fQ" ? "input" : "change", render));
    document.getElementById("expandAll").onclick = () =>
      list.querySelectorAll(".evrow").forEach(r => toggle(r, true));
    document.getElementById("collapseAll").onclick = () =>
      list.querySelectorAll(".evrow").forEach(r => toggle(r, false));
    render();
  }

  async function viewEvent(year, idx, stale) {
    setNav("seasons");
    const events = await data(`seasons/${year}.json`);
    if (stale()) return;
    const ev = events[+idx];
    if (!ev) { app.innerHTML = "<div class='empty'>Event not found.</div>"; return; }
    app.innerHTML = h`
      <div class="crumbs"><a href="#/seasons">Seasons</a> / <a href="#/season/${year}">${year}</a> / ${esc(ev.name)}</div>
      <h1 class="page">${esc(ev.name)}</h1>
      <p class="lede">${esc(ev.date_display || fmtDate(ev.date) || "")}${ev.location ? " · " + esc(ev.location) : ""}${ev.url ? h` · <a href="${encodeURI(ev.url)}" target="_blank" rel="noopener">source ↗</a>` : ""}</p>
      ${(ev.classes || []).map(c => h`
        <div class="card" style="margin-bottom:14px"><h2>${esc(c.class)}</h2>
        <table class="t"><thead><tr><th>#</th><th>Corps</th><th class="num">Score</th></tr></thead><tbody>
        ${c.results.map(r => `<tr><td class="rank">${r.place ?? "—"}</td><td>${corpsLink(r.corps)}</td><td class="num score">${score3(r.score)}</td></tr>`).join("")}
        </tbody></table></div>`).join("")}
      ${(ev.recap || []).map(rc => h`
        <div class="card" style="margin-bottom:14px"><h2>Caption recap — ${esc(rc.class)}</h2>
        <div class="tscroll dense"><table class="t">
          ${(rc.captions || []).length ? `<thead><tr>${rc.captions.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>` : ""}
          <tbody>${rc.rows.map(r => `<tr>${r.cells.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table></div>
        ${ev.recap_url ? `<div style="margin-top:8px;font-size:12.5px"><a href="${encodeURI(ev.recap_url)}" target="_blank" rel="noopener">Official recap ↗</a></div>` : ""}
        </div>`).join("")}`;
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

  async function viewDatabase(_m, stale) {
    setNav("database");
    app.innerHTML = `<h1 class="page">Database <span id="dbcount" class="kicker"></span></h1>
      <div class="filters">
        <input class="ctrl" id="fq" placeholder="Search corps or event…">
        <select class="ctrl" id="fcls"><option value="">All classes</option></select>
        <select class="ctrl" id="fy1"></select>
        <select class="ctrl" id="fy2"></select>
        <button class="tab" id="csv">Export CSV</button>
      </div>
      <div class="card"><div id="dbtable"><div class="loading">Loading…</div></div></div>
      <p class="pagenote">Every scored performance as one big table. Sort by any column, stack filters, search anything, and export the result to CSV.</p>`;
    let rows;
    try { rows = await loadDb(); }
    catch (e) {
      const el = document.getElementById("dbtable");
      if (!stale() && el) el.innerHTML = "<div class='empty'>Database builds with the next data run.</div>";
      return;
    }
    if (stale() || !document.getElementById("dbtable")) return;

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
        `<div class="tscroll dense"><table class="t"><thead><tr>${COLS.map((c, i) =>
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
    [/^#\/corps(?:\?(.*))?$/, (m, st) => viewCorpsHub(m[1], st)],
    [/^#\/corps\/([a-z0-9-]+)$/, (m, st) => viewCorps(m[1], st)],
    [/^#\/seasons$/, viewSeasons],
    [/^#\/season\/(\d{4})$/, (m, st) => viewSeason(m[1], st)],
    [/^#\/event\/(\d{4})\/(\d+)$/, (m, st) => viewEvent(m[1], m[2], st)],
    [/^#\/database$/, viewDatabase],
    // legacy routes from earlier versions
    [/^#\/compare(?:\?.*)?$/, () => { location.replace("#/corps"); }],
    [/^#\/(today|rankings)$/, viewRankings],
    [/^#\/season\/dci\/(\d{4})$/, (m, st) => viewSeason(m[1], st)],
  ];

  let firstBuildPending = false;
  let navGen = 0; // bumped per navigation; stale async view work bails out
  async function route() {
    const gen = ++navGen;
    const stale = () => gen !== navGen;
    const hashv = location.hash || "#/";
    window.scrollTo(0, 0);
    for (const [re, fn] of routes) {
      const m = hashv.match(re);
      if (m) {
        try { await fn(m, stale); } catch (e) {
          if (stale()) return; // a view we already left failed — ignore
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
