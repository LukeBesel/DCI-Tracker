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
  function fmtDateY(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return `${MONTHS[m - 1]} ${d}, ${y}`;
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
  // Collapse long tables to the first `n` rows with a Show-all toggle.
  // Safe to call again after a re-render (replaces its own button).
  function collapseRows(tbody, n, noun) {
    const host = tbody.closest(".tscroll") || tbody.closest("table").parentElement;
    const old = host.parentElement.querySelector(":scope > .expandwrap");
    if (old) old.remove();
    const rows = [...tbody.rows];
    if (rows.length <= n + 3) return;
    let open = false;
    const applyRows = () => rows.slice(n).forEach(r => r.classList.toggle("hid", !open));
    const wrap = document.createElement("div");
    wrap.className = "expandwrap";
    const btn = document.createElement("button");
    btn.className = "tab";
    btn.onclick = () => {
      open = !open;
      applyRows();
      btn.textContent = open ? `Show top ${n} ▴` : `Show all ${rows.length} ${noun} ▾`;
    };
    btn.textContent = `Show all ${rows.length} ${noun} ▾`;
    wrap.appendChild(btn);
    host.insertAdjacentElement("afterend", wrap);
    applyRows();
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
        (cfg.options.find(o => String(o.value) === String(v)) ||
          { label: cfg.labelFor ? cfg.labelFor(v) : v }).label);
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
        (cfg.presets || []).forEach(p => bar.appendChild(mk(p.label, () => {
          cfg.selected.clear();
          p.values().forEach(v => cfg.selected.add(String(v)));
        })));
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
    return {
      refresh: renderBtn,
      setOptions: opts => {
        cfg.options = opts;
        renderBtn();
        if (mount.classList.contains("open")) renderPanel();
      },
    };
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
      <div class="card">
        <h2 id="trendTitle">Season progression <span class="sub" id="trendSub">score by date · top 12</span></h2>
        <div class="filters" style="margin:2px 0 8px"><div id="trendCorpsSel"></div><button class="tab" id="trendReset" hidden>Top 12</button></div>
        <div class="chartwrap" id="trendChart"></div>
      </div>
      <div class="grid cols-2" style="margin-top:14px">
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

    // progression chart: top 12 by default, or the corps the viewer picks
    const trendPick = new Set();
    function drawTrend() {
      const el = document.getElementById("trendChart");
      if (!el) return;
      const rows = trendPick.size
        ? block.rows.filter(r => trendPick.has(r.corps))
        : block.rows.slice(0, 12);
      document.getElementById("trendSub").textContent =
        trendPick.size ? `score by date · ${rows.length} selected` : "score by date · top 12";
      document.getElementById("trendReset").hidden = !trendPick.size;
      lineChart(el, {
        linearX: true,
        series: rows.map(r => ({ name: r.corps, points: r.trend.map(t => ({ x: dayOfSeason(t[0]), y: t[1] })) })),
        height: 340, xFmt: dayLabel, yFmt: v => v.toFixed(1),
      });
    }
    const msTrend = multiSelect(document.getElementById("trendCorpsSel"), {
      label: "Pick corps to chart…", searchable: block.rows.length > 12,
      options: block.rows.map(r => ({ value: r.corps, label: r.corps, hint: `#${r.rank}` })),
      selected: trendPick,
      onChange: drawTrend,
    });
    document.getElementById("trendReset").onclick = () => {
      trendPick.clear();
      msTrend.refresh();
      drawTrend();
    };
    drawTrend();

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
    collapseRows(document.querySelector("#standings tbody"), 5, "corps");

    // Upcoming events with lineups
    const up = await data("upcoming.json").catch(() => []);
    const upEl = document.getElementById("upcomingCard");
    if (stale() || !upEl) return; // user navigated away while loading
    if (up.length) {
      upEl.innerHTML = `<h2>Upcoming events <span class="sub">who's performing next</span></h2>` +
        up.slice(0, 6).map(ev => {
          const lineup = ev.lineup || [];
          const head = lineup.slice(0, 7).map(c => corpsLink(c)).join(", ");
          const rest = lineup.slice(7).map(c => corpsLink(c)).join(", ");
          const more = rest
            ? `<span class="lineup-rest" hidden>, ${rest}</span> <button class="lineup-more" data-n="${lineup.length - 7}">+${lineup.length - 7} more ▾</button>`
            : "";
          return h`<div class="upitem">
            <div><b>${esc(ev.name)}</b> <span class="kicker">${esc(fmtDate(ev.date))}</span></div>
            <div style="color:var(--muted);font-size:12px">${esc(ev.location || "")}</div>
            ${lineup.length ? `<div class="lineup">${head}${more}</div>` : ""}
          </div>`;
        }).join("") +
        `<div style="margin-top:8px"><a href="#/season/${rk.season}">All ${rk.season} results →</a></div>`;
      upEl.querySelectorAll(".lineup-more").forEach(bt => bt.onclick = () => {
        const rest = bt.previousElementSibling;
        rest.hidden = !rest.hidden;
        bt.textContent = rest.hidden ? `+${bt.dataset.n} more ▾` : "fewer ▴";
      });
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

    // corps "type" = the class it most recently competed in, folded into the
    // major families (historical junior divisions etc. group under Historical)
    const TYPE_FAMILIES = ["World Class", "Open Class", "All-Age", "International"];
    const corpsClass = c => {
      for (let i = (c.series || []).length - 1; i >= 0; i--) {
        const k = c.series[i][2];
        if (k) return TYPE_FAMILIES.includes(k) ? k : "Historical";
      }
      return "Historical";
    };
    const classList = sortClasses([...new Set(idx.map(corpsClass))]);
    const savedCls = localStorage.getItem("dt-corpsclass");
    let clsFilter = savedCls != null && (savedCls === "" || classList.includes(savedCls))
      ? savedCls
      : (classList.includes("World Class") ? "World Class" : "");
    const classMatch = c => !clsFilter || corpsClass(c) === clsFilter;

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
          <select class="ctrl" id="fClass" title="Corps type"></select>
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
    const corpsOptions = () => idx.filter(classMatch)
      .sort((a, b) => b.last - a.last || a.name.localeCompare(b.name))
      .map(c => ({ value: c.slug, label: c.name, hint: c.first === c.last ? String(c.first) : `${c.first}–${c.last}` }));
    const msCorps = multiSelect(document.getElementById("corpsSel"), {
      label: "Select corps…", searchable: true,
      labelFor: v => (bySlug.get(v) || { name: v }).name,
      options: corpsOptions(),
      selected: corpsSet,
      onChange: v => { corpsSel = v; persist(); draw(); renderRows(); },
    });

    // corps-type filter drives both the dropdown and the directory
    const fClass = document.getElementById("fClass");
    fClass.add(new Option("All types", ""));
    classList.forEach(c => fClass.add(new Option(c, c)));
    fClass.value = clsFilter;
    fClass.onchange = () => {
      clsFilter = fClass.value;
      localStorage.setItem("dt-corpsclass", clsFilter);
      msCorps.setOptions(corpsOptions());
      renderRows();
    };
    const msYears = multiSelect(document.getElementById("yearSel"), {
      label: "Select seasons…", searchable: allYears.length > 15, bulk: true,
      presets: [{ label: "Past 5", values: () => allYears.slice(0, 5) }],
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
        classMatch(c) &&
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
      collapseRows(rowsEl, 5, "corps");
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
      // All years: top score per season — the line only connects consecutive
      // seasons, so years the corps didn't march show as real gaps and an
      // in-progress season sits as its own point instead of dragging the line
      title.innerHTML = `Top score by year <span class="sub">gaps = seasons not marched · <a href="#/corps?c=${slug}&y=${cmpYears}">compare seasons →</a></span>`;
      const ptsAll = years.map((y, i) => ({ x: y, y: bestByYear[i] })).filter(p => p.y);
      const segs = [];
      let cur = [];
      for (const p of ptsAll) {
        if (cur.length && p.x - cur[cur.length - 1].x > 1) { segs.push(cur); cur = []; }
        cur.push(p);
      }
      if (cur.length) segs.push(cur);
      lineChart(document.getElementById("corpsChart"), {
        linearX: true, noLegend: true,
        series: segs.map(pts => ({ name: "Top score", points: pts, color: PALETTE[0] })),
        height: 260, yFmt: v => v.toFixed(0), xFmt: v => String(Math.round(v)),
      });
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
          <td style="color:var(--muted);white-space:nowrap">${esc(fmtDateY(p.d) || p.y)}</td>
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
      <h1 class="page">Season History</h1>
      <div class="card"><h2>Past champions <span class="sub">World Championship Finals winners</span></h2>
      <div class="tscroll dense"><table class="t" id="champT"></table></div></div>
      <div class="card" style="margin-top:14px"><h2>Browse a season <span class="sub">every show of that summer — who performed, and every score</span></h2>
      <div class="years">
        ${years.map(s => {
          const c = champs[String(s.year)] && (champs[String(s.year)]["World Class"] || {}).corps;
          return `<a class="year" href="#/season/${s.year}">${s.year}<small>${s.events} events${c ? " · 🏆 " + esc(c) : ""}</small></a>`;
        }).join("")}
      </div></div>
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

    // the season's outcome: championship finals podium, when scraped
    const finalsIdx = events.reduce((best, e, i) => {
      const n = (e.name || "").toLowerCase();
      if (n.includes("championship") && n.includes("final")
          && !/semi|prelim|quarter/.test(n) && !(e.source === "dcx" && !n.includes("dci"))) {
        if (best < 0 || (e.date || "") > (events[best].date || "")) return i;
      }
      return best;
    }, -1);
    let finalsHtml = "";
    if (finalsIdx >= 0) {
      const fe = events[finalsIdx];
      finalsHtml = h`<div class="card" style="margin-bottom:14px">
        <h2>Final standings <span class="sub">${esc(fe.name)} · ${esc(fmtDate(fe.date) || fe.date_display || "")}</span></h2>
        <div class="grid cols-tiles">
        ${(fe.classes || []).map(c => h`<div>
          <h3 class="evcls" style="margin-top:4px">${esc(c.class)}</h3>
          <table class="t"><tbody>
          ${(c.results || []).slice(0, 5).map(r => `<tr><td class="rank">${r.place ?? "—"}</td><td>${corpsLink(r.corps)}</td><td class="num score">${score3(r.score)}</td></tr>`).join("")}
          </tbody></table></div>`).join("")}
        </div>
        <div style="margin-top:8px;font-size:13px"><a href="#/event/${year}/${finalsIdx}">Full finals results →</a></div>
      </div>`;
    }

    app.innerHTML = h`
      <div class="crumbs"><a href="#/seasons">Seasons</a> / ${year}</div>
      <h1 class="page">${year} season <span class="kicker">· ${events.length} events</span></h1>
      ${finalsHtml}
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

    // verified caption breakdown for this show, when available
    let capRows = [];
    try {
      const all = await data(`captions/${year}.json`);
      capRows = all.filter(r => r[1] === ev.name && (!ev.date || r[0] === ev.date));
    } catch (e) { /* captions not built for this season */ }
    if (stale()) return; // bail whether the captions fetch succeeded or not
    const capByClass = new Map();
    capRows.forEach(r => {
      const arr = capByClass.get(r[2]) || [];
      arr.push(r);
      capByClass.set(r[2], arr);
    });
    const CAP_HEAD = [["ge", "GE"], ["vp", "Vis Prof"], ["va", "Vis Anal"], ["cg", "Guard"], ["br", "Brass"], ["ma", "Mus Anal"], ["pc", "Perc"], ["tot", "Total"]];
    const CIDX = { date: 0, event: 1, cls: 2, corps: 3, ge1: 4, ge2: 5, ge: 6, vp: 7, va: 8, cg: 9, vis: 10, br: 11, ma: 12, pc: 13, mus: 14, pen: 15, tot: 16 };
    const capTable = cls => {
      const rows = (capByClass.get(cls) || []).slice().sort((a, b) => b[CIDX.tot] - a[CIDX.tot]);
      if (!rows.length) return "";
      return h`<h3 class="evcls" style="margin-top:14px">Caption breakdown <span class="kicker">verified against the official recap</span></h3>
        <div class="tscroll"><table class="t"><thead><tr><th>Corps</th>${CAP_HEAD.map(([, l]) => `<th class="num">${l}</th>`).join("")}</tr></thead><tbody>
        ${rows.map(r => `<tr><td>${corpsLink(r[CIDX.corps])}</td>${CAP_HEAD.map(([k]) =>
          `<td class="num${k === "tot" ? " score" : ""}">${r[CIDX[k]] == null ? "—" : (+r[CIDX[k]]).toFixed(k === "tot" ? 3 : 2)}</td>`).join("")}</tr>`).join("")}
        </tbody></table></div>`;
    };

    app.innerHTML = h`
      <div class="crumbs"><a href="#/seasons">Seasons</a> / <a href="#/season/${year}">${year}</a> / ${esc(ev.name)}</div>
      <h1 class="page">${esc(ev.name)}</h1>
      <p class="lede">${esc(ev.date_display || fmtDate(ev.date) || "")}${ev.location ? " · " + esc(ev.location) : ""}${ev.url ? h` · <a href="${encodeURI(ev.url)}" target="_blank" rel="noopener">source ↗</a>` : ""}</p>
      ${(ev.classes || []).map(c => h`
        <div class="card" style="margin-bottom:14px"><h2>${esc(c.class)}</h2>
        <table class="t"><thead><tr><th>#</th><th>Corps</th><th class="num">Score</th></tr></thead><tbody>
        ${c.results.map(r => `<tr><td class="rank">${r.place ?? "—"}</td><td>${corpsLink(r.corps)}</td><td class="num score">${score3(r.score)}</td></tr>`).join("")}
        </tbody></table>
        ${capTable(c.class)}</div>`).join("")}
      ${(ev.recap || []).map(rc => h`
        <div class="card" style="margin-bottom:14px"><h2>Caption recap — ${esc(rc.class)}</h2>
        <div class="tscroll dense"><table class="t">
          ${(rc.captions || []).length ? `<thead><tr>${rc.captions.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>` : ""}
          <tbody>${rc.rows.map(r => `<tr>${r.cells.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table></div>
        ${ev.recap_url ? `<div style="margin-top:8px;font-size:12.5px"><a href="${encodeURI(ev.recap_url)}" target="_blank" rel="noopener">Official recap ↗</a></div>` : ""}
        </div>`).join("")}`;
  }

  /* ============ CAPTIONS ============ */
  const CAPTION_DEFS = [
    ["ge", "General Effect"], ["ge1", "GE 1"], ["ge2", "GE 2"],
    ["vis", "Visual"], ["vp", "Visual Proficiency"], ["va", "Visual Analysis"], ["cg", "Color Guard"],
    ["mus", "Music"], ["br", "Brass"], ["ma", "Music Analysis"], ["pc", "Percussion"],
    ["tot", "Total"],
  ];

  async function viewCaptions(qs, stale) {
    setNav("captions");
    let cindex;
    try { cindex = await data("captions/index.json"); }
    catch (e) {
      if (!stale()) app.innerHTML = "<div class='card'><div class='empty'>Caption data builds with the next data run.</div></div>";
      return;
    }
    if (stale()) return;
    const cols = cindex.cols;
    const seasons = cindex.seasons.map(s => s.year).sort((a, b) => b - a);
    const params = parseHashQuery(qs);
    let year = +params.y && seasons.includes(+params.y) ? +params.y : seasons[0];
    let capKey = CAPTION_DEFS.some(([k]) => k === params.cap) ? params.cap : "ge";

    app.innerHTML = `
      <h1 class="page">Caption scores</h1>
      <div class="filters">
        <select class="ctrl" id="capYear">${seasons.map(y => `<option>${y}</option>`).join("")}</select>
        <select class="ctrl" id="capKey">${CAPTION_DEFS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
        <span id="capClassTabs" style="display:flex;gap:6px;flex-wrap:wrap"></span>
      </div>
      <div class="card">
        <h2 id="capChartTitle"></h2>
        <div class="filters" style="margin:2px 0 8px"><div id="capCorpsSel"></div><button class="tab" id="capReset" hidden>Top 8</button></div>
        <div class="chartwrap" id="capChart"></div>
      </div>
      <div class="card" style="margin-top:14px">
        <h2 id="capBoardTitle"></h2>
        <div id="capBoard"></div>
      </div>
      <p class="pagenote">Every number here comes from DCI's published judge recaps and is arithmetically reconciled (caption sums must reproduce the official total) before it's shown. Dual-judge panels at big regionals are averaged, exactly as on the sheet.</p>`;

    document.getElementById("capYear").value = String(year);
    document.getElementById("capKey").value = capKey;

    let rows = [];
    let cls = "";
    let loadGen = 0; // guards against out-of-order season loads
    const capPick = new Set();
    let msCap = null;

    const iDate = () => cols.indexOf("date"), iEv = () => cols.indexOf("event"),
      iCls = () => cols.indexOf("class"), iCorps = () => cols.indexOf("corps");

    function classesIn(rs) { return sortClasses([...new Set(rs.map(r => r[iCls()]))]); }

    function renderClassTabs() {
      const tabs = document.getElementById("capClassTabs");
      tabs.innerHTML = "";
      classesIn(rows).forEach(c => {
        const b = document.createElement("button");
        b.className = "tab" + (c === cls ? " on" : "");
        b.textContent = c;
        b.onclick = () => { cls = c; capPick.clear(); update(); };
        tabs.appendChild(b);
      });
    }

    function corpsSeries() {
      const ki = cols.indexOf(capKey);
      const per = new Map();
      for (const r of rows) {
        if (r[iCls()] !== cls || r[ki] == null || !r[iDate()]) continue;
        const arr = per.get(r[iCorps()]) || [];
        arr.push({ d: r[iDate()], ev: r[iEv()], v: r[ki] });
        per.set(r[iCorps()], arr);
      }
      per.forEach(a => a.sort((x, y) => x.d.localeCompare(y.d)));
      return per;
    }

    function update() {
      renderClassTabs();
      const per = corpsSeries();
      const label = (CAPTION_DEFS.find(([k]) => k === capKey) || [])[1];
      const board = [...per.entries()].map(([corps, a]) => {
        const best = a.reduce((m, p) => p.v > m.v ? p : m, a[0]);
        return { corps, best: best.v, bestEv: best.ev, bestD: best.d, latest: a[a.length - 1].v, n: a.length };
      }).sort((x, y) => y.best - x.best);
      board.forEach((b, i) => { b.rank = i + 1; });

      // chart: picked corps, else top 8 by best
      const chosen = capPick.size ? board.filter(b => capPick.has(b.corps)) : board.slice(0, 8);
      document.getElementById("capChartTitle").innerHTML =
        `${esc(label)} progression <span class="sub">${esc(String(year))} · ${capPick.size ? chosen.length + " selected" : "top 8"}</span>`;
      document.getElementById("capReset").hidden = !capPick.size;
      lineChart(document.getElementById("capChart"), {
        linearX: true,
        series: chosen.map(b => ({
          name: b.corps,
          points: per.get(b.corps).map(p => ({ x: dayOfSeason(p.d), y: p.v })),
        })),
        height: 330, xFmt: dayLabel, yFmt: v => v.toFixed(1),
      });

      document.getElementById("capBoardTitle").innerHTML =
        `${esc(label)} leaders <span class="sub">best single-show score, ${esc(String(year))} ${esc(cls)}</span>`;
      document.getElementById("capBoard").innerHTML = board.length ? `
        <table class="t"><thead><tr><th>#</th><th>Corps</th><th class="num">Best</th><th>At</th><th class="num col-high">Latest</th><th class="num col-perfs">Scored shows</th></tr></thead><tbody>
        ${board.slice(0, 20).map(b => h`<tr>
          <td class="rank">${b.rank}</td>
          <td>${corpsLink(b.corps)}</td>
          <td class="num score">${score3(b.best)}</td>
          <td style="color:var(--muted);font-size:12.5px">${esc(b.bestEv)} · ${esc(fmtDate(b.bestD))}</td>
          <td class="num col-high">${score3(b.latest)}</td>
          <td class="num col-perfs">${b.n}</td></tr>`).join("")}
        </tbody></table>` : "<div class='empty'>No recap data for this caption yet — it fills in as recaps are scraped.</div>";

      // corps picker persists across updates so the panel stays open
      const capOptions = board.map(b => ({ value: b.corps, label: b.corps, hint: `#${b.rank}` }));
      if (!msCap) {
        msCap = multiSelect(document.getElementById("capCorpsSel"), {
          label: "Pick corps to chart…", searchable: true,
          options: capOptions,
          selected: capPick,
          onChange: update,
        });
        document.getElementById("capReset").onclick = () => { capPick.clear(); msCap.refresh(); update(); };
      } else {
        msCap.setOptions(capOptions);
      }

      if (!stale()) history.replaceState(null, "", `#/captions?y=${year}&cap=${capKey}`);
    }

    async function loadYear() {
      const gen = ++loadGen;
      let got;
      try { got = await data(`captions/${year}.json`); }
      catch (e) { got = []; }
      if (stale() || gen !== loadGen) return; // navigated away or picked another year
      rows = got;
      const cl = classesIn(rows);
      cls = cl.includes(cls) ? cls : (cl[0] || "");
      update();
    }

    document.getElementById("capYear").onchange = e => { year = +e.target.value; capPick.clear(); loadYear(); };
    document.getElementById("capKey").onchange = e => { capKey = e.target.value; update(); };
    await loadYear();
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
    app.innerHTML = `<h1 class="page">Score database <span id="dbcount" class="kicker"></span></h1>
      <div class="filters" id="dbFilters">
        <div id="dbCorps"></div>
        <div id="dbYears"></div>
        <select class="ctrl" id="fcls"><option value="">All classes</option></select>
        <input class="ctrl" id="fq" placeholder="Search event…">
        <button class="tab" id="dbReset" title="Clear all filters">Reset</button>
        <button class="tab" id="csv">Export CSV</button>
      </div>
      <div class="card"><div id="dbtable"><div class="loading">Loading…</div></div></div>
      <p class="pagenote">Every scored performance on record, as one sortable table. Combine the corps, season, and class filters, search events, click any column to sort, and export exactly what you've filtered to CSV.</p>`;
    let rows;
    try { rows = await loadDb(); }
    catch (e) {
      const el = document.getElementById("dbtable");
      if (!stale() && el) el.innerHTML = "<div class='empty'>Database builds with the next data run.</div>";
      return;
    }
    if (stale() || !document.getElementById("dbtable")) return;

    const years = [...new Set(rows.map(r => r[0]))].sort((a, b) => b - a);
    const classes = [...new Set(rows.map(r => r[4]).filter(Boolean))].sort();
    const corpsNames = [...new Set(rows.map(r => r[3]).filter(Boolean))].sort();
    const fcls = document.getElementById("fcls");
    classes.forEach(c => fcls.add(new Option(c, c)));

    const corpsSet = new Set();
    const yearSet = new Set();
    const msDbCorps = multiSelect(document.getElementById("dbCorps"), {
      label: "All corps", searchable: true,
      options: corpsNames.map(n => ({ value: n, label: n })),
      selected: corpsSet,
      onChange: apply,
    });
    const msDbYears = multiSelect(document.getElementById("dbYears"), {
      label: "All seasons", searchable: years.length > 15, bulk: true,
      presets: [{ label: "Past 5", values: () => years.slice(0, 5) }],
      options: years.map(y => ({ value: String(y), label: String(y) })),
      selected: yearSet,
      onChange: apply,
    });

    const COLS = ["Year", "Date", "Event", "Corps", "Class", "Place", "Score"];
    let filtered = rows;

    function apply() {
      const q = document.getElementById("fq").value.trim().toLowerCase();
      const cls = fcls.value;
      filtered = rows.filter(r =>
        (!yearSet.size || yearSet.has(String(r[0]))) &&
        (!corpsSet.size || corpsSet.has(r[3])) &&
        (!cls || r[4] === cls) &&
        (!q || (r[2] || "").toLowerCase().includes(q)));
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

    document.getElementById("dbReset").onclick = () => {
      corpsSet.clear(); yearSet.clear();
      fcls.value = "";
      document.getElementById("fq").value = "";
      msDbCorps.refresh(); msDbYears.refresh();
      apply();
    };

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

    ["fq", "fcls"].forEach(id =>
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
    [/^#\/captions(?:\?(.*))?$/, (m, st) => viewCaptions(m[1], st)],
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
