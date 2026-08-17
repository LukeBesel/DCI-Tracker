// Season utilities: cross-class stitching, prediction grading, quiet-season
// detection — the logic behind several hard-won bug fixes.
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadLib } = require("./lib-loader");

const { CadSeasonUtils } = loadLib("season-utils.js");
const { stitchSeasonHistory, scorePred, daysSinceLastScore } = CadSeasonUtils;

// ---- stitching --------------------------------------------------------------

function standingsFixture() {
  // River City ran Open Class all season, then World Class prelims once —
  // the exact shape that used to produce "—" deltas and one-point trends.
  return {
    "World Class": { rows: [
      { corps: "River City", class: "World Class", score: 80.0, date: "2026-08-07",
        event: "Prelims", trend: [["2026-08-07", 80.0]], high: 80.0, high_event: "Prelims", high_date: "2026-08-07", delta: null, rank: 22 },
      { corps: "Blue Alpha", class: "World Class", score: 95.0, date: "2026-08-07",
        event: "Prelims", trend: [["2026-08-01", 93.0], ["2026-08-07", 95.0]], high: 95.0, delta: 2.0, rank: 1 },
    ] },
    "Open Class": { rows: [
      { corps: "River City", class: "Open Class", score: 79.0, date: "2026-08-05",
        event: "Open Finals", trend: [["2026-07-20", 74.0], ["2026-08-05", 79.0]], high: 79.0, high_event: "Open Finals", high_date: "2026-08-05", delta: 5.0, rank: 2 },
    ] },
  };
}

test("stitching gives a cross-class corps its real season trend, delta, and high", () => {
  const st = standingsFixture();
  const out = stitchSeasonHistory(st, st["World Class"].rows);
  const rc = out.find(r => r.corps === "River City");
  assert.equal(rc.trend.length, 3);                       // 7/20, 8/5, 8/7
  assert.equal(rc.prev_score, 79.0);                      // Open Finals
  assert.equal(rc.delta, +(80.0 - 79.0).toFixed(3));      // vs-prev now real
  assert.equal(rc.high, 80.0);                            // prelims run beat the Open high
  // the row itself still describes the class being shown
  assert.equal(rc.score, 80.0);
  assert.equal(rc.event, "Prelims");
});

test("a single-class corps' row passes through unchanged", () => {
  const st = standingsFixture();
  const out = stitchSeasonHistory(st, st["World Class"].rows);
  const ba = out.find(r => r.corps === "Blue Alpha");
  assert.deepEqual(ba, st["World Class"].rows.find(r => r.corps === "Blue Alpha"));
});

test("one point per date — the shown row's own show wins its date", () => {
  const st = {
    A: { rows: [{ corps: "X", score: 70, date: "2026-07-01", trend: [["2026-07-01", 70]] }] },
    B: { rows: [{ corps: "X", score: 72, date: "2026-07-01", trend: [["2026-07-01", 72], ["2026-07-03", 74]] }] },
  };
  const out = stitchSeasonHistory(st, st.A.rows);
  const x = out[0];
  assert.equal(x.trend.length, 2);
  assert.equal(x.trend[0][1], 70);   // the row being shown wins 07-01, not the higher 72
});

test("stitching never duplicates a corps or invents rows", () => {
  const st = standingsFixture();
  const out = stitchSeasonHistory(st, st["World Class"].rows);
  assert.equal(out.length, st["World Class"].rows.length);
  assert.equal(new Set(out.map(r => r.corps)).size, out.length);
});

// ---- prediction grading -----------------------------------------------------

test("grading: exact = 3, off-by-one = 1, further = 0", () => {
  const actual = ["A", "B", "C", "D"];
  assert.deepEqual({ ...scorePred(["A", "B", "C", "D"], actual) }, { pts: 12, max: 12, exact: 4, n: 4, pct: 100 });
  const swapped = scorePred(["B", "A", "C", "D"], actual);
  assert.equal(swapped.pts, 1 + 1 + 3 + 3);
  assert.equal(swapped.exact, 2);
  const reversed = scorePred(["D", "C", "B", "A"], actual);
  assert.equal(reversed.exact, 0);
  assert.equal(reversed.pts, 0 + 1 + 1 + 0); // C and B are each off by one
});

test("grading: scratched corps don't count; empty pick grades 0/0", () => {
  const r = scorePred(["A", "Ghost Corps", "B"], ["A", "B"]);
  assert.equal(r.n, 2);              // Ghost Corps ignored
  assert.equal(r.max, 6);
  // A exact (3); B picked 3rd but finished 2nd → my index 2 vs actual 1 = off by one (1)
  assert.equal(r.pts, 4);
  assert.deepEqual({ ...scorePred([], ["A", "B"]) }, { pts: 0, max: 0, exact: 0, n: 0, pct: 0 });
});

// ---- quiet-season detection -------------------------------------------------

const NOON = (iso) => Date.UTC(...iso.split("-").map(Number).map((v, i) => i === 1 ? v - 1 : v), 12);

test("daysSinceLastScore counts from the newest score across every class", () => {
  const rk = { standings: {
    "World Class": { rows: [{ corps: "A", date: "2026-08-01" }] },
    "Open Class": { rows: [{ corps: "B", date: "2026-08-08" }] },
  } };
  assert.equal(daysSinceLastScore(rk, NOON("2026-08-08")), 0);
  assert.equal(daysSinceLastScore(rk, NOON("2026-08-15")), 7);
  assert.equal(daysSinceLastScore(rk, NOON("2026-08-16")), 8);   // > 7 → off-season framing
});

test("no scores at all reads as forever-quiet", () => {
  assert.equal(daysSinceLastScore({ standings: {} }, Date.UTC(2026, 0, 1)), Infinity);
  assert.equal(daysSinceLastScore({}, Date.UTC(2026, 0, 1)), Infinity);
});
