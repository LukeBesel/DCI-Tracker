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
  // stacked date for table cells: "Jul 10" with the year underneath
  function fmtDate2(iso, fallback) {
    if (!iso) return fallback == null ? "" : esc(String(fallback));
    const [y, m, d] = iso.split("-").map(Number);
    return `<span class="dstack">${MONTHS[m - 1]} ${d}<small>${y}</small></span>`;
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

  /* ===== stable per-corps colors =====
     Identity-informed for the marquee corps (blues separated into navy /
     cyan / indigo, reds into scarlet / crimson so nothing reads alike),
     stable hash into a spread 16-color palette for everyone else.
     The same corps gets the same color on every page, chart and filter. */
  const CORPS_COLORS = {
    "Blue Devils": "#1c4a99",        // navy
    "Bluecoats": "#0c8599",          // cyan-teal
    "Blue Knights": "#3b5bdb",       // indigo
    "Carolina Crown": "#9c36b5",     // crown purple
    "Santa Clara Vanguard": "#f03e3e", // scarlet
    "Boston Crusaders": "#a61e1e",   // dark crimson
    "The Cavaliers": "#2f9e44",      // kelly green
    "Madison Scouts": "#1e6b30",     // forest green
    "Phantom Regiment": "#343a40",   // graphite (black & white corps)
    "The Cadets": "#85144b",         // maroon
    "Mandarins": "#e8590c",          // orange
    "Colts": "#b35c00",              // burgundy-brown
    "Blue Stars": "#d6336c",         // red side of their red/blue
    "Crossmen": "#846358",           // bronze
    "Blue Devils B": "#356fc4",      // lighter than the A corps
  };
  const EXT_PALETTE = [
    "#e8590c", "#1971c2", "#2f9e44", "#6741d9", "#c2255c", "#0c8599",
    "#a61e4d", "#495057", "#b35c00", "#66a80f", "#f03e3e", "#9c36b5",
    "#3b5bdb", "#d6336c", "#087f5b", "#846358",
  ];
  function corpsColor(name) {
    const n = String(name || "");
    if (CORPS_COLORS[n]) return CORPS_COLORS[n];
    let hsum = 0;
    for (let i = 0; i < n.length; i++) hsum = (hsum * 31 + n.charCodeAt(i)) >>> 0;
    return EXT_PALETTE[hsum % EXT_PALETTE.length];
  }
  const FAVS = (() => {
    let set;
    try { set = new Set(JSON.parse(localStorage.getItem("cad-favs") || "[]")); }
    catch (e) { set = new Set(); }
    return {
      has: n => set.has(n),
      list: () => [...set],
      toggle: n => {
        set.has(n) ? set.delete(n) : set.add(n);
        localStorage.setItem("cad-favs", JSON.stringify([...set]));
      },
    };
  })();

  function corpsLink(name) {
    const fav = FAVS.has(name);
    return `<a href="#/corps/${slugOf(name)}"${fav ? ' class="favname"' : ""}>${fav ? "★ " : ""}${esc(name)}</a>`;
  }
  function setNav(route) {
    document.querySelectorAll("#nav a").forEach(a =>
      a.classList.toggle("active", a.dataset.route === route));
  }
  // Collapse long tables to the first `n` rows with a Show-all toggle.
  // Safe to call again after a re-render (replaces its own button).
  function collapseRows(tbody, n, noun) {
    const host = tbody.closest(".tscroll") || tbody.closest("table").parentElement;
    const old = host.nextElementSibling;
    if (old && old.classList && old.classList.contains("expandwrap")) old.remove();
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
      btn.textContent = open ? `Show Top ${n} ▴` : `Show All ${rows.length} ${noun} ▾`;
    };
    btn.textContent = `Show All ${rows.length} ${noun} ▾`;
    wrap.appendChild(btn);
    host.insertAdjacentElement("afterend", wrap);
    applyRows();
  }

  const CAP_KEY_NOTE = "<p class='capkey'>GE General Effect · VP Visual Proficiency · VA Visual Analysis · CG Color Guard · BR Brass · MA Music Analysis · PC Percussion</p>";

  // pill sub-tabs inside the Data tab
  const DATA_SUBS = [["compare", "Compare"], ["captions", "Captions"], ["champions", "Champions"], ["records", "Records"], ["database", "Database"]];
  const dataSubNav = active => `<div class="subtabs">${DATA_SUBS.map(([k, l]) =>
    `<a href="#/${k}" class="${k === active ? "on" : ""}">${l}</a>`).join("")}</div>`;

  // one-choice slicer with the same look as the checkbox pickers
  function singleSelect(mount, cfg) {
    const selected = new Set(cfg.value != null ? [String(cfg.value)] : []);
    const ms = multiSelect(mount, {
      label: cfg.label || "", single: true, searchable: cfg.searchable,
      options: cfg.options, selected,
      onChange: v => cfg.onChange(v[0]),
    });
    return {
      get: () => [...selected][0],
      set: v => { selected.clear(); if (v != null) selected.add(String(v)); ms.refresh(); },
      setOptions: opts => ms.setOptions(opts),
      refresh: () => ms.refresh(),
    };
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
      // a view can name well-known selections ("Top 12"); null falls through
      if (cfg.summary) {
        const s = cfg.summary();
        if (s != null) return s;
      }
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
        if (cfg.bulkAll !== false) bar.appendChild(mk("Select all", () => cfg.options.forEach(o => cfg.selected.add(String(o.value)))));
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
            if (cfg.single) {
              cfg.selected.clear();
              cfg.selected.add(k);
              closeMsels();
            } else {
              cb.checked ? cfg.selected.add(k) : cfg.selected.delete(k);
            }
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
      <h1 class="page">${esc(String(rk.season))} Scoreboard</h1>
      <div class="filters"><div id="clsSel"></div></div>
      <div class="card">
        <h2 id="trendTitle">Season Progression <span class="sub" id="trendSub">score by date · top 12</span></h2>
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
      </div>`;

    singleSelect(document.getElementById("clsSel"), {
      label: "Class",
      options: classes.map(c => ({ value: c, label: c, hint: `${rk.standings[c].rows.length} corps` })),
      value: cls,
      onChange: v => { localStorage.setItem("dt-class", v); viewRankings(null, stale); },
    });

    const block = rk.standings[cls];

    // progression chart: top 12 pre-selected — open the picker to tweak
    const top12 = block.rows.slice(0, 12).map(r => r.corps);
    const trendPick = new Set(top12);
    const isDefaultPick = () => trendPick.size === top12.length && top12.every(c => trendPick.has(c));
    function drawTrend() {
      const el = document.getElementById("trendChart");
      if (!el) return;
      const rows = block.rows.filter(r => trendPick.has(r.corps));
      document.getElementById("trendSub").textContent =
        isDefaultPick() ? "score by date · top 12" : `score by date · ${rows.length} selected`;
      document.getElementById("trendReset").hidden = isDefaultPick();
      lineChart(el, {
        linearX: true,
        series: rows.map(r => ({ name: r.corps, color: corpsColor(r.corps),
          points: r.trend.map(t => ({ x: dayOfSeason(t[0]), y: t[1] })) })),
        height: 340, xFmt: dayLabel, yFmt: v => v.toFixed(1),
      });
    }
    const msTrend = multiSelect(document.getElementById("trendCorpsSel"), {
      label: "Pick corps to chart…", searchable: block.rows.length > 12,
      summary: () => isDefaultPick() ? "Top 12" : null,
      bulk: true, bulkAll: false,
      presets: [{ label: "Top 12", values: () => top12 }],
      options: block.rows.map(r => ({ value: r.corps, label: r.corps, hint: `#${r.rank}` })),
      selected: trendPick,
      onChange: drawTrend,
    });
    document.getElementById("trendReset").onclick = () => {
      trendPick.clear();
      top12.forEach(c => trendPick.add(c));
      msTrend.refresh();
      drawTrend();
    };
    drawTrend();

    function renderStandings() {
      const sorted = block.rows.slice().sort((a, b) =>
        (FAVS.has(b.corps) ? 1 : 0) - (FAVS.has(a.corps) ? 1 : 0) || a.rank - b.rank);
      document.getElementById("standTitle").innerHTML =
        `${esc(cls)} Standings <span class="sub">each corps' most recent score · ★ pins favorites</span>`;
      document.getElementById("standings").innerHTML = `
        <table class="t standings"><thead><tr><th></th><th>#</th><th>Corps · last event</th><th class="num">Score</th><th class="num col-high">3-show avg</th><th class="num col-high">Season high</th><th class="num">vs prev</th><th class="col-trend">Trend</th></tr></thead><tbody>
        ${sorted.map(r => h`<tr${FAVS.has(r.corps) ? ' class="favrow"' : ""}>
          <td><button class="favbtn${FAVS.has(r.corps) ? " on" : ""}" data-fav="${esc(r.corps)}" title="${FAVS.has(r.corps) ? "Unpin" : "Pin to top"}">${FAVS.has(r.corps) ? "★" : "☆"}</button></td>
          <td class="rank">${r.rank}</td>
          <td>${corpsLink(r.corps)}<div class="lastev">${esc(r.event)} · ${esc(fmtDateY(r.date))}</div></td>
          <td class="num score">${score3(r.score)}</td>
          <td class="num col-high" data-tip="Average of the last ${Math.min(3, r.trend.length)} shows — smooths out one judging panel">${score3(r.trend.slice(-3).reduce((a, t) => a + t[1], 0) / Math.min(3, r.trend.length))}</td>
          <td class="num col-high" data-tip="${esc(`${score3(r.high)} — ${r.high_event || ""} · ${fmtDateY(r.high_date) || ""}`)}">${score3(r.high)}</td>
          <td class="num">${deltaHtml(r.delta)}</td>
          <td class="col-trend"><span class="sparkcell" data-trend="${r.trend.map(t => t[1]).join(",")}"></span></td>
        </tr>`).join("")}</tbody></table>`;
      document.querySelectorAll(".sparkcell").forEach(elm => {
        sparkline(elm, elm.dataset.trend.split(",").map(Number).filter(n => !isNaN(n)), "#97a2b3");
      });
      document.querySelectorAll(".favbtn").forEach(bt => bt.onclick = () => {
        FAVS.toggle(bt.dataset.fav);
        renderStandings();
      });
      collapseRows(document.querySelector("#standings tbody"), 5, "corps");
    }
    renderStandings();

    // Upcoming events with lineups
    const up = await data("upcoming.json").catch(() => []);
    const upEl = document.getElementById("upcomingCard");
    if (stale() || !upEl) return; // user navigated away while loading
    if (up.length) {
      upEl.innerHTML = `<h2>Upcoming Events <span class="sub">who's performing next</span></h2>` +
        up.slice(0, 6).map(ev => {
          const lineup = ev.lineup || [];
          const head = lineup.slice(0, 7).map(c => corpsLink(c)).join(", ");
          const rest = lineup.slice(7).map(c => corpsLink(c)).join(", ");
          const more = rest
            ? `<span class="lineup-rest" hidden>, ${rest}</span> <button class="lineup-more" data-n="${lineup.length - 7}">+${lineup.length - 7} more ▾</button>`
            : "";
          return h`<div class="upitem">
            <div><b>${esc(ev.name)}</b> <span class="kicker">${esc(fmtDateY(ev.date))}</span></div>
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
      upEl.innerHTML = `<h2>Upcoming Events</h2>
        <div class="empty" style="padding:12px 0">Schedule updates with the nightly data run.</div>
        <div><a href="#/season/${rk.season}">All ${rk.season} results →</a></div>`;
    }

    const jump = block.movers && block.movers[0];
    document.getElementById("moveCard").innerHTML = jump ? h`
      <h2>Biggest Move <span class="sub">latest show vs previous</span></h2>
      <div style="font-size:20px;font-weight:650">${corpsLink(jump.corps)}</div>
      <div style="color:var(--text-secondary)">${score3(jump.prev_score)} → <b>${score3(jump.score)}</b> ${deltaHtml(jump.delta)}</div>
      ${block.movers.slice(1).map(m => `<div style="font-size:13px;margin-top:6px">${corpsLink(m.corps)} ${deltaHtml(m.delta)}</div>`).join("")}`
      : "<h2>Biggest Move</h2><div class='empty'>Needs two shows.</div>";

    const b = block.battles && block.battles[0];
    document.getElementById("battleCard").innerHTML = b ? h`
      <h2>Closest Battle <span class="sub">smallest gap in standings</span></h2>
      <table class="t">
        <tr><td class="rank">${b.ra}</td><td>${corpsLink(b.a)}</td><td class="num score">${score3(b.sa)}</td></tr>
        <tr><td class="rank">${b.rb}</td><td>${corpsLink(b.b)}</td><td class="num score">${score3(b.sb)}</td></tr>
      </table>
      <div style="margin-top:8px;font-size:13px;color:var(--text-secondary)">Gap: <b style="color:var(--bad)">${b.gap.toFixed(3)}</b></div>`
      : "<h2>Closest Battle</h2><div class='empty'>Needs two corps within striking distance.</div>";
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

  async function viewCorpsHub(qs, stale) {
    setNav("data");
    const [meta, idx, rk] = await Promise.all([
      data("meta.json"), data("corps_index.json"), data("rankings.json").catch(() => null)]);
    if (stale()) return;
    const allYears = meta.seasons.map(s => s.year).sort((a, b) => b - a);
    const bySlug = new Map(idx.map(c => [c.slug, c]));
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
    // stays empty; only a fresh arrival gets the default matchup:
    // the current #1 corps, this season vs their previous one
    if (!explicit && !corpsSel.length && !yearsSel.length) {
      const rows = rk && rk.standings && (rk.standings["World Class"] || Object.values(rk.standings)[0] || {}).rows;
      corpsSel = (rows || []).slice(0, 1).map(r => slugOf(r.corps)).filter(s => bySlug.has(s));
      if (!corpsSel.length) corpsSel = idx.slice(0, 1).map(c => c.slug);
      const leader = bySlug.get(corpsSel[0]);
      const theirYears = leader ? leader.series.map(s => s[0]).sort((a, b) => b - a) : allYears;
      yearsSel = theirYears.slice(0, 2).filter(y => allYears.includes(y));
      if (!yearsSel.length) yearsSel = allYears.slice(0, 2);
    }

    function persist() {
      if (stale()) return; // never rewrite the URL of a view we've left
      sessionStorage.setItem("cmp-corps", JSON.stringify(corpsSel));
      sessionStorage.setItem("cmp-years", JSON.stringify(yearsSel));
      const q = `c=${corpsSel.join(",")}&y=${yearsSel.slice().sort((a, b) => b - a).join(",")}`;
      history.replaceState(null, "", `#/compare?${q}`);
    }

    app.innerHTML = `
      ${dataSubNav("compare")}
      <h1 class="page">Compare <span class="kicker">· any corps, any seasons</span></h1>
      <div class="card">
        <h2>Score Progression <span class="sub">tap ⊕ in the directory below to add corps</span></h2>
        <div class="filters" style="margin-bottom:10px">
          <div id="fClass"></div>
          <div id="corpsSel"></div>
          <div id="yearSel"></div>
          <button class="tab" id="clearSel" title="Reset selection">Clear</button>
        </div>
        <div id="cmpNotice"></div>
        <div class="chartwrap" id="cmpChart"><div class="loading">Loading…</div></div>
        <div id="cmpTable" style="margin-top:12px"></div>
      </div>
      <div class="card" style="margin-top:14px">
        <h2 id="dirTitle">All Corps <span class="sub">tap a corps for its full history · ⊕ adds it to the chart</span></h2>
        <div class="filters">
          <input class="ctrl" id="q" placeholder="Search corps…">
        </div>
        <div class="tscroll"><table class="t"><thead>
          <tr><th></th><th>Corps</th><th>Years</th><th class="num">Best score</th></tr>
        </thead><tbody id="rows"></tbody></table></div>
      </div>`;

    // --- multiselects ---
    const corpsSet = new Set(corpsSel);
    const yearSet = new Set(yearsSel.map(String));
    const corpsOptions = () => idx.filter(classMatch)
      .sort((a, b) => b.last - a.last || a.name.localeCompare(b.name))
      .map(c => ({ value: c.slug, label: c.name, hint: c.first === c.last ? String(c.first) : `${c.first}–${c.last}` }));
    const msCorps = multiSelect(document.getElementById("corpsSel"), {
      label: "Select corps…", searchable: true,
      labelFor: v => (bySlug.get(v) || { name: v }).name,
      bulk: true, bulkAll: false,
      options: corpsOptions(),
      selected: corpsSet,
      onChange: v => { corpsSel = v; persist(); draw(); renderRows(); },
    });

    // corps-type filter drives both the dropdown and the directory
    singleSelect(document.getElementById("fClass"), {
      label: "Type",
      options: [{ value: "", label: "All types" }, ...classList.map(c => ({ value: c, label: c }))],
      value: clsFilter,
      onChange: v => {
        clsFilter = v || "";
        localStorage.setItem("dt-corpsclass", clsFilter);
        msCorps.setOptions(corpsOptions());
        renderRows();
      },
    });
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
                if (r.corps === name && r.score) pts.push({ x: dayOfSeason(ev.date), y: r.score, ev: ev.name, d: ev.date });
              }
            }
          }
          pts.sort((a, b) => a.x - b.x);
          if (!pts.length) continue;
          combos++;
          const label = multiYears || !multiCorps ? `${name} ’${String(years[yi]).slice(2)}` : name;
          // colors and dashes key off the calendar year itself, not its
          // position in the selection — filtering never recolors a line
          series.push({
            name: label, points: pts,
            color: multiCorps ? corpsColor(name) : PALETTE[years[yi] % PALETTE.length],
            dash: multiCorps && multiYears ? YEAR_DASHES[years[yi] % YEAR_DASHES.length] : "",
          });
          const scores = pts.map(p => p.y);
          const hiPt = pts.reduce((m, p) => p.y > m.y ? p : m, pts[0]);
          const tipOf = p => `${score3(p.y)} — ${p.ev} · ${fmtDateY(p.d)}`;
          summary.push({
            corps: name, year: years[yi], shows: pts.length,
            first: scores[0], latest: scores[scores.length - 1],
            high: hiPt.y,
            firstTip: tipOf(pts[0]), latestTip: tipOf(pts[pts.length - 1]), highTip: tipOf(hiPt),
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
        <div class="tscroll"><table class="t"><thead><tr><th>Corps</th><th class="num">Season</th><th class="num m-hide">First</th><th class="num">Latest / Final</th><th class="num m-hide">High</th><th class="num">Gain</th></tr></thead><tbody id="cmpRows">
        ${summary.map(s => h`<tr><td>${corpsLink(s.corps)}</td><td class="num">${s.year}</td><td class="num m-hide" data-tip="${esc(s.firstTip)}">${score3(s.first)}</td><td class="num score" data-tip="${esc(s.latestTip)}">${score3(s.latest)}</td><td class="num m-hide" data-tip="${esc(s.highTip)}">${score3(s.high)}</td><td class="num">${s.gain > 0 ? "+" : ""}${s.gain}</td></tr>`).join("")}
        </tbody></table></div>`;
      collapseRows(document.getElementById("cmpRows"), 5, "rows");
    }

    // --- directory ---
    const rowsEl = document.getElementById("rows");
    function renderRows() {
      const q = (document.getElementById("q").value || "").toLowerCase();
      const list = idx.filter(c =>
        classMatch(c) &&
        (!q || c.name.toLowerCase().includes(q)))
        .sort((a, b) => b.last - a.last || (b.best || 0) - (a.best || 0));
      // the type dropdown above filters this list too — say so in the title
      document.getElementById("dirTitle").innerHTML =
        `All Corps${clsFilter ? ` — ${esc(clsFilter)}` : ""} <span class="sub">${list.length} corps · tap one for its history · ⊕ adds it to the chart</span>`;
      rowsEl.innerHTML = list.map(c => h`
        <tr class="rowlink" data-slug="${c.slug}">
          <td class="addcell"><button class="addbtn${corpsSet.has(c.slug) ? " on" : ""}" data-add="${c.slug}" title="${corpsSet.has(c.slug) ? "Remove from" : "Add to"} compare">${corpsSet.has(c.slug) ? "✓" : "+"}</button></td>
          <td><b>${esc(c.name)}</b></td>
          <td style="color:var(--muted)">${c.first === c.last ? c.first : c.first + "–" + c.last}</td>
          <td class="num score" data-tip="${esc(`Best ${score3(c.best)} — ${((c.series || []).find(sr => sr[1] === c.best) || [])[0] || ""} season`)}">${score3(c.best)}</td></tr>`).join("")
        || "<tr><td colspan='4' class='empty'>No matches.</td></tr>";
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

    persist();
    renderRows();
    draw();
  }

  /* ============ CORPS (single-corps tab) ============ */
  async function viewCorpsPage(slug, stale) {
    setNav("corps");
    const [idx, rk] = await Promise.all([
      data("corps_index.json"), data("rankings.json").catch(() => null)]);
    if (stale()) return;
    const bySlug = new Map(idx.map(c => [c.slug, c]));
    const classList = sortClasses([...new Set(idx.map(corpsClass))]);
    const savedCls = localStorage.getItem("dt-corpsclass");
    let clsFilter = savedCls != null && (savedCls === "" || classList.includes(savedCls))
      ? savedCls
      : (classList.includes("World Class") ? "World Class" : "");

    // default corps: the deep-linked one, else the current leader
    let current = slug && bySlug.has(slug) ? slug : null;
    if (!current && rk && rk.standings) {
      const rows = (rk.standings["World Class"] || Object.values(rk.standings)[0] || {}).rows || [];
      current = rows.length ? slugOf(rows[0].corps) : null;
      if (current && !bySlug.has(current)) current = null;
    }
    if (!current) current = idx[0] && idx[0].slug;
    // the deep-linked corps drives the type filter, not vice versa
    if (slug && bySlug.has(slug)) {
      const t = corpsClass(bySlug.get(slug));
      if (clsFilter && t !== clsFilter) clsFilter = t;
    }

    app.innerHTML = `
      <h1 class="page" id="corpsPageTitle">Corps</h1>
      <div class="filters">
        <div id="cpCls"></div>
        <div id="cpCorps"></div>
      </div>
      <div id="corpsDetail"><div class="loading">Loading…</div></div>`;


    const corpsOpts = () => idx
      .filter(c => !clsFilter || corpsClass(c) === clsFilter)
      .sort((a, b) => b.last - a.last || a.name.localeCompare(b.name))
      .map(c => ({ value: c.slug, label: c.name, hint: c.first === c.last ? String(c.first) : `${c.first}–${c.last}` }));
    const pickSet = new Set(current ? [current] : []);
    const msPick = multiSelect(document.getElementById("cpCorps"), {
      label: "Pick a corps…", searchable: true, single: true,
      labelFor: v => (bySlug.get(v) || { name: v }).name,
      options: corpsOpts(),
      selected: pickSet,
      onChange: v => { if (v[0] && v[0] !== current) { current = v[0]; load(); } },
    });
    singleSelect(document.getElementById("cpCls"), {
      label: "Type",
      options: [{ value: "", label: "All types" }, ...classList.map(c => ({ value: c, label: c }))],
      value: clsFilter,
      onChange: v => {
        clsFilter = v || "";
        localStorage.setItem("dt-corpsclass", clsFilter);
        msPick.setOptions(corpsOpts());
      },
    });

    let detailGen = 0;
    async function load() {
      const gen = ++detailGen;
      const mount = document.getElementById("corpsDetail");
      if (!mount) return;
      mount.innerHTML = "<div class='loading'>Loading…</div>";
      history.replaceState(null, "", `#/corps/${current}`);
      await renderCorpsDetail(current, () => stale() || gen !== detailGen);
    }
    if (current) await load();
    else document.getElementById("corpsDetail").innerHTML = "<div class='card'><div class='empty'>No corps on record yet.</div></div>";
  }

  async function renderCorpsDetail(slug, stale) {
    const mount = () => document.getElementById("corpsDetail");
    let detail;
    try { detail = await data(`corps/${slug}.json`); }
    catch (e) {
      if (stale() || !mount()) return;
      mount().innerHTML = `<div class="card" style="text-align:center;padding:36px 20px">
        <div class="empty" style="padding:0 0 10px">No scores on record for this corps yet.</div>
        <a href="#/compare">Browse all corps →</a></div>`;
      return;
    }
    const champs = await data("champions.json").catch(() => ({}));
    if (stale() || !mount()) return;
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

    const pt = document.getElementById("corpsPageTitle");
    if (pt) pt.textContent = detail.name;
    mount().innerHTML = h`
      <div class="filters"><div id="yearSel2"></div></div>
      <div class="card"><h2 id="corpsChartTitle"></h2><div class="chartwrap" id="corpsChart"></div></div>
      <div class="card" style="margin-top:14px"><h2 id="perfTitle">Performance Log</h2>
        <div id="perfTable"></div></div>
      <div class="grid cols-tiles" style="margin-top:14px">
        <div class="tile"><div class="label">Performances</div><div class="value">${perfs.length}</div><div class="sub">${years.length} seasons in the database</div></div>
        <div class="tile"><div class="label">Best score</div><div class="value">${scored.length ? score3(Math.max(...scored.map(p => p.s))) : "—"}</div></div>
        <div class="tile"><div class="label">Titles</div><div class="value">${titles.length}</div><div class="sub">${esc(titles.length <= 6 ? titles.join(" · ") || "—" : titles.slice(-3).join(" · ") + ` · +${titles.length - 3} more`)}</div></div>
      </div>`;

    // the year filter drives BOTH the chart and the log; one year shows the
    // full season show-by-show, several show top score per year
    const yearSet = new Set();
    const msYears = multiSelect(document.getElementById("yearSel2"), {
      label: "All years", searchable: years.length > 15, bulk: true, bulkAll: false,
      presets: [{ label: "Past 5", values: () => years.slice(-5).map(String) }],
      options: years.slice().reverse().map(y => ({ value: String(y), label: String(y) })),
      selected: yearSet,
      onChange: () => { renderChart(); renderPerfs(); },
    });
    function selYears() { return [...yearSet].map(Number).sort((a, b) => a - b); }
    function renderChart() {
      const sel = selYears();
      const title = document.getElementById("corpsChartTitle");
      if (sel.length === 1) {
        const yv = sel[0];
        title.innerHTML = `${yv} Season Progression <span class="sub">score by date · <a href="#/compare?c=${slug}&y=${cmpYears}">compare seasons →</a></span>`;
        const pts = (byYear.get(yv) || []).filter(p => p.s && p.d)
          .map(p => ({ x: dayOfSeason(p.d), y: p.s })).sort((a, b) => a.x - b.x);
        lineChart(document.getElementById("corpsChart"), {
          linearX: true, series: [{ name: String(yv), points: pts, color: corpsColor(detail.name) }],
          height: 260, xFmt: dayLabel, yFmt: v => v.toFixed(1),
        });
        return;
      }
      // top score per season — the line only connects consecutive seasons,
      // so years the corps didn't march show as real gaps and an in-progress
      // season sits as its own point instead of dragging the line
      const range = sel.length ? `${sel[0]}–${sel[sel.length - 1]}` : "";
      title.innerHTML = `Top Score by Year${range ? ` — ${range}` : ""} <span class="sub">gaps = seasons not yet in the database · <a href="#/compare?c=${slug}&y=${cmpYears}">compare seasons →</a></span>`;
      const ptsAll = years.map((y, i) => ({ x: y, y: bestByYear[i] }))
        .filter(p => p.y && (!sel.length || yearSet.has(String(p.x))));
      const segs = [];
      let cur = [];
      for (const p of ptsAll) {
        if (cur.length && p.x - cur[cur.length - 1].x > 1) { segs.push(cur); cur = []; }
        cur.push(p);
      }
      if (cur.length) segs.push(cur);
      lineChart(document.getElementById("corpsChart"), {
        linearX: true, noLegend: true,
        series: segs.map(pts => ({ name: "Top score", points: pts, color: corpsColor(detail.name) })),
        height: 260, yFmt: v => v.toFixed(0), xFmt: v => String(Math.round(v)),
      });
    }

    function renderPerfs() {
      const sel = selYears();
      const selNote = sel.length === 0 ? "" : sel.length === 1 ? `${sel[0]} only` : `${sel.length} seasons`;
      document.getElementById("perfTitle").innerHTML =
        `Performance Log${selNote ? ` <span class="sub">${esc(selNote)}</span>` : ""}`;
      const list = perfs.filter(p => !sel.length || yearSet.has(String(p.y)))
        .sort((a, b) => (b.d || "").localeCompare(a.d || "") || b.y - a.y);
      document.getElementById("perfTable").innerHTML = `<div class="tscroll"><table class="t">
        <thead><tr><th>Date</th><th>Event</th><th class="m-hide">Class</th><th class="num">Place</th><th class="num">Score</th></tr></thead>
        <tbody id="perfRows">${list.slice(0, 600).map(p => h`<tr>
          <td style="color:var(--muted);white-space:nowrap">${fmtDate2(p.d, p.y)}</td>
          <td>${esc(p.ev || "")}</td>
          <td class="m-hide"><span class="pill">${esc(p.cls || "")}</span></td>
          <td class="num">${p.p ?? "—"}</td><td class="num score">${score3(p.s)}</td></tr>`).join("")}</tbody></table></div>`;
      collapseRows(document.getElementById("perfRows"), 5, "performances");
    }
    renderChart();
    renderPerfs();
  }

  /* ============ SEASONS ============ */
  async function viewSeasons(_m, stale) {
    setNav("data");
    const [meta, champs] = await Promise.all([
      data("meta.json"), data("champions.json").catch(() => ({}))]);
    if (stale()) return;
    const years = meta.seasons.slice().sort((a, b) => b.year - a.year);
    // COVID years appear as labeled rows inside the era they interrupt
    const yrNums = years.map(s => s.year);
    [2020, 2021].forEach(cy => {
      if (yrNums.some(n => n > cy) && yrNums.some(n => n < cy))
        years.push({ year: cy, covid: true });
    });
    years.sort((a, b) => b.year - a.year);
    app.innerHTML = h`
      ${dataSubNav("champions")}
      <h1 class="page">Champions <span class="kicker">· the record book, 1972–today</span></h1>
      <div class="card"><h2>Past Champions <span class="sub" id="champSub"></span></h2>
      <div class="filters" style="margin-bottom:8px"><div id="champCls"></div></div>
      <div class="tscroll"><table class="t" id="champT"></table></div>
      <p style="color:var(--muted);font-size:12.5px;margin:10px 2px 0">Tap a year for that season — every show, every score, full recaps.</p>
      <div id="champChartWrap" hidden style="margin-top:16px">
        <h2>Winning Score by Year <span class="sub" id="champChartSub"></span></h2>
        <div class="chartwrap" id="champChart"></div>
      </div></div>`;

    // one table: every season, its champion, click through to the year
    const clsSet = new Set();
    Object.values(champs).forEach(byCls => Object.keys(byCls).forEach(c => clsSet.add(c)));
    const clsList = sortClasses([...clsSet]);
    let champCls = clsList.includes("World Class") ? "World Class" : clsList[0];
    const currentYear = Math.max(...years.map(s => s.year));
    let ssChampCls = null;
    function renderChamps() {
      if (!ssChampCls) {
        ssChampCls = singleSelect(document.getElementById("champCls"), {
          label: "Class", options: clsList.map(c => ({ value: c, label: c })), value: champCls,
          onChange: v => { champCls = v; renderChamps(); },
        });
      }
      document.getElementById("champSub").textContent = `${champCls} · every season on record`;
      // World Class shows every scraped season; other classes show the
      // seasons they actually crowned a champion (plus the running season)
      const withChamp = new Set(Object.keys(champs).filter(y => champs[y][champCls]).map(Number));
      const rowsList = [];
      years.forEach(s => {
        if (s.covid) return; // inserted after, only if this class spans the gap
        const w = champs[String(s.year)] && champs[String(s.year)][champCls];
        if (champCls === "World Class" || w || s.year === currentYear)
          rowsList.push({ y: s.year, w, events: s.events });
      });
      const clsYears = rowsList.map(r => r.y);
      [2020, 2021].forEach(cy => {
        if (clsYears.some(y => y > cy) && clsYears.some(y => y < cy))
          rowsList.push({ y: cy, covid: true });
      });
      rowsList.sort((a, b) => b.y - a.y);
      document.getElementById("champT").innerHTML = `
        <thead><tr><th>Year</th><th>Champion</th><th class="num">Score</th></tr></thead><tbody id="champRows">
        ${rowsList.map(r => {
          if (r.covid) return `<tr><td style="color:var(--muted)">${r.y}</td><td colspan="2" style="color:var(--muted)">COVID-19 — ${r.y === 2020 ? "season canceled, no championships" : "no championships held"}</td></tr>`;
          const label = r.w
            ? `<b>${esc(r.w.corps)}</b>`
            : (r.y === currentYear
              ? "<span style='color:var(--muted)'>season in progress…</span>"
              : "<span style='color:var(--muted)'>—</span>");
          return `<tr class="rowlink" data-y="${r.y}"><td><a href="#/season/${r.y}"><b>${r.y}</b></a>${r.events ? ` <span class="kicker">${r.events} events</span>` : ""}</td><td>${label}</td><td class="num score">${r.w && r.w.score ? score3(r.w.score) : "—"}</td></tr>`;
        }).join("")}</tbody>`;
      document.querySelectorAll("#champRows tr[data-y]").forEach(tr => {
        tr.onclick = e => {
          if (e.target.closest("a")) return;
          location.hash = `#/season/${tr.dataset.y}`;
        };
      });
      collapseRows(document.getElementById("champRows"), 5, "seasons");

      // the winning score, year over year — gaps stay gaps
      const pts = rowsList.filter(r => r.w && r.w.score)
        .map(r => ({ x: r.y, y: r.w.score })).sort((a, b) => a.x - b.x);
      const segs = [];
      let seg = [];
      pts.forEach(pt => {
        if (seg.length && pt.x - seg[seg.length - 1].x > 1) { segs.push(seg); seg = []; }
        seg.push(pt);
      });
      if (seg.length) segs.push(seg);
      const wrap = document.getElementById("champChartWrap");
      if (pts.length >= 3) {
        wrap.hidden = false;
        document.getElementById("champChartSub").textContent = `${champCls} title score by season`;
        lineChart(document.getElementById("champChart"), {
          linearX: true, noLegend: true,
          series: segs.map(sg => ({ name: "Winning score", points: sg, color: "#d97706" })),
          height: 240, yFmt: v => v.toFixed(1), xFmt: v => String(Math.round(v)),
        });
      } else {
        wrap.hidden = true;
      }
    }
    renderChamps();
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
    if (ev.future) {
      if (ev.schedule && ev.schedule.length) {
        return h`<h3 class="evcls">Schedule <span class="kicker">${ev.lineup.length} corps · venue time</span></h3>
          <table class="t"><tbody>
          ${ev.schedule.map(([t, entry]) => {
            const isCorps = (ev.lineup || []).includes(entry);
            return `<tr><td class="num" style="color:var(--muted);white-space:nowrap">${esc(t || "")}</td><td>${isCorps ? corpsLink(entry) : `<span style="color:var(--muted)">${esc(entry)}</span>`}</td></tr>`;
          }).join("")}
          </tbody></table>
          ${ev.location ? `<p style="font-size:12.5px;color:var(--muted);margin:8px 0 0"><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((ev.name || "") + " " + ev.location)}" target="_blank" rel="noopener">Venue map ↗</a></p>` : ""}`;
      }
      return (ev.lineup || []).length
        ? h`<h3 class="evcls">Scheduled Lineup <span class="kicker">${ev.lineup.length} corps</span></h3>
            <table class="t"><tbody>
            ${ev.lineup.map(c => `<tr><td>${corpsLink(c)}</td><td class="num" style="color:var(--muted)">upcoming</td></tr>`).join("")}
            </tbody></table>`
        : "<div class='empty'>Lineup not announced yet.</div>";
    }
    return h`
      ${(ev.classes || []).map(c => h`
        <h3 class="evcls">${esc(c.label || c.class)} <span class="kicker">${c.results.length} corps</span></h3>
        <table class="t"><tbody>
        ${c.results.map(r => `<tr><td class="rank">${r.place ?? "—"}</td><td>${corpsLink(r.corps)}</td><td class="num score">${score3(r.score)}</td></tr>`).join("")}
        </tbody></table>`).join("")}
      <div style="margin-top:10px;font-size:13px">
        <a href="#/event/${year}/${i}">${ev.has_recap ? "Caption breakdown & full page →" : "Event page →"}</a>
      </div>`;
  }

  const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  async function viewEvents(qs, stale) {
    setNav("events");
    const meta = await data("meta.json");
    if (stale()) return;
    const params = parseHashQuery(qs);
    const years = meta.seasons.map(sn => sn.year).sort((a, b) => b - a);
    let year = +params.y && years.includes(+params.y) ? +params.y : years[0];
    app.innerHTML = `
      <h1 class="page">Shows <span class="kicker" id="evCount"></span></h1>
      <div class="filters"><div id="evYearSel"></div></div>
      <div id="seasonMount"><div class="loading">Loading…</div></div>`;
    let gen = 0;
    async function load() {
      const g = ++gen;
      history.replaceState(null, "", `#/events?y=${year}`);
      const mount = document.getElementById("seasonMount");
      if (mount) mount.innerHTML = "<div class='loading'>Loading…</div>";
      await renderSeason(year, () => stale() || g !== gen);
    }
    singleSelect(document.getElementById("evYearSel"), {
      label: "Season", searchable: years.length > 15,
      options: years.map(y => ({ value: String(y), label: String(y) })),
      value: String(year),
      onChange: v => { year = +v; load(); },
    });
    await load();
  }

  async function renderSeason(year, stale) {
    const mount = () => document.getElementById("seasonMount");
    let events;
    try { events = await data(`seasons/${year}.json`); }
    catch (e) {
      if (!stale() && mount()) mount().innerHTML = "<div class='card'><div class='empty'>No data for this season yet.</div></div>";
      return;
    }
    if (stale() || !mount()) return;

    // running season: the schedule's future events join the list, marked
    // "upcoming" — the season page is the one place with the whole summer
    events = events.slice(); // never mutate the array shared by the data() cache
    if (+year === new Date().getFullYear()) {
      const up = await data("upcoming.json").catch(() => []);
      if (stale()) return;
      const seen = new Set(events.map(e => (e.date || "") + "|" + (e.name || "").toLowerCase()));
      for (const u of up) {
        if (!u.date || !String(u.date).startsWith(String(year))) continue;
        if (seen.has(u.date + "|" + (u.name || "").toLowerCase())) continue;
        events.push({ name: u.name, date: u.date, location: u.location,
          lineup: u.lineup || [], future: true });
      }
    }

    // filter option sets from the actual data
    const clsSet = new Set();
    events.forEach(ev => (ev.classes || []).forEach(c => clsSet.add(c.class)));
    const clsList = sortClasses([...clsSet]);

    // the season's outcome: championship finals podium, when scraped
    const finalsIdx = events.reduce((best, e, i) => {
      if (e.future) return best; // a scheduled finals is not a result
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
        <h2>Final Standings <span class="sub">${esc(fe.name)} · ${esc(fmtDateY(fe.date) || fe.date_display || "")}</span></h2>
        <div class="grid cols-tiles">
        ${(fe.classes || []).map(c => h`<div>
          <h3 class="evcls" style="margin-top:4px">${esc(c.label || c.class)}</h3>
          <table class="t"><tbody>
          ${(c.results || []).slice(0, 5).map(r => `<tr><td class="rank">${r.place ?? "—"}</td><td>${corpsLink(r.corps)}</td><td class="num score">${score3(r.score)}</td></tr>`).join("")}
          </tbody></table></div>`).join("")}
        </div>
        <div style="margin-top:8px;font-size:13px"><a href="#/event/${year}/${finalsIdx}">Full finals results →</a></div>
      </div>`;
    }

    const cnt = document.getElementById("evCount");
    if (cnt) cnt.textContent = `· ${year} — ${events.filter(e => !e.future).length} events${events.some(e => e.future) ? `, ${events.filter(e => e.future).length} upcoming` : ""}`;
    mount().innerHTML = h`
      ${finalsHtml}
      <div class="filters">
        <div id="fCls"></div>
        <div id="fCorps"></div>
        <input class="ctrl" id="fQ" placeholder="Search event or city…">
        <button class="tab" id="toggleAll">Expand All ▾</button>
      </div>
      <div id="evcount" class="kicker" style="margin:-6px 0 10px"></div>
      <div id="evlist"></div>`;

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

    function matches(ev, cls, q) {
      if (cls && !(ev.classes || []).some(c => c.class === cls)) return false;
      if (corpsPick.size) {
        const featured = (ev.lineup || []).some(c => corpsPick.has(c)) ||
          (ev.classes || []).some(c => (c.results || []).some(r => corpsPick.has(r.corps)));
        if (!featured) return false;
      }
      if (cls && ev.future) return false;
      if (q) {
        const hay = (ev.name + " " + (ev.location || "")).toLowerCase();
        const inCorps = (ev.classes || []).some(c =>
          (c.results || []).some(r => (r.corps || "").toLowerCase().includes(q)))
          || (ev.lineup || []).some(c => c.toLowerCase().includes(q));
        if (!hay.includes(q) && !inCorps) return false;
      }
      return true;
    }

    function render() {
      const cls = fClsVal;
      const q = document.getElementById("fQ").value.trim().toLowerCase();
      const idxs = events.map((ev, i) => [ev, i]).filter(([ev]) => matches(ev, cls, q));
      // reading order for "what's happening": the next few shows, then the
      // most recent results, back through the season
      idxs.sort(([a], [b]) => {
        if (!!a.future !== !!b.future) return a.future ? -1 : 1;
        const cmpd = (a.date || "").localeCompare(b.date || "");
        return a.future ? cmpd : -cmpd;
      });
      const futureN = idxs.filter(([e]) => e.future).length;
      const upCap = upOpen ? Infinity : 5;
      let upSeen = 0;
      const shownIdxs = idxs.filter(([e]) => !e.future || upSeen++ < upCap);
      document.getElementById("evcount").textContent =
        idxs.length === events.length ? "" : `${idxs.length} of ${events.length} events match`;
      list.innerHTML = shownIdxs.map(([ev, i]) => {
        const winner = eventWinner(ev);
        return h`<div class="evrow card" data-i="${i}">
          <button class="evhead" aria-expanded="false">
            <span class="evwhen">${fmtDate2(ev.date, ev.date_display)}</span>
            <span class="evmain"><b>${esc(ev.name)}${ev.has_recap ? ' <span class="pill evpill">recap</span>' : ""}</b><span class="evloc">${esc(ev.location || "")}</span></span>
            <span class="evwin">${ev.future ? '<span class="pill">upcoming</span>' : winner ? h`${esc(winner.corps)}<b>${score3(winner.score)}</b>` : ""}</span>
            <span class="caret">▸</span>
          </button>
          <div class="evbody" hidden></div>
        </div>`;
      }).join("") || "<div class='card'><div class='empty'>No events match those filters.</div></div>";
      if (futureN > upCap) {
        const btn = document.createElement("button");
        btn.className = "tab";
        btn.style.cssText = "display:block;margin:2px auto 12px";
        btn.textContent = `Show all ${futureN} upcoming ▾`;
        btn.onclick = () => { upOpen = true; render(); };
        list.insertBefore(btn, list.children[Math.min(5, list.children.length)] || null);
      }
      list.querySelectorAll(".evrow").forEach(row => {
        row.querySelector(".evhead").onclick = () => toggle(row);
      });
    }

    let allOpen = false;
    let upOpen = false;
    const corpsPick = new Set();
    let fClsVal = "";
    singleSelect(document.getElementById("fCls"), {
      label: "All classes",
      options: [{ value: "", label: "All classes" }, ...clsList.map(c => ({ value: c, label: c }))],
      value: "",
      onChange: v => { fClsVal = v || ""; allOpen = false; syncToggle(); render(); },
    });
    document.getElementById("fQ").addEventListener("input", () => { allOpen = false; syncToggle(); render(); });
    // corps picker: see just one corps' summer (favorites are one tap away)
    const seasonCorps = [...new Set(events.flatMap(ev => [
      ...(ev.lineup || []),
      ...(ev.classes || []).flatMap(c => (c.results || []).map(r => r.corps)),
    ]))].sort();
    multiSelect(document.getElementById("fCorps"), {
      label: "All corps", searchable: seasonCorps.length > 12, bulk: true, bulkAll: false,
      presets: FAVS.list().length ? [{ label: "★ Favorites", values: () => FAVS.list().filter(c => seasonCorps.includes(c)) }] : [],
      options: seasonCorps.map(c => ({ value: c, label: c })),
      selected: corpsPick,
      onChange: () => { allOpen = false; syncToggle(); render(); },
    });
    const toggleBtn = document.getElementById("toggleAll");
    function syncToggle() { toggleBtn.textContent = allOpen ? "Collapse All ▴" : "Expand All ▾"; }
    toggleBtn.onclick = () => {
      allOpen = !allOpen;
      list.querySelectorAll(".evrow").forEach(r => toggle(r, allOpen));
      syncToggle();
    };
    render();
  }

  async function viewEvent(year, idx, stale) {
    setNav("events");
    const events = await data(`seasons/${year}.json`);
    if (stale()) return;
    const ev = events[+idx];
    if (!ev) { app.innerHTML = "<div class='empty'>Event not found.</div>"; return; }

    // verified caption breakdown for this show, when available
    // (recaps only exist for the DCI.org era — skip the fetch for old years)
    let capRows = [];
    try {
      if (+year >= 2013) {
        const all = await data(`captions/${year}.json`);
        capRows = all.filter(r => r[1] === ev.name && (!ev.date || r[0] === ev.date));
      }
    } catch (e) { /* captions not built for this season */ }
    if (stale()) return; // bail whether the captions fetch succeeded or not
    const capByClass = new Map();
    capRows.forEach(r => {
      const arr = capByClass.get(r[2]) || [];
      arr.push(r);
      capByClass.set(r[2], arr);
    });
    const CAP_HEAD = [["ge", "GE"], ["vp", "VP"], ["va", "VA"], ["cg", "CG"], ["br", "BR"], ["ma", "MA"], ["pc", "PC"], ["tot", "Total"]];
    const CIDX = { date: 0, event: 1, cls: 2, corps: 3, ge1: 4, ge2: 5, ge: 6, vp: 7, va: 8, cg: 9, vis: 10, br: 11, ma: 12, pc: 13, mus: 14, pen: 15, tot: 16 };
    const capTable = (cls, ci) => {
      const rows = (capByClass.get(cls) || []).slice().sort((a, b) => b[CIDX.tot] - a[CIDX.tot]);
      if (!rows.length) return "";
      return h`<h3 class="evcls" style="margin-top:14px">Caption Breakdown <span class="kicker">verified against the official recap · tap a column to sort</span></h3>
        <div class="tscroll"><table class="t sticky1 capsort"><thead><tr><th>Corps</th>${CAP_HEAD.map(([k, l]) => `<th class="num" data-sort="${k}">${l}</th>`).join("")}</tr></thead><tbody class="evcap" data-ci="${ci}">
        ${rows.map(r => `<tr><td>${corpsLink(r[CIDX.corps])}</td>${CAP_HEAD.map(([k]) =>
          `<td class="num${k === "tot" ? " score" : ""}">${r[CIDX[k]] == null ? "—" : (+r[CIDX[k]]).toFixed(k === "tot" ? 3 : 2)}</td>`).join("")}</tr>`).join("")}
        </tbody></table></div>${CAP_KEY_NOTE}`;
    };

    app.innerHTML = h`
      <div class="crumbs"><a href="#/events?y=${year}">Shows</a> / <a href="#/events?y=${year}">${year}</a> / ${esc(ev.name)}</div>
      <h1 class="page">${esc(ev.name)}</h1>
      <p class="lede">${esc(fmtDateY(ev.date) || ev.date_display || "")}${ev.location ? " · " + esc(ev.location) : ""}${ev.url ? h` · <a href="${encodeURI(ev.url)}" target="_blank" rel="noopener">source ↗</a>` : ""}</p>
      ${(ev.classes || []).map((c, ci) => h`
        <div class="card" style="margin-bottom:14px"><h2>${esc(c.label || c.class)}</h2>
        <div class="tscroll"><table class="t"><thead><tr><th>#</th><th>Corps</th><th class="num">Score</th></tr></thead><tbody class="evres" data-ci="${ci}">
        ${c.results.map(r => `<tr><td class="rank">${r.place ?? "—"}</td><td>${corpsLink(r.corps)}</td><td class="num score">${score3(r.score)}</td></tr>`).join("")}
        </tbody></table></div>
        ${capTable(c.class, ci)}</div>`).join("")}
      ${ev.recap_url ? `<p style="font-size:12.5px;color:var(--muted)"><a href="${encodeURI(ev.recap_url)}" target="_blank" rel="noopener">Official recap on DCI.org ↗</a></p>` : ""}
      ${ev.location ? `<p style="font-size:12.5px;color:var(--muted)"><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((ev.name || "") + " " + ev.location)}" target="_blank" rel="noopener">Venue map ↗</a></p>` : ""}`;
    document.querySelectorAll(".evres, .evcap").forEach(tb => collapseRows(tb, 5, "corps"));
    // tap a caption header to re-rank the sheet by that caption
    document.querySelectorAll(".capsort").forEach(table => {
      table.querySelectorAll("th[data-sort]").forEach(th => th.onclick = () => {
        const k = th.dataset.sort;
        const tb = table.tBodies[0];
        const rowsArr = [...tb.rows];
        const idx = [...table.tHead.rows[0].cells].indexOf(th);
        rowsArr.sort((a, b) => {
          const av = parseFloat(a.cells[idx].textContent) || -1;
          const bv = parseFloat(b.cells[idx].textContent) || -1;
          return bv - av;
        });
        rowsArr.forEach(r => tb.appendChild(r));
        rowsArr.forEach(r => r.classList.remove("hid"));
        const wrap = (tb.closest(".tscroll") || {}).nextElementSibling;
        if (wrap && wrap.classList && wrap.classList.contains("expandwrap")) wrap.remove();
      });
    });
  }

  /* ============ CAPTIONS ============ */
  const CAPTION_DEFS = [
    ["ge", "General Effect"], ["ge1", "GE 1"], ["ge2", "GE 2"],
    ["vis", "Visual"], ["vp", "Visual Proficiency"], ["va", "Visual Analysis"], ["cg", "Color Guard"],
    ["mus", "Music"], ["br", "Brass"], ["ma", "Music Analysis"], ["pc", "Percussion"],
    ["tot", "Total"],
  ];

  async function viewCaptions(qs, stale) {
    setNav("data");
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
      ${dataSubNav("captions")}
      <h1 class="page">Caption Scores</h1>
      <div class="filters">
        <div id="capYear"></div>
        <div id="capKey"></div>
        <div id="capCls"></div>
      </div>
      <div class="secdiv" id="capSeasonDiv"></div>
      <div class="card">
        <h2 id="showCmpTitle">Show Recap <span class="sub">every corps, every caption, one sheet — gold marks the caption winner</span></h2>
        <div class="filters" style="margin:2px 0 8px"><div id="showSel"></div></div>
        <div id="showCmpBody"><div class="empty">Pick a show above.</div></div>
        ${CAP_KEY_NOTE}
      </div>
      <div class="card" style="margin-top:14px">
        <h2 id="capChartTitle"></h2>
        <div class="filters" style="margin:2px 0 8px"><div id="capCorpsSel"></div><button class="tab" id="capReset" hidden>Top 8</button></div>
        <div class="chartwrap" id="capChart"></div>
      </div>
      <div class="card" style="margin-top:14px">
        <h2 id="capBoardTitle"></h2>
        <div id="capBoard"></div>
      </div>
      <div class="card" style="margin-top:14px">
        <h2 id="spotTitle">Corps Spotlight</h2>
        <div class="filters" style="margin:2px 0 8px"><div id="spotCorps"></div><div id="spotVs"></div></div>
        <div class="chartwrap" id="spotChart"></div>
        ${CAP_KEY_NOTE}
      </div>
      <div class="secdiv">All-Time</div>
      <div class="card">
        <h2 id="titlesTitle">Caption Titles</h2>
        <div class="filters" style="margin:2px 0 8px">
          <div id="titlesCaps"></div>
          <button class="tab" id="titlesMode">Career totals</button>
        </div>
        <div id="titlesBody"><div class="loading">Loading…</div></div>
        ${CAP_KEY_NOTE}
        <p class="capkey">* one or more recap rows for that night couldn't be fully verified — the winner shown leads among verified scores</p>
      </div>`;


    let rows = [];
    let cls = "";
    let loadGen = 0; // guards against out-of-order season loads
    const capPick = new Set();
    let seedPick = true; // (re)fill the picker with the top 12 on next update
    let msCap = null;
    let lastBoard = [];
    const capIsDefault = () => capPick.size === Math.min(12, lastBoard.length)
      && lastBoard.slice(0, 12).every(b => capPick.has(b.corps));

    const iDate = () => cols.indexOf("date"), iEv = () => cols.indexOf("event"),
      iCls = () => cols.indexOf("class"), iCorps = () => cols.indexOf("corps");

    function classesIn(rs) { return sortClasses([...new Set(rs.map(r => r[iCls()]))]); }

    // --- show recap sheet: one show, all corps, all captions ---
    let ssShow = null;
    function renderShowCmp() {
      const body = document.getElementById("showCmpBody");
      if (!body) return;
      const shows = [];
      const seen = new Set();
      for (const r of rows) {
        if (r[iCls()] !== cls || !r[iDate()]) continue;
        const key = r[iDate()] + "|" + r[iEv()];
        if (!seen.has(key)) { seen.add(key); shows.push({ d: r[iDate()], ev: r[iEv()] }); }
      }
      shows.sort((a, b) => b.d.localeCompare(a.d));
      if (!shows.length) {
        body.innerHTML = "<div class='empty'>No verified recaps for this class yet.</div>";
        if (ssShow) ssShow.setOptions([]);
        return;
      }
      const opts = shows.map(sh => ({ value: sh.d + "|" + sh.ev, label: sh.ev, hint: fmtDate(sh.d) }));
      if (!ssShow) {
        ssShow = singleSelect(document.getElementById("showSel"), {
          label: "Pick a show…", searchable: shows.length > 10,
          options: opts, value: opts[0].value,
          onChange: renderShowCmp,
        });
      } else {
        ssShow.setOptions(opts);
        if (!opts.some(o => o.value === ssShow.get())) ssShow.set(opts[0].value);
      }
      const [d, evName] = String(ssShow.get()).split("|");
      const iTot = cols.indexOf("tot");
      const sheet = rows.filter(r => r[iCls()] === cls && r[iDate()] === d && r[iEv()] === evName)
        .sort((a, b) => (b[iTot] || 0) - (a[iTot] || 0));
      const HEAD = [["ge1", "GE1"], ["ge2", "GE2"], ["ge", "GE"], ["vp", "VP"], ["va", "VA"], ["cg", "CG"], ["vis", "VIS"],
        ["br", "BR"], ["ma", "MA"], ["pc", "PC"], ["mus", "MUS"], ["pen", "Pen"], ["tot", "Total"]];
      // the best value in each caption wins the gold cell (penalty: no winner)
      const best = {};
      for (const [k] of HEAD) {
        if (k === "pen") continue;
        const i = cols.indexOf(k);
        best[k] = Math.max(...sheet.map(r => r[i] == null ? -1 : r[i]));
      }
      body.innerHTML = `<div class="tscroll"><table class="t sticky1 showcmp"><thead><tr><th>Corps</th>${HEAD.map(([k, l]) =>
          `<th class="num" data-c="${cols.indexOf(k)}">${l}</th>`).join("")}</tr></thead><tbody>
        ${sheet.map(r => `<tr><td>${corpsLink(r[iCorps()])}</td>${HEAD.map(([k]) => {
          const i = cols.indexOf(k);
          const v = r[i];
          const win = k !== "pen" && v != null && v === best[k] && best[k] >= 0;
          return `<td class="num${k === "tot" ? " score" : ""}${win ? " capwin" : ""}">${v == null ? "—" : (+v).toFixed(k === "tot" ? 3 : 2)}</td>`;
        }).join("")}</tr>`).join("")}
      </tbody></table></div>
      <p class="capkey" style="margin-top:8px">${esc(evName)} · ${esc(fmtDateY(d))} · ${sheet.length} corps · tap a column to sort</p>`;
      body.querySelectorAll("th[data-c]").forEach(th => th.onclick = () => {
        const i = +th.dataset.c;
        const tb = body.querySelector("tbody");
        [...tb.rows].sort((a, b) => {
          const idx = [...th.parentNode.children].indexOf(th);
          return (parseFloat(b.cells[idx].textContent) || -1) - (parseFloat(a.cells[idx].textContent) || -1);
        }).forEach(rw => tb.appendChild(rw));
      });
    }

    let ssCls = null;
    function renderClassTabs() {
      const cl = classesIn(rows);
      const opts = cl.map(c => ({ value: c, label: c }));
      if (!ssCls) {
        ssCls = singleSelect(document.getElementById("capCls"), {
          label: "Class", options: opts, value: cls,
          onChange: v => { cls = v; seedPick = true; update(); renderTitles(); },
        });
      } else {
        ssCls.setOptions(opts);
        ssCls.set(cls);
      }
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
        const last = a[a.length - 1];
        return { corps, best: best.v, bestEv: best.ev, bestD: best.d,
          latest: last.v, latestEv: last.ev, latestD: last.d, n: a.length };
      }).sort((x, y) => y.best - x.best);
      board.forEach((b, i) => { b.rank = i + 1; });

      // chart: top 12 pre-selected in the picker — deselect to trim
      if (seedPick) {
        capPick.clear();
        board.slice(0, 12).forEach(b => capPick.add(b.corps));
        seedPick = false;
      }
      lastBoard = board;
      const capDefault = capIsDefault();
      const chosen = board.filter(b => capPick.has(b.corps));
      const div = document.getElementById("capSeasonDiv");
      if (div) div.textContent = `${year} Season — Caption Scores`;
      document.getElementById("capChartTitle").innerHTML =
        `${esc(label)} Progression — ${esc(String(year))} <span class="sub">${capDefault ? "top 12" : chosen.length + " selected"}</span>`;
      document.getElementById("capReset").hidden = capDefault;
      document.getElementById("capReset").textContent = "Top 12";
      lineChart(document.getElementById("capChart"), {
        linearX: true,
        series: chosen.map(b => ({
          name: b.corps, color: corpsColor(b.corps),
          points: per.get(b.corps).map(p => ({ x: dayOfSeason(p.d), y: p.v })),
        })),
        height: 330, xFmt: dayLabel, yFmt: v => v.toFixed(1),
      });

      document.getElementById("capBoardTitle").innerHTML =
        `${esc(label)} Leaders — ${esc(String(year))} <span class="sub">best single-show score, ${esc(cls)}</span>`;
      document.getElementById("capBoard").innerHTML = board.length ? `
        <div class="tscroll"><table class="t"><thead><tr><th>#</th><th>Corps</th><th class="num">Best</th><th>At</th><th class="num col-high">Latest</th><th class="num col-perfs">Scored shows</th></tr></thead><tbody>
        ${board.map(b => h`<tr>
          <td class="rank">${b.rank}</td>
          <td>${corpsLink(b.corps)}</td>
          <td class="num score">${score3(b.best)}</td>
          <td style="color:var(--muted);font-size:12.5px;white-space:nowrap">${esc(b.bestEv)} · ${esc(fmtDateY(b.bestD))}</td>
          <td class="num col-high" data-tip="${esc(`${score3(b.latest)} — ${b.latestEv} · ${fmtDateY(b.latestD)}`)}">${score3(b.latest)}</td>
          <td class="num col-perfs">${b.n}</td></tr>`).join("")}
        </tbody></table></div>` : "<div class='empty'>No recap data for this caption yet — it fills in as recaps are scraped.</div>";
      if (board.length) collapseRows(document.querySelector("#capBoard tbody"), 5, "corps");

      renderSpot(board);
      renderShowCmp();

      // corps picker persists across updates so the panel stays open
      const capOptions = board.map(b => ({ value: b.corps, label: b.corps, hint: `#${b.rank}` }));
      if (!msCap) {
        msCap = multiSelect(document.getElementById("capCorpsSel"), {
          label: "Pick corps to chart…", searchable: true,
          summary: () => capIsDefault() ? "Top 12" : null,
          bulk: true, bulkAll: false,
          presets: [{ label: "Top 12", values: () => lastBoard.slice(0, 12).map(b => b.corps) }],
          options: capOptions,
          selected: capPick,
          onChange: update,
        });
        document.getElementById("capReset").onclick = () => { seedPick = true; msCap.refresh(); update(); };
      } else {
        msCap.setOptions(capOptions);
      }

      if (!stale()) history.replaceState(null, "", `#/captions?y=${year}&cap=${capKey}`);
    }

    // caption-by-caption bars for one corps: latest show vs season best
    const SPOT_CAPS = [["ge1", "GE1"], ["ge2", "GE2"], ["vp", "VP"], ["va", "VA"],
      ["cg", "CG"], ["br", "BR"], ["ma", "MA"], ["pc", "PC"]];
    let ssSpot = null;
    let ssVs = null;
    let spotBoard = [];
    function renderSpot(board) {
      if (!document.getElementById("spotCorps")) return;
      spotBoard = board;
      const opts = board.map(b => ({ value: b.corps, label: b.corps, hint: `#${b.rank}` }));
      if (!ssSpot) {
        ssSpot = singleSelect(document.getElementById("spotCorps"), {
          label: "Pick a corps…", searchable: board.length > 12, options: opts,
          value: board.length ? board[0].corps : null,
          onChange: () => renderSpot(spotBoard),
        });
      } else {
        ssSpot.setOptions(opts);
        if (!board.some(b => b.corps === ssSpot.get())) ssSpot.set(board.length ? board[0].corps : null);
      }
      const vsOpts = [{ value: "", label: "No comparison" }, ...opts];
      if (!ssVs) {
        ssVs = singleSelect(document.getElementById("spotVs"), {
          label: "Compare vs…", searchable: board.length > 12, options: vsOpts, value: "",
          onChange: () => renderSpot(spotBoard),
        });
      } else {
        ssVs.setOptions(vsOpts);
        if (ssVs.get() && !board.some(b => b.corps === ssVs.get())) ssVs.set("");
      }
      const corps = ssSpot.get();
      const chartEl = document.getElementById("spotChart");
      if (!corps) { chartEl.innerHTML = "<div class='empty'>No corps in this class yet.</div>"; return; }
      const vs = ssVs.get() && ssVs.get() !== corps ? ssVs.get() : "";

      const latestOf = name => {
        const perf = rows.filter(r => r[iCls()] === cls && r[iCorps()] === name && r[iDate()])
          .sort((a, b) => a[iDate()].localeCompare(b[iDate()]));
        return perf.length ? perf[perf.length - 1] : null;
      };
      const latest = latestOf(corps);
      if (!latest) { chartEl.innerHTML = "<div class='empty'>No verified recap for this corps yet.</div>"; return; }
      const vsLatest = vs ? latestOf(vs) : null;
      document.getElementById("spotTitle").innerHTML = vsLatest
        ? `${esc(corps)} vs ${esc(vs)} <span class="sub">latest recap of each · every caption out of 20</span>`
        : `${esc(corps)} — Caption Scores <span class="sub">${esc(latest[iEv()])} · ${esc(fmtDateY(latest[iDate()]))} · each caption out of 20</span>`;
      // per-caption rank within the class (by season best)
      const rankOf = (k, name) => {
        const ki = cols.indexOf(k);
        const bests = new Map();
        for (const r of rows) {
          if (r[iCls()] !== cls || r[ki] == null) continue;
          const cur = bests.get(r[iCorps()]);
          if (cur == null || r[ki] > cur) bests.set(r[iCorps()], r[ki]);
        }
        return [...bests.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]).indexOf(name) + 1;
      };
      const groups = SPOT_CAPS.map(([k, label]) => {
        const ki = cols.indexOf(k);
        const rA = rankOf(k, corps);
        const bars = [{ name: corps, value: latest[ki], color: corpsColor(corps) }];
        let sub = rA > 0 ? `#${rA}` : "";
        if (vsLatest) {
          const rB = rankOf(k, vs);
          bars.push({ name: vs, value: vsLatest[ki], color: corpsColor(vs) });
          sub = rA > 0 && rB > 0 ? `#${rA}·#${rB}` : sub;
        }
        return { label, sub, bars };
      });
      CCViz.barChart(chartEl, { groups, height: 280, yMax: 20, track: true, yFmt: v => v.toFixed(1) });
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

    // ---- caption titles: who took each caption at the championships ----
    // [key, column code, picker label]
    const TITLE_CAPS = [["ge", "GE", "General Effect"], ["vis", "VIS", "Visual Total"], ["vp", "VP", "Visual Proficiency"], ["va", "VA", "Visual Analysis"],
      ["cg", "CG", "Color Guard"], ["mus", "MUS", "Music Total"], ["br", "BR", "Brass"], ["ma", "MA", "Music Analysis"], ["pc", "PC", "Percussion"]];
    const titleSel = new Set(["ge", "br", "pc", "cg"]);
    let titlesMode = "years";
    let titlesData = null;
    multiSelect(document.getElementById("titlesCaps"), {
      label: "Pick captions…", bulk: true,
      options: TITLE_CAPS.map(([k, , full]) => ({ value: k, label: full })),
      selected: titleSel, onChange: renderTitles,
    });
    document.getElementById("titlesMode").onclick = () => {
      titlesMode = titlesMode === "years" ? "career" : "years";
      document.getElementById("titlesMode").textContent = titlesMode === "years" ? "Career totals" : "By year";
      renderTitles();
    };
    async function renderTitles() {
      if (!titlesData) titlesData = await data("caption_titles.json").catch(() => ({}));
      const el = document.getElementById("titlesBody");
      if (stale() || !el) return;
      const list = (titlesData[cls] || []).slice().sort((a, b) => b.y - a.y);
      const capsShown = TITLE_CAPS.filter(([k]) => titleSel.has(k));
      document.getElementById("titlesTitle").innerHTML =
        `Caption Titles <span class="sub">${esc(cls)} · best caption score at the championships, every year</span>`;
      if (!list.length || !capsShown.length) {
        el.innerHTML = `<div class='empty'>${capsShown.length ? "No championship recaps for this class yet." : "Pick at least one caption."}</div>`;
        return;
      }
      if (titlesMode === "years") {
        el.innerHTML = `<div class="tscroll"><table class="t"><thead><tr><th>Year</th>${capsShown.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead><tbody id="titleRows">
          ${list.map(e => `<tr><td style="white-space:nowrap"><a href="#/season/${e.y}"><b>${e.y}</b></a>${e.round !== "finals" ? ` <span class="kicker">${esc(e.round)}</span>` : ""}${e.partial ? ` <span class="kicker" title="recap missing: ${esc(e.partial.join(", "))}">partial</span>` : ""}</td>
            ${capsShown.map(([k]) => { const w = e.w[k]; return w ? `<td style="white-space:nowrap"><b>${esc(w[0])}</b> <span class="kicker">${(+w[1]).toFixed(2)}${w[2] ? "*" : ""}</span></td>` : "<td style='color:var(--muted)'>—</td>"; }).join("")}</tr>`).join("")}
        </tbody></table></div>`;
      } else {
        const count = new Map();
        list.forEach(e => capsShown.forEach(([k]) => {
          const w = e.w[k];
          if (!w) return;
          w[0].split(" & ").forEach(name => {
            const c = count.get(name) || { total: 0, per: {} };
            c.total++;
            c.per[k] = (c.per[k] || 0) + 1;
            count.set(name, c);
          });
        }));
        const rowsC = [...count.entries()].sort((a, b) => b[1].total - a[1].total);
        el.innerHTML = `<div class="tscroll"><table class="t"><thead><tr><th>Corps</th>${capsShown.map(([, l]) => `<th class="num">${l}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody id="titleRows">
          ${rowsC.map(([n, c]) => `<tr><td>${corpsLink(n)}</td>${capsShown.map(([k]) => `<td class="num">${c.per[k] || "—"}</td>`).join("")}<td class="num score">${c.total}</td></tr>`).join("")}
        </tbody></table></div>`;
      }
      collapseRows(document.getElementById("titleRows"), 5, titlesMode === "years" ? "seasons" : "corps");
    }

    const _loadYear = loadYear;
    loadYear = async () => { await _loadYear(); renderTitles(); }; // year switch can reset the class
    singleSelect(document.getElementById("capYear"), {
      label: "Season", options: seasons.map(y => ({ value: String(y), label: String(y) })),
      value: String(year),
      onChange: v => { year = +v; seedPick = true; loadYear(); },
    });
    singleSelect(document.getElementById("capKey"), {
      label: "Caption", options: CAPTION_DEFS.map(([k, l]) => ({ value: k, label: l })),
      value: capKey,
      onChange: v => { capKey = v; seedPick = true; update(); },
    });
    await loadYear();
  }

  /* ============ DATABASE ============ */
  const DB = { scores: null, captions: null, sort: [0, -1] };
  async function loadScores() {
    if (DB.scores) return DB.scores;
    const idx = await data("db/index.json");
    const parts = await Promise.all(idx.map(d => data(`db/perfs_${d.decade}.json`)));
    DB.scores = parts.flat();
    return DB.scores;
  }
  async function loadCaptionRows() {
    if (DB.captions) return DB.captions;
    const idx = await data("captions/index.json");
    const parts = await Promise.all(idx.seasons.map(s =>
      data(`captions/${s.year}.json`).then(rows => rows.map(r => [s.year, ...r]))));
    DB.captions = parts.flat();
    return DB.captions;
  }

  // dataset configs: column labels, key row indices, loader
  const DB_SETS = {
    scores: {
      label: "Scores",
      cols: ["Year", "Date", "Event", "Corps", "Class", "Place", "Score"],
      corpsIdx: 3, clsIdx: 4, evIdx: 2, dateIdx: 1, scoreCols: [6],
      load: loadScores,
    },
    captions: {
      label: "Caption Scores",
      cols: ["Year", "Date", "Event", "Class", "Corps",
             "GE1", "GE2", "GE", "VP", "VA", "CG", "VIS",
             "BR", "MA", "PC", "MUS", "Pen", "Total"],
      corpsIdx: 4, clsIdx: 3, evIdx: 2, dateIdx: 1, scoreCols: [17],
      load: loadCaptionRows,
    },
  };

  async function viewDatabase(_m, stale) {
    setNav("data");
    app.innerHTML = `${dataSubNav("database")}<h1 class="page">Database <span id="dbcount" class="kicker"></span></h1>
      <div class="filters" id="dbFilters">
        <div id="dbSet"></div>
        <div id="dbCorps"></div>
        <div id="dbYears"></div>
        <div id="fcls"></div>
        <input class="ctrl" id="fq" placeholder="Search event…">
        <button class="tab" id="dbReset" title="Clear all filters">Reset</button>
        <button class="tab" id="csv">Export CSV</button>
      </div>
      <div class="card"><div id="dbtable"><div class="loading">Loading…</div></div></div>`;

    let setKey = "scores";
    let cfg = DB_SETS[setKey];
    const CHUNK0 = 10;
    let shown = CHUNK0;
    let rows = [];
    let filtered = [];
    const corpsSet = new Set();
    const yearSet = new Set();
    let msDbCorps = null, msDbYears = null;
    let dbGen = 0;

    let fclsVal = "";
    let ssFcls = null;
    const ssSet = singleSelect(document.getElementById("dbSet"), {
      label: "Dataset",
      options: Object.entries(DB_SETS).map(([k, v]) => ({ value: k, label: v.label })),
      value: setKey,
      onChange: v => { setKey = v; initDataset(); },
    });

    async function initDataset() {
      const gen = ++dbGen;
      document.getElementById("dbtable").innerHTML = "<div class='loading'>Loading…</div>";
      cfg = DB_SETS[setKey];
      let got;
      try { got = await cfg.load(); }
      catch (e) {
        const el = document.getElementById("dbtable");
        if (!stale() && el && gen === dbGen) el.innerHTML = "<div class='empty'>This dataset builds with the next data run.</div>";
        return;
      }
      if (stale() || gen !== dbGen || !document.getElementById("dbtable")) return;
      rows = got;
      DB.sort = [cfg.dateIdx, -1];   // freshest shows first
      corpsSet.clear(); yearSet.clear();
      document.getElementById("fq").value = "";

      const years = [...new Set(rows.map(r => r[0]))].sort((a, b) => b - a);
      const classes = sortClasses([...new Set(rows.map(r => r[cfg.clsIdx]).filter(Boolean))]);
      const corpsNames = [...new Set(rows.map(r => r[cfg.corpsIdx]).filter(Boolean))].sort();
      const clsOpts = [{ value: "", label: "All classes" }, ...classes.map(c => ({ value: c, label: c }))];
      fclsVal = "";
      if (!ssFcls) {
        ssFcls = singleSelect(document.getElementById("fcls"), {
          label: "All classes", options: clsOpts, value: "",
          onChange: v => { fclsVal = v || ""; apply(); },
        });
      } else {
        ssFcls.setOptions(clsOpts);
        ssFcls.set("");
      }

      const corpsOpts = corpsNames.map(n => ({ value: n, label: n }));
      const yearOpts = years.map(y => ({ value: String(y), label: String(y) }));
      if (!msDbCorps) {
        msDbCorps = multiSelect(document.getElementById("dbCorps"), {
          label: "All corps", searchable: true, bulk: true, bulkAll: false,
          options: corpsOpts, selected: corpsSet, onChange: apply,
        });
        msDbYears = multiSelect(document.getElementById("dbYears"), {
          label: "All seasons", searchable: years.length > 15, bulk: true,
          presets: [{ label: "Past 5", values: () => years.slice(0, 5) }],
          options: yearOpts, selected: yearSet, onChange: apply,
        });
      } else {
        msDbCorps.setOptions(corpsOpts);
        msDbYears.setOptions(yearOpts);
        msDbCorps.refresh(); msDbYears.refresh();
      }
      apply();
    }

    function apply() {
      shown = CHUNK0;
      const q = document.getElementById("fq").value.trim().toLowerCase();
      const cls = fclsVal;
      filtered = rows.filter(r =>
        (!yearSet.size || yearSet.has(String(r[0]))) &&
        (!corpsSet.size || corpsSet.has(r[cfg.corpsIdx])) &&
        (!cls || r[cfg.clsIdx] === cls) &&
        (!q || (r[cfg.evIdx] || "").toLowerCase().includes(q)));
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

    function cellHtml(r, i) {
      if (i === 0) return `<td class="num m-hide" style="text-align:left">${r[0]}</td>`;
      if (i === cfg.dateIdx) return `<td style="color:var(--muted);white-space:nowrap">${fmtDate2(r[i])}</td>`;
      if (i === cfg.corpsIdx) return `<td>${corpsLink(r[i])}</td>`;
      if (i === cfg.clsIdx) return `<td class="m-hide"><span class="pill">${esc(r[i] || "")}</span></td>`;
      if (i === cfg.evIdx) return `<td>${esc(r[i] || "")}</td>`;
      const v = r[i];
      if (typeof v === "number") {
        const strong = cfg.scoreCols.includes(i) ? " score" : "";
        return `<td class="num${strong}">${cfg.scoreCols.includes(i) ? score3(v) : v.toFixed(v % 1 ? 2 : 0)}</td>`;
      }
      return `<td class="num">${v ?? "—"}</td>`;
    }

    function render() {
      document.getElementById("dbcount").textContent =
        `· ${filtered.length.toLocaleString()} rows`;
      const [ci, dir] = DB.sort;
      const more = filtered.length - shown;
      document.getElementById("dbtable").innerHTML =
        `<div class="tscroll dense"><table class="t"><thead><tr>${cfg.cols.map((c, i) =>
          `<th style="cursor:pointer;user-select:none" class="${i === 0 || i === cfg.clsIdx ? "m-hide" : ""}" data-c="${i}">${c}${i === ci ? (dir > 0 ? " ↑" : " ↓") : ""}</th>`).join("")}</tr></thead><tbody>
        ${filtered.slice(0, shown).map(r =>
          `<tr>${cfg.cols.map((c, i) => cellHtml(r, i)).join("")}</tr>`).join("")}</tbody></table></div>` +
        (more > 0 ? `<div class="expandwrap"><button class="tab" id="dbMore">Show ${Math.min(100, more).toLocaleString()} more ▾ <span class="kicker">(${(shown).toLocaleString()} of ${filtered.length.toLocaleString()})</span></button></div>` : "");
      const mb = document.getElementById("dbMore");
      if (mb) mb.onclick = () => { shown += 100; render(); };
      document.querySelectorAll("#dbtable th").forEach(th => th.onclick = () => {
        const c = +th.dataset.c;
        DB.sort = DB.sort[0] === c
          ? [c, -DB.sort[1]]
          : [c, c === 0 || c === cfg.dateIdx || cfg.scoreCols.includes(c) ? -1 : 1];
        apply();
      });
    }

    document.getElementById("fq").addEventListener("input", apply);
    document.getElementById("dbReset").onclick = () => {
      corpsSet.clear(); yearSet.clear();
      fclsVal = "";
      if (ssFcls) ssFcls.set("");
      document.getElementById("fq").value = "";
      if (msDbCorps) { msDbCorps.refresh(); msDbYears.refresh(); }
      apply();
    };
    document.getElementById("csv").onclick = () => {
      const lines = [cfg.cols.join(",")].concat(filtered.map(r =>
        cfg.cols.map((c, i) => {
          const v = r[i];
          return v == null ? "" : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
        }).join(",")));
      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `dci-tracker-${setKey}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    };
    await initDataset();
  }

  /* ============ RECORDS ============ */
  async function viewRecords(_m, stale) {
    setNav("data");
    const [rec, idx] = await Promise.all([data("records.json"), data("corps_index.json")]);
    if (stale()) return;
    const classes = sortClasses(Object.keys(rec));
    if (!classes.length) {
      app.innerHTML = "<div class='card'><div class='empty'>The record book builds with the next data run.</div></div>";
      return;
    }
    const savedCls = localStorage.getItem("dt-reccls");
    let cls = classes.includes(savedCls) ? savedCls : (classes.includes("World Class") ? "World Class" : classes[0]);
    let marginMode = "closest";

    app.innerHTML = `
      ${dataSubNav("records")}
      <h1 class="page">Records <span class="kicker">· the all-time book</span></h1>
      <div class="filters">
        <div id="recCls"></div>
        <div id="recEra"></div>
        <div id="recCorps"></div>
      </div>
      <div id="recBody"></div>`;

    let era = "all";
    const corpsSet = new Set();
    let msCorps = null;
    let ssEra = null;
    const ssCls = singleSelect(document.getElementById("recCls"), {
      label: "Class", options: classes.map(c => ({ value: c, label: c })), value: cls,
      onChange: v => {
        cls = v;
        localStorage.setItem("dt-reccls", cls);
        rebuildFilters();
        render();
      },
    });

    function rebuildFilters() {
      const d = rec[cls];
      const ys = [...new Set([...d.top.map(r => r[0]), ...Object.keys(d.finals).map(Number)])].sort((a, b) => a - b);
      const eraOpts = [{ value: "all", label: "All-time" }];
      if (ys.some(y => y >= 2013) && ys.some(y => y < 2013)) eraOpts.push({ value: "modern", label: "Modern era (2013–now)" });
      const decades = [...new Set(ys.map(y => Math.floor(y / 10) * 10))].sort((a, b) => b - a);
      if (decades.length > 1) decades.forEach(dd => eraOpts.push({ value: String(dd), label: `${dd}s` }));
      if (!eraOpts.some(o => o.value === era)) era = "all";
      if (!ssEra) {
        ssEra = singleSelect(document.getElementById("recEra"), {
          label: "Era", options: eraOpts, value: era,
          onChange: v => { era = v; render(); },
        });
      } else {
        ssEra.setOptions(eraOpts);
        ssEra.set(era);
      }
      const names = [...new Set([
        ...d.top.map(r => r[2]),
        ...Object.values(d.finals).flat().map(r => r[0]),
      ])].sort();
      const opts = names.map(n => ({ value: n, label: n }));
      if (!msCorps) {
        msCorps = multiSelect(document.getElementById("recCorps"), {
          label: "All corps", searchable: true, bulk: true, bulkAll: false,
          options: opts, selected: corpsSet, onChange: render,
        });
      } else {
        [...corpsSet].forEach(n => { if (!names.includes(n)) corpsSet.delete(n); });
        msCorps.setOptions(opts);
        msCorps.refresh();
      }
    }

    const inEra = y => {
      if (era === "all") return true;
      if (era === "modern") return y >= 2013;
      return Math.floor(y / 10) * 10 === +era;
    };
    const inCorps = n => !corpsSet.size || corpsSet.has(n);
    const yearLink = y => `<a href="#/season/${y}">${y}</a>`;

    function card(title, sub, body) {
      return `<div class="card"><h2>${title}${sub ? ` <span class="sub">${sub}</span>` : ""}</h2>${body}</div>`;
    }
    const emptyNote = "<div class='empty'>Nothing in this slice — widen the era or corps filter.</div>";

    function render() {
      const d = rec[cls];

      // finals per year, rows kept sorted by score
      const champBy = {};
      const champsOf = {};   // year -> every corps sharing the winning score
      Object.entries(d.finals).forEach(([y, rows]) => {
        if (!inEra(+y)) return;
        const sorted = rows.slice().sort((a, b) => (b[1] || 0) - (a[1] || 0));
        champBy[+y] = sorted;
        champsOf[+y] = sorted.filter(r => r[1] === sorted[0][1]).map(r => r[0]);
      });
      const champYears = Object.keys(champBy).map(Number).sort((a, b) => a - b);

      // 1 — highest single-show scores
      const top = d.top.filter(r => inEra(r[0]) && inCorps(r[2])).slice(0, 100);
      const topHtml = top.length ? `<div class="tscroll"><table class="t"><thead><tr><th>#</th><th>Corps</th><th class="num">Score</th><th class="m-hide">Event</th><th>Date</th></tr></thead><tbody id="recTop">
        ${top.map((r, i) => `<tr><td class="rank">${i + 1}</td><td>${corpsLink(r[2])}</td><td class="num score">${score3(r[3])}</td><td class="m-hide" style="color:var(--muted);font-size:12.5px">${esc(r[4] || "")}</td><td style="white-space:nowrap">${fmtDate2(r[1], r[0])}</td></tr>`).join("")}
      </tbody></table></div>` : emptyNote;

      // 2 — championship titles
      const titleBy = new Map();
      champYears.forEach(y => {
        champsOf[y].forEach(c => {
          if (!inCorps(c)) return;
          const t = titleBy.get(c) || { n: 0, years: [] };
          t.n++;
          t.years.push(y);
          titleBy.set(c, t);
        });
      });
      const titles = [...titleBy.entries()].sort((a, b) => b[1].n - a[1].n || b[1].years[b[1].years.length - 1] - a[1].years[a[1].years.length - 1]);
      const titlesHtml = titles.length ? `<div class="tscroll"><table class="t"><thead><tr><th>Corps</th><th class="num">Titles</th><th>Years</th></tr></thead><tbody id="recTitles">
        ${titles.map(([n, t]) => `<tr><td>${corpsLink(n)}</td><td class="num score">${t.n}</td><td class="kicker" style="max-width:260px">${t.years.join(" · ")}</td></tr>`).join("")}
      </tbody></table></div>` : emptyNote;

      // 3 — dynasties: consecutive titles over contested seasons
      const streaks = [];
      const running = new Map();   // corps -> current run
      champYears.forEach((y, yi) => {
        const prevChamps = yi > 0 ? champsOf[champYears[yi - 1]] : [];
        champsOf[y].forEach(c => {
          const run = running.get(c);
          if (run && prevChamps.includes(c)) { run.end = y; run.len++; }
          else running.set(c, { corps: c, start: y, end: y, len: 1 });
        });
        // close out runs that didn't continue this year
        [...running.entries()].forEach(([c, run]) => {
          if (!champsOf[y].includes(c) && run.end !== y) {
            if (run.len >= 2 && inCorps(c)) streaks.push(run);
            running.delete(c);
          }
        });
      });
      running.forEach((run, c) => { if (run.len >= 2 && inCorps(c)) streaks.push(run); });
      streaks.sort((a, b) => b.len - a.len || b.end - a.end);
      const streaksHtml = streaks.length ? `<div class="tscroll"><table class="t"><thead><tr><th>Corps</th><th class="num">In a row</th><th>Span</th></tr></thead><tbody id="recStreaks">
        ${streaks.map(t => `<tr><td>${corpsLink(t.corps)}</td><td class="num score">${t.len}</td><td class="kicker">${t.start}–${t.end}</td></tr>`).join("")}
      </tbody></table></div>` : "<div class='empty'>No back-to-back champions in this slice.</div>";

      // 4 — finals margins
      const margins = [];
      champYears.forEach(y => {
        const rows = champBy[y];
        if (rows.length < 2 || rows[0][1] == null || rows[1][1] == null) return;
        if (corpsSet.size && !inCorps(rows[0][0]) && !inCorps(rows[1][0])) return;
        margins.push({ y, c1: rows[0][0], s1: rows[0][1], c2: rows[1][0], s2: rows[1][1], m: +(rows[0][1] - rows[1][1]).toFixed(3) });
      });
      margins.sort((a, b) => marginMode === "closest" ? a.m - b.m : b.m - a.m);
      const marginsHtml = margins.length ? `<div class="tscroll"><table class="t"><thead><tr><th>Year</th><th>Champion</th><th class="num">Score</th><th>Runner-up</th><th class="num m-hide">Score</th><th class="num">Margin</th></tr></thead><tbody id="recMargins">
        ${margins.map(g => `<tr><td>${yearLink(g.y)}</td><td><b>${esc(g.c1)}</b></td><td class="num score">${score3(g.s1)}</td><td>${esc(g.c2)}</td><td class="num m-hide">${score3(g.s2)}</td><td class="num" style="font-weight:650">${g.m.toFixed(3)}</td></tr>`).join("")}
      </tbody></table></div>` : emptyNote;

      // 5 — biggest one-season leaps (best score, year over year)
      const leaps = [];
      for (const c of idx) {
        if (!inCorps(c.name)) continue;
        const series = (c.series || []).slice().sort((a, b) => a[0] - b[0]);
        for (let i = 1; i < series.length; i++) {
          const [y1, b1, k1] = series[i - 1], [y2, b2, k2] = series[i];
          if (y2 !== y1 + 1 || k2 !== cls || k1 !== cls || b1 == null || b2 == null || !inEra(y2)) continue;
          const dlt = +(b2 - b1).toFixed(3);
          if (dlt > 0) leaps.push({ corps: c.name, y1, y2, b1, b2, d: dlt });
        }
      }
      leaps.sort((a, b) => b.d - a.d);
      const leapsHtml = leaps.length ? `<div class="tscroll"><table class="t"><thead><tr><th>Corps</th><th>Seasons</th><th class="num m-hide">From</th><th class="num m-hide">To</th><th class="num">Jump</th></tr></thead><tbody id="recLeaps">
        ${leaps.slice(0, 50).map(l => `<tr><td>${corpsLink(l.corps)}</td><td class="kicker">${l.y1} → ${l.y2}</td><td class="num m-hide">${score3(l.b1)}</td><td class="num m-hide">${score3(l.b2)}</td><td class="num score">+${l.d.toFixed(3)}</td></tr>`).join("")}
      </tbody></table></div>` : emptyNote;

      // 6 — most championship-finals appearances
      const appBy = new Map();
      champYears.forEach(y => {
        champBy[y].forEach(([c]) => {
          if (!inCorps(c)) return;
          const a = appBy.get(c) || { n: 0, first: y, last: y };
          a.n++;
          a.first = Math.min(a.first, y);
          a.last = Math.max(a.last, y);
          appBy.set(c, a);
        });
      });
      const apps = [...appBy.entries()].sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last);
      const appsHtml = apps.length ? `<div class="tscroll"><table class="t"><thead><tr><th>Corps</th><th class="num">Finals</th><th>First – Last</th></tr></thead><tbody id="recApps">
        ${apps.map(([n, a]) => `<tr><td>${corpsLink(n)}</td><td class="num score">${a.n}</td><td class="kicker">${a.first}–${a.last}</td></tr>`).join("")}
      </tbody></table></div>` : emptyNote;

      const finalsSpan = champYears.length ? `${champYears[0]}–${champYears[champYears.length - 1]}` : "";
      document.getElementById("recBody").innerHTML = `
        ${card("Highest Scores Ever", "the best single performances on record", topHtml)}
        <div class="grid cols-2" style="margin-top:14px">
          ${card("Championship Titles", finalsSpan, titlesHtml)}
          ${card("Dynasties", "back-to-back champions", streaksHtml)}
        </div>
        <div class="card" style="margin-top:14px">
          <h2>Finals Margins <span class="sub">champion vs runner-up on the last night</span></h2>
          <div class="filters" style="margin:2px 0 8px">
            <button class="tab${marginMode === "closest" ? " on" : ""}" data-mm="closest">Closest ever</button>
            <button class="tab${marginMode === "biggest" ? " on" : ""}" data-mm="biggest">Biggest blowouts</button>
          </div>
          ${marginsHtml}
        </div>
        <div class="grid cols-2" style="margin-top:14px">
          ${card("Biggest One-Season Leaps", "season best vs the year before", leapsHtml)}
          ${card("Most Finals Made", "championship-finals appearances", appsHtml)}
        </div>`;

      ["recTop", "recTitles", "recStreaks", "recMargins", "recLeaps", "recApps"].forEach(id => {
        const el = document.getElementById(id);
        if (el) collapseRows(el, 5, "rows");
      });
      document.querySelectorAll("[data-mm]").forEach(bt => bt.onclick = () => {
        marginMode = bt.dataset.mm;
        render();
      });
    }

    rebuildFilters();
    render();
  }

  /* ============ SUGGESTIONS ============ */
  const SUGGEST_REPO = "LukeBesel/DCI-Tracker";
  async function viewSuggestions(_m, stale) {
    setNav("");
    app.innerHTML = `
      <h1 class="page">Suggestions <span class="kicker">· help decide what gets built</span></h1>
      <div class="card" style="margin-bottom:14px">
        <h2>Have an Idea?</h2>
        <p style="margin:0 0 12px;color:var(--text-secondary)">Missing a stat? Want a new view? Post it below — suggestions are public, and the most-wanted ideas get built first. A free GitHub account is all it takes.</p>
        <a class="tab on" style="display:inline-block;text-decoration:none" href="https://github.com/${SUGGEST_REPO}/issues/new?template=suggestion.yml" target="_blank" rel="noopener">Post a suggestion →</a>
      </div>
      <div class="card"><h2>What People Are Asking For</h2><div id="sugList"><div class="loading">Loading…</div></div></div>
      <p style="color:var(--muted);font-size:12.5px;margin:14px 2px 0">Created by Lucas Besel · suggestions live on <a href="https://github.com/${SUGGEST_REPO}/issues" target="_blank" rel="noopener">GitHub</a></p>`;
    let items = [];
    try {
      const res = await fetch(`https://api.github.com/repos/${SUGGEST_REPO}/issues?labels=suggestion&state=open&sort=reactions-+1&per_page=50`);
      if (!res.ok) throw new Error(res.status);
      items = await res.json();
    } catch (e) {
      const el = document.getElementById("sugList");
      if (!stale() && el) el.innerHTML = `<div class="empty">Couldn't load suggestions right now.<br><a class="tab" style="display:inline-block;margin-top:12px" href="https://github.com/${SUGGEST_REPO}/issues" target="_blank" rel="noopener">View them on GitHub →</a></div>`;
      return;
    }
    const el = document.getElementById("sugList");
    if (stale() || !el) return;
    if (!items.length) {
      el.innerHTML = "<div class='empty'>No suggestions yet — be the first!</div>";
      return;
    }
    el.innerHTML = items.map(it => h`
      <div style="padding:12px 2px;border-bottom:1px solid var(--grid)">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline">
          <b>${esc(it.title)}</b>
          <span class="kicker" style="white-space:nowrap">👍 ${(it.reactions && it.reactions["+1"]) || 0}</span>
        </div>
        ${it.body ? h`<div style="color:var(--text-secondary);font-size:13.5px;margin-top:4px">${esc(String(it.body).slice(0, 220))}${String(it.body).length > 220 ? "…" : ""}</div>` : ""}
        <div class="kicker" style="margin-top:6px">${esc(it.user ? it.user.login : "")} · ${esc(fmtDateY(String(it.created_at || "").slice(0, 10)))} · <a href="${encodeURI(it.html_url)}" target="_blank" rel="noopener">discuss ↗</a></div>
      </div>`).join("");
  }

  /* ============ router ============ */
  const routes = [
    [/^#?\/?$/, viewRankings],
    [/^#\/compare(?:\?(.*))?$/, (m, st) => viewCorpsHub(m[1], st)],
    [/^#\/corps\?(.*)$/, m => { location.replace(`#/compare?${m[1]}`); }],
    [/^#\/corps$/, (m, st) => viewCorpsPage(null, st)],
    [/^#\/corps\/([a-z0-9-]+)$/, (m, st) => viewCorpsPage(m[1], st)],
    [/^#\/events(?:\?(.*))?$/, (m, st) => viewEvents(m[1], st)],
    [/^#\/(?:seasons|champions)$/, viewSeasons],
    [/^#\/data$/, () => { location.replace("#/compare"); }],
    [/^#\/season\/(\d{4})$/, m => { location.replace(`#/events?y=${m[1]}`); }],
    [/^#\/event\/(\d{4})\/(\d+)$/, (m, st) => viewEvent(m[1], m[2], st)],
    [/^#\/captions(?:\?(.*))?$/, (m, st) => viewCaptions(m[1], st)],
    [/^#\/records$/, viewRecords],
    [/^#\/suggestions$/, viewSuggestions],
    [/^#\/database$/, viewDatabase],
    // legacy routes from earlier versions
    [/^#\/(today|rankings)$/, viewRankings],
    [/^#\/season\/dci\/(\d{4})$/, m => { location.replace(`#/events?y=${m[1]}`); }],
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
                 <h2 style="margin:0 0 8px">First Data Build in Progress</h2>
                 <p style="color:var(--text-secondary);max-width:52ch;margin:0 auto">Scores are being pulled from DCI.org right now. This page fills in automatically when it finishes.</p>
               </div>`
            : `<div class="card"><div class="empty">Couldn't load this view (${CCViz.esc(e.message)}). Data may be mid-update — try again in a minute.</div></div>`;
        }
        return;
      }
    }
    app.innerHTML = "<div class='empty'>Page not found.</div>";
  }
  // info bubbles: hover (mouse) or tap (touch) any [data-tip] element
  (() => {
    const tip = document.getElementById("tooltip");
    let cur = null;
    function show(el) {
      cur = el;
      tip.innerHTML = el.dataset.tip;
      tip.hidden = false;
      const r = el.getBoundingClientRect();
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = r.left + r.width / 2 - tw / 2 + scrollX;
      x = Math.max(8, Math.min(x, scrollX + innerWidth - tw - 8));
      let y = r.top + scrollY - th - 10;
      if (y < scrollY + 4) y = r.bottom + scrollY + 10;
      tip.style.left = x + "px";
      tip.style.top = y + "px";
    }
    const hide = () => { if (cur) { tip.hidden = true; cur = null; } };
    document.addEventListener("pointerover", e => {
      if (e.pointerType !== "mouse") return;
      const el = e.target.closest("[data-tip]");
      if (el) show(el);
      else if (cur) hide();
    });
    document.addEventListener("click", e => {
      const el = e.target.closest("[data-tip]");
      if (el && e.target.closest("a")) return;      // links still navigate
      if (el) { (cur === el && !tip.hidden) ? hide() : show(el); }
      else hide();
    });
    addEventListener("scroll", hide, { passive: true });
  })();

  // live scores: on show nights the pipeline lands new data every half hour —
  // poll the stamp while the tab is open and offer a one-tap refresh
  (() => {
    let stamp = null;
    let toast = null;
    function offer(newStamp) {
      if (toast) return;
      toast = document.createElement("button");
      toast.id = "liveToast";
      toast.innerHTML = "🥁 New scores just landed — <b>tap to refresh</b>";
      toast.onclick = () => {
        cache.clear();
        toast.remove();
        toast = null;
        stamp = newStamp;
        const upd = document.getElementById("updated");
        if (upd) upd.textContent = "Updated " + newStamp;
        route();
      };
      document.body.appendChild(toast);
    }
    function applyNow(newStamp) {
      cache.clear();
      stamp = newStamp;
      const upd = document.getElementById("updated");
      if (upd) upd.textContent = "Updated " + newStamp;
      if (toast) { toast.remove(); toast = null; }
      route();
      // a quiet flash so the swap doesn't go unnoticed
      const flash = document.createElement("div");
      flash.id = "liveToast";
      flash.style.pointerEvents = "none";
      flash.innerHTML = "✓ <b>Scores updated</b>";
      document.body.appendChild(flash);
      setTimeout(() => flash.remove(), 2500);
    }
    async function check(auto) {
      if (document.hidden) return;
      try {
        const r = await fetch("data/meta.json", { cache: "no-cache" });
        if (!r.ok) return;
        const m = await r.json();
        if (stamp && m.updated !== stamp) {
          // returning to the app: swap in fresh scores immediately;
          // mid-read: offer a tap so the page isn't yanked away
          if (auto) applyNow(m.updated);
          else offer(m.updated);
        } else stamp = m.updated;
      } catch (e) { /* offline — try again next tick */ }
    }
    setInterval(() => check(false), 3 * 60 * 1000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) check(true); });
    check(false);
  })();

  window.CadRedraw = route; // theme toggle re-renders the current view
  addEventListener("hashchange", route);

  data("meta.json").then(m => {
    document.getElementById("updated").textContent = "Updated " + m.updated.replace(" UTC", " UTC");
    route();
  }).catch(() => {
    firstBuildPending = true;
    document.getElementById("updated").textContent = "awaiting first data build";
    route();
  });
})();
