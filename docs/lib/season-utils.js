/* Cadence season utilities — pure, unit-tested logic shared by the views.
   No DOM, no fetching, no Date.now() of its own (callers pass "now"), so
   tests/unit/season-utils.test.js can run this file in Node as-is. */
(function () {
  "use strict";

  /* Some corps compete in more than one class in a season (e.g. Open Class
     corps running World Class prelims at Championships). A single class's
     block then shows them with a one-point trend, no vs-prev delta, and a
     misleading season high. Stitching merges every class's history for each
     corps so delta / 3-show average / high / sparkline describe the ACTUAL
     season, while the row itself (score, date, event, rank) stays true to
     the class being shown. */
  function stitchSeasonHistory(standings, rows) {
    var hist = new Map(), best = new Map();
    Object.values(standings || {}).forEach(function (block) {
      (block.rows || []).forEach(function (r) {
        var h = hist.get(r.corps) || [];
        (r.trend || []).forEach(function (t) { h.push(t); });
        hist.set(r.corps, h);
        var b = best.get(r.corps);
        if (r.high != null && (!b || r.high > b.high))
          best.set(r.corps, { high: r.high, high_event: r.high_event, high_date: r.high_date });
      });
    });
    return rows.map(function (r) {
      var all = hist.get(r.corps);
      if (!all || !all.length) return r;
      // one point per date; this row's own show wins its date
      var byDate = new Map();
      all.forEach(function (t) {
        var cur = byDate.get(t[0]);
        if (cur == null || t[1] > cur) byDate.set(t[0], t[1]);
      });
      if (r.date) byDate.set(r.date, r.score);
      var trend = Array.from(byDate.entries()).sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); });
      if (trend.length <= (r.trend || []).length) return r; // nothing new to add
      var i = trend.findIndex(function (t) { return t[0] === r.date; });
      var prev = i > 0 ? trend[i - 1][1] : null;
      var b = best.get(r.corps) || {};
      return Object.assign({}, r, {
        trend: trend,
        prev_score: prev != null ? prev : r.prev_score,
        delta: prev != null ? +(r.score - prev).toFixed(3) : r.delta,
        high: b.high != null ? b.high : r.high,
        high_event: b.high != null ? b.high_event : r.high_event,
        high_date: b.high != null ? b.high_date : r.high_date,
      });
    });
  }

  /* Prediction grading: exact spot = 3 pts, off by one = 1 pt. Graded only
     over the corps the fan actually called that competed, so a partial pick
     isn't crushed by the full-field size and a scratched corps just doesn't
     count. */
  function scorePred(predOrder, actual) {
    var pos = new Map(actual.map(function (c, i) { return [c, i]; }));
    var pts = 0, exact = 0, graded = 0;
    predOrder.forEach(function (corps, i) {
      var ap = pos.get(corps);
      if (ap == null) return;
      graded++;
      var d = Math.abs(ap - i);
      if (d === 0) { pts += 3; exact++; } else if (d === 1) pts += 1;
    });
    var max = graded * 3;
    return { pts: pts, max: max, exact: exact, n: graded, pct: max ? Math.round(pts / max * 100) : 0 };
  }

  /* Days since the newest posted score across every class (Infinity if none).
     The tour never goes more than a few days dark mid-season, so >7 quiet
     days = the season is over — this drives the "final standings" framing
     and the off-season home module. */
  function daysSinceLastScore(rk, now) {
    var newest = "";
    Object.values((rk && rk.standings) || {}).forEach(function (b) {
      (b.rows || []).forEach(function (r) { if ((r.date || "") > newest) newest = r.date; });
    });
    if (!newest) return Infinity;
    var p = newest.split("-").map(Number);
    return (now - Date.UTC(p[0], p[1] - 1, p[2], 12)) / 86400000;
  }

  window.CadSeasonUtils = { stitchSeasonHistory: stitchSeasonHistory, scorePred: scorePred, daysSinceLastScore: daysSinceLastScore };
})();
