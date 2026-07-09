/* Corps Central chart helpers — hand-rolled SVG per house dataviz spec:
   2px lines, >=8px end markers with 2px surface rings, hairline solid grid,
   crosshair + single tooltip listing every series, legend always for >=2 series. */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const PALETTE = ["#3987e5", "#199e70", "#c98500", "#008300", "#9085e9", "#e66767", "#d55181", "#d95926"];

  function el(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    const step0 = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    let step = mag;
    for (const m of [1, 2, 2.5, 5, 10]) if (step0 <= m * mag) { step = m * mag; break; }
    const lo = Math.floor(min / step) * step;
    const ticks = [];
    for (let v = lo; v <= max + 1e-9; v += step) if (v >= min - 1e-9) ticks.push(+v.toFixed(6));
    return ticks;
  }

  const tooltip = () => document.getElementById("tooltip");

  function showTip(html, x, y) {
    const t = tooltip();
    t.innerHTML = html;
    t.hidden = false;
    const r = t.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > innerHeight - 8) top = y - r.height - 14;
    t.style.left = Math.max(6, left) + "px";
    t.style.top = Math.max(6, top) + "px";
  }
  function hideTip() { tooltip().hidden = true; }

  function esc(s) {
    const d = document.createElement("span");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  /* Multi-series line chart.
     opts: {series:[{name, points:[{x, y}]}], xLabels:[], yFmt, height}
     Two x modes:
       - label mode (default): x is an index into xLabels
       - linear mode (opts.linearX): x is a numeric value (e.g. a year); gaps
         between values are honored so time reads truthfully. */
  function lineChart(container, opts) {
    if (opts.linearX) return lineChartLinear(container, opts);
    return lineChartLabels(container, opts);
  }

  function lineChartLabels(container, opts) {
    container.innerHTML = "";
    const W = 860, H = opts.height || 320;
    const m = { top: 14, right: 24, bottom: 26, left: 46 };
    const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
    const series = opts.series.map((s, i) => ({ ...s, color: s.color || PALETTE[i % 8] }));
    const nX = opts.xLabels.length;
    const allY = series.flatMap(s => s.points.map(p => p.y)).filter(v => v != null);
    if (!allY.length || nX < 1) { container.innerHTML = '<div class="empty">No data yet.</div>'; return; }
    let yMin = Math.min(...allY), yMax = Math.max(...allY);
    const pad = (yMax - yMin) * 0.08 || 1;
    yMin -= pad; yMax += pad;
    const X = i => m.left + (nX === 1 ? iw / 2 : (i / (nX - 1)) * iw);
    const Y = v => m.top + ih - ((v - yMin) / (yMax - yMin)) * ih;
    const fmt = opts.yFmt || (v => v.toFixed(1));

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" }, container);
    // grid + y ticks
    for (const tv of niceTicks(yMin, yMax, 5)) {
      if (tv < yMin || tv > yMax) continue;
      el("line", { x1: m.left, x2: W - m.right, y1: Y(tv), y2: Y(tv), stroke: "#2c2c2a", "stroke-width": 1 }, svg);
      const t = el("text", { x: m.left - 8, y: Y(tv) + 4, "text-anchor": "end", fill: "#898781", "font-size": 11 }, svg);
      t.textContent = fmt(tv);
    }
    el("line", { x1: m.left, x2: W - m.right, y1: m.top + ih, y2: m.top + ih, stroke: "#383835", "stroke-width": 1 }, svg);
    // x labels (thin out)
    const every = Math.ceil(nX / Math.floor(iw / 70));
    opts.xLabels.forEach((lb, i) => {
      if (i % every !== 0 && i !== nX - 1) return;
      const t = el("text", { x: X(i), y: H - 8, "text-anchor": "middle", fill: "#898781", "font-size": 11 }, svg);
      t.textContent = lb;
    });

    for (const s of series) {
      const pts = s.points.filter(p => p.y != null);
      if (!pts.length) continue;
      const d = pts.map((p, j) => (j ? "L" : "M") + X(p.x).toFixed(1) + " " + Y(p.y).toFixed(1)).join(" ");
      el("path", { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
      const last = pts[pts.length - 1];
      el("circle", { cx: X(last.x), cy: Y(last.y), r: 4, fill: s.color, stroke: "#1a1a19", "stroke-width": 2 }, svg);
    }
    // selective direct labels: first series endpoint value
    if (series.length <= 4) {
      series.forEach(s => {
        const pts = s.points.filter(p => p.y != null);
        if (!pts.length) return;
        const last = pts[pts.length - 1];
        const t = el("text", { x: Math.min(X(last.x) + 8, W - 2), y: Y(last.y) + 4, fill: "#c3c2b7", "font-size": 11 }, svg);
        t.textContent = fmt(last.y);
      });
    }

    // crosshair + tooltip
    const cross = el("line", { y1: m.top, y2: m.top + ih, stroke: "#52514e", "stroke-width": 1, opacity: 0 }, svg);
    const hover = el("rect", { x: m.left, y: m.top, width: iw, height: ih, fill: "transparent" }, svg);
    function toIdx(evt) {
      const r = svg.getBoundingClientRect();
      const px = (evt.clientX - r.left) / r.width * W;
      return Math.max(0, Math.min(nX - 1, Math.round((px - m.left) / (iw || 1) * (nX - 1))));
    }
    hover.addEventListener("pointermove", evt => {
      const i = toIdx(evt);
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i));
      cross.setAttribute("opacity", 1);
      const rows = series.map(s => {
        const p = s.points.find(q => q.x === i);
        return p && p.y != null
          ? `<div class="tt-row"><span class="tt-key" style="background:${s.color}"></span><span class="tt-val">${esc(fmt(p.y))}</span> <span class="tt-name">${esc(s.name)}</span></div>`
          : "";
      }).join("");
      showTip(`<div class="tt-title">${esc(opts.xLabels[i])}</div>${rows}`, evt.clientX, evt.clientY);
    });
    hover.addEventListener("pointerleave", () => { cross.setAttribute("opacity", 0); hideTip(); });

    if (series.length >= 2) {
      const lg = document.createElement("div");
      lg.className = "legend";
      series.forEach(s => {
        const k = document.createElement("span");
        k.className = "key";
        const sw = document.createElement("span");
        sw.className = "swatch-line";
        sw.style.background = s.color;
        k.appendChild(sw);
        k.appendChild(document.createTextNode(s.name));
        lg.appendChild(k);
      });
      container.appendChild(lg);
    }
  }

  /* Linear-x variant: x values are real numbers (years). */
  function lineChartLinear(container, opts) {
    container.innerHTML = "";
    const W = 860, H = opts.height || 320;
    const m = { top: 14, right: 30, bottom: 26, left: 46 };
    const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
    const series = opts.series.map((s, i) => ({ ...s, color: s.color || PALETTE[i % 8] }));
    const allPts = series.flatMap(s => s.points.filter(p => p.y != null));
    if (!allPts.length) { container.innerHTML = '<div class="empty">No data yet.</div>'; return; }
    let xMin = Math.min(...allPts.map(p => p.x)), xMax = Math.max(...allPts.map(p => p.x));
    if (xMin === xMax) { xMin -= 1; xMax += 1; }
    let yMin = Math.min(...allPts.map(p => p.y)), yMax = Math.max(...allPts.map(p => p.y));
    const pad = (yMax - yMin) * 0.08 || 1;
    yMin -= pad; yMax += pad;
    const X = v => m.left + (v - xMin) / (xMax - xMin) * iw;
    const Y = v => m.top + ih - (v - yMin) / (yMax - yMin) * ih;
    const yFmt = opts.yFmt || (v => v.toFixed(1));
    const xFmt = opts.xFmt || (v => String(Math.round(v)));

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" }, container);
    for (const tv of niceTicks(yMin, yMax, 5)) {
      if (tv < yMin || tv > yMax) continue;
      el("line", { x1: m.left, x2: W - m.right, y1: Y(tv), y2: Y(tv), stroke: "#2c2c2a", "stroke-width": 1 }, svg);
      const t = el("text", { x: m.left - 8, y: Y(tv) + 4, "text-anchor": "end", fill: "#898781", "font-size": 11 }, svg);
      t.textContent = yFmt(tv);
    }
    el("line", { x1: m.left, x2: W - m.right, y1: m.top + ih, y2: m.top + ih, stroke: "#383835", "stroke-width": 1 }, svg);
    for (const tx of niceTicks(xMin, xMax, Math.min(10, Math.floor(iw / 80)))) {
      if (tx < xMin || tx > xMax) continue;
      const t = el("text", { x: X(tx), y: H - 8, "text-anchor": "middle", fill: "#898781", "font-size": 11 }, svg);
      t.textContent = xFmt(tx);
    }
    for (const s of series) {
      const pts = s.points.filter(p => p.y != null).sort((a, b) => a.x - b.x);
      if (!pts.length) continue;
      const d = pts.map((p, j) => (j ? "L" : "M") + X(p.x).toFixed(1) + " " + Y(p.y).toFixed(1)).join(" ");
      el("path", { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
      const last = pts[pts.length - 1];
      el("circle", { cx: X(last.x), cy: Y(last.y), r: 4, fill: s.color, stroke: "#1a1a19", "stroke-width": 2 }, svg);
    }
    // hover: snap to nearest x present in any series
    const xsSet = [...new Set(allPts.map(p => p.x))].sort((a, b) => a - b);
    const cross = el("line", { y1: m.top, y2: m.top + ih, stroke: "#52514e", "stroke-width": 1, opacity: 0 }, svg);
    const hover = el("rect", { x: m.left, y: m.top, width: iw, height: ih, fill: "transparent" }, svg);
    hover.addEventListener("pointermove", evt => {
      const r = svg.getBoundingClientRect();
      const vx = xMin + ((evt.clientX - r.left) / r.width * W - m.left) / iw * (xMax - xMin);
      let best = xsSet[0];
      for (const c of xsSet) if (Math.abs(c - vx) < Math.abs(best - vx)) best = c;
      cross.setAttribute("x1", X(best)); cross.setAttribute("x2", X(best));
      cross.setAttribute("opacity", 1);
      const rows = series.map(s => {
        const p = s.points.find(q => q.x === best && q.y != null);
        return p ? `<div class="tt-row"><span class="tt-key" style="background:${s.color}"></span><span class="tt-val">${esc(yFmt(p.y))}</span> <span class="tt-name">${esc(s.name)}</span></div>` : "";
      }).join("");
      showTip(`<div class="tt-title">${esc(xFmt(best))}</div>${rows}`, evt.clientX, evt.clientY);
    });
    hover.addEventListener("pointerleave", () => { cross.setAttribute("opacity", 0); hideTip(); });

    if (series.length >= 2) {
      const lg = document.createElement("div");
      lg.className = "legend";
      series.forEach(s => {
        const k = document.createElement("span");
        k.className = "key";
        const sw = document.createElement("span");
        sw.className = "swatch-line";
        sw.style.background = s.color;
        k.appendChild(sw);
        k.appendChild(document.createTextNode(s.name));
        lg.appendChild(k);
      });
      container.appendChild(lg);
    }
  }

  /* tiny sparkline into an inline svg */
  function sparkline(container, values, color) {
    container.innerHTML = "";
    const W = 92, H = 26, p = 3;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "spark" }, container);
    const vs = values.filter(v => v != null);
    if (vs.length < 2) return;
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (hi - lo < 0.5) { const mid = (hi + lo) / 2; lo = mid - 0.5; hi = mid + 0.5; }
    const X = i => p + i / (values.length - 1) * (W - 2 * p);
    const Y = v => H - p - (v - lo) / (hi - lo) * (H - 2 * p);
    const d = values.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join(" ");
    el("path", { d, fill: "none", stroke: color || "#52514e", "stroke-width": 1.5, "stroke-linecap": "round" }, svg);
    const last = values.length - 1;
    el("circle", { cx: X(last), cy: Y(values[last]), r: 2.5, fill: color || "#c3c2b7" }, svg);
  }

  window.CCViz = { lineChart, sparkline, PALETTE, esc, showTip, hideTip };
})();
