#!/usr/bin/env python3
"""Judge-level caption sheets for WGI, from the CompetitionSuite recaps.

Every WGI show the API lists carries a recaps.competitionsuite.com URL —
the same host and the same HTML framework as DCI's recaps — so the row and
cell regexes are shared with scrape_compsuite. The HEADER is different, and
so are three details that would silently corrupt the data if the DCI parser
were pointed at it unchanged:

  1. Header shape. DCI has four header rows: group / sub-caption / judge /
     leaf column. WGI has a class title, then caption / judge / leaf. The DCI
     reader therefore took the class name for a caption group. Here the
     caption row is read as the caption and the judge row is the spine: each
     judge owns the next `colspan` leaf columns, a blank one-column judge is
     the combined total of a doubled panel, and the Timing & Penalties judge
     owns the penalty column.

  2. Total. parse_recap takes the largest number in a row as its total.
     When a unit carries a penalty the largest number is the sub-total BEFORE
     the penalty (Edwardsville HS, KC 2026: 73.865 sub-total, 73.765 final).
     Here the total is read from its own column.

  3. Encoding. Raw judge sub-scores are stored x10 ("75" = 7.5), but the
     penalty sits in a cell of the same "verified" role as a true value ("0.1"
     = 0.1, not 0.01). Scaling is therefore by COLUMN, not by cell role or by
     decimal count.

Every row has to survive three independent checks before it is kept:
     sum(caption scores)   == sub-total
     sub-total - penalty   == total
     total                 == the score WGI's own API published for that unit
A row that fails any of them is dropped, and the drop rate is logged so a
format change shows up as a number rather than as quietly wrong sheets.
"""
from __future__ import annotations

import argparse
import json
from datetime import date
import re

from common import ROOT, fetch, log, norm_space
import scrape_compsuite as CS

PARSED = ROOT / "data" / "parsed"
TOL = 0.006            # recaps print to 2-3 dp; allow rounding, not error

# WGI's unit line: a name cell, then a hometown cell — except that smaller
# classes (Scholastic Regional A) carry no hometown column at all, and the
# name runs straight into the first score. The DCI anchor requires "City, ST"
# and found no units in those classes, dropping them whole and silently.
_UNIT = re.compile(
    r"<td class='content topBorder rightBorderDouble'>([^<]+)</td>"
    r"(?:\s*<td class='content topBorder rightBorderDouble'[^>]*>[^<]*</td>)?")
_START = re.compile(r"<!--PerformancesStart-->")
_END = re.compile(r"<!--PerformancesEnd-->")
_NON_CAPTION = re.compile(r"timing|penalt|sub\s*total|^total$", re.I)


def _raw(cell_html: str) -> str | None:
    m = CS._NUM.search(cell_html)
    return m.group(1).strip() if m else None


def _f(raw: str | None) -> float | None:
    if raw in (None, "", "-", "--"):
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def parse_layout(header_html: str):
    """Column plan for one class block, from its last four header rows.

    Returns (title, captions, plan) where plan is the left-to-right list of
    every score cell a unit row carries:
        ("sub", judge, caption)    a judge's raw x10 sub-score
        ("jtot", judge, caption)   that judge's caption total
        ("ctot", None, caption)    combined total of a doubled panel
        ("subtotal"|"pen"|"total", None, None)
    """
    trs = CS._TR.findall(header_html)
    if len(trs) < 4:
        return None
    title_row, cap_row, judge_row, leaf_row = trs[-4:]
    title = norm_space(" ".join(t for t, _c, _r in CS._hdr_cells(title_row)))
    caps = CS._hdr_cells(cap_row)
    judges = CS._hdr_cells(judge_row)
    leaves = [t for t, cs, _r in CS._hdr_cells(leaf_row) for _ in range(cs)]

    cap_by_leaf = []
    for txt, cs, rs in caps:
        if rs == 1:                              # rowspan>1 = name / sub-total / total
            cap_by_leaf.extend([txt] * cs)
    if not leaves or len(cap_by_leaf) != len(leaves):
        return None
    if sum(cs for _t, cs, _r in judges) != len(leaves):
        return None

    plan, li, pen_seen = [], 0, False
    for jname, jspan, _rs in judges:
        cap = cap_by_leaf[li]
        labels = leaves[li:li + jspan]
        li += jspan
        if _NON_CAPTION.search(cap or ""):       # the Timing & Penalties judge
            plan.append(("pen", None, None))
            pen_seen = True
            continue
        if not jname and jspan == 1:             # doubled panel's combined total
            plan.append(("ctot", None, cap))
            continue
        for k, lab in enumerate(labels):
            is_tot = k == len(labels) - 1 and "TOT" in lab.upper()
            plan.append(("jtot" if is_tot else "sub", jname, cap))
    # physical order: ... captions, Sub Total, penalty, Total
    if pen_seen:
        i = next(i for i, p in enumerate(plan) if p[0] == "pen")
        plan.insert(i, ("subtotal", None, None))
    else:
        plan.append(("subtotal", None, None))
    plan.append(("total", None, None))
    captions = []
    for _k, _j, c in plan:
        if c and c not in captions:
            captions.append(c)
    return title, captions, plan


def parse_rows(block_html: str, plan):
    units = list(_UNIT.finditer(block_html))
    out = []
    for k, u in enumerate(units):
        name = norm_space(u.group(1))
        end = units[k + 1].start() if k + 1 < len(units) else len(block_html)
        cells = [c.group(2) for c in CS._SCORE_CELL.finditer(block_html[u.end():end])]
        if len(cells) != len(plan):
            out.append({"unit": name, "error": f"{len(cells)} cells, layout expects {len(plan)}"})
            continue
        judges, caps, sub, pen, total = [], {}, None, 0.0, None
        jt_by_cap = {}
        for (kind, judge, cap), cell in zip(plan, cells):
            v = _f(_raw(cell))
            if kind == "sub":
                continue                         # raw x10 components: not needed
            if kind == "jtot":
                if v is not None:
                    judges.append({"j": judge, "c": cap, "v": v})
                    jt_by_cap.setdefault(cap, []).append(v)
            elif kind == "ctot":
                if v is not None:
                    caps[cap] = v
            elif kind == "subtotal":
                sub = v
            elif kind == "pen":
                pen = v or 0.0                   # true value: "0.1" is 0.1
            elif kind == "total":
                total = v
        for cap, vs in jt_by_cap.items():
            if cap not in caps and len(vs) == 1:  # single-judge caption
                caps[cap] = vs[0]
        out.append({"unit": name, "judges": judges, "caps": caps,
                    "sub": sub, "pen": round(pen, 3), "total": total})
    return out


def reconcile(row: dict, api_score: float | None) -> str | None:
    """None if the row is sound, else why it isn't."""
    if row.get("error"):
        return row["error"]
    if row["total"] is None or row["sub"] is None:
        return "no total"
    if abs(sum(row["caps"].values()) - row["sub"]) > TOL:
        return f"captions sum {sum(row['caps'].values()):.3f} != sub-total {row['sub']}"
    if abs(row["sub"] - row["pen"] - row["total"]) > TOL:
        return f"sub-total {row['sub']} - pen {row['pen']} != total {row['total']}"
    if api_score is None:
        return "unit not in WGI's published results"
    if abs(row["total"] - api_score) > TOL:
        return f"total {row['total']} != WGI {api_score}"
    return None


def parse_event(html: str, event: dict):
    """One WGI event's recap -> [class sheets], plus a tally of drops."""
    api = {}
    for g in event.get("classes") or []:
        api[g["class"]] = {"division": g.get("division"),
                           "scores": {r["corps"]: r["score"] for r in g.get("results") or []}}
    starts = [m.end() for m in _START.finditer(html)]
    ends = [m.start() for m in _END.finditer(html)]
    sheets, kept, dropped, reasons, prev = [], 0, 0, {}, 0
    for s, e in zip(starts, ends):
        layout = parse_layout(html[prev:s])
        prev = e
        if not layout:
            continue
        _title, captions, plan = layout
        rows = parse_rows(html[s:e], plan)
        # The recap and the API name classes differently ("Percussion
        # Scholastic A" vs "Scholastic Marching A"), and a renaming table would
        # break on the next label tweak. A unit competes in exactly one class
        # at a show, so the sheet belongs to whichever API class shares the
        # most of its units — and it takes that class's name, so it lines up
        # with every other WGI view.
        names = {r["unit"] for r in rows}
        best, overlap = None, 0
        for cls, info in api.items():
            n = len(names & set(info["scores"]))
            if n > overlap:
                best, overlap = cls, n
        if not best or overlap < max(1, len(names) // 2):
            continue                               # a round the API doesn't list
        title, info = best, api[best]
        good = []
        for row in rows:
            why = reconcile(row, info["scores"].get(row["unit"]))
            if why:
                dropped += 1
                key = why.split(" ")[0] if not why.startswith("unit") else "unit not in API"
                reasons[key] = reasons.get(key, 0) + 1
                continue
            kept += 1
            good.append({k: row[k] for k in ("unit", "caps", "judges", "sub", "pen", "total")})
        if good:
            sheets.append({"class": title, "division": info["division"],
                           "captions": [c for c in captions if not _NON_CAPTION.search(c)],
                           "rows": good})
    return sheets, kept, dropped, reasons


RECENT_DAYS = 10


def _recent(ev: dict, today: date | None = None) -> bool:
    today = today or date.today()
    try:
        d = date.fromisoformat((ev.get("date_iso") or "")[:10])
    except ValueError:
        return ev.get("year") == today.year    # undated: refresh only this season
    return (today - d).days <= RECENT_DAYS


def main(years: list[int] | None = None, limit: int | None = None) -> int:
    events = json.loads((PARSED / "wgi_events.json").read_text())
    if years:
        events = [e for e in events if e.get("year") in years]
    out, kept, dropped, reasons, done = [], 0, 0, {}, 0
    for ev in events:
        url = ev.get("recap_url")
        if not url:
            continue
        if limit and done >= limit:
            break
        done += 1
        # A recap fetched mid-show is partial, and the cache would keep it that
        # way forever. Refetch any show from the last RECENT_DAYS (or not yet
        # dated) so late units and score corrections land; older recaps are
        # final and stay cache-only.
        html = fetch(url, force=_recent(ev))
        if not html:
            continue
        sheets, k, d, why = parse_event(html, ev)
        kept, dropped = kept + k, dropped + d
        for r, n in why.items():
            reasons[r] = reasons.get(r, 0) + n
        if sheets:
            out.append({"year": ev["year"], "event": ev["name"], "date": ev.get("date_iso"),
                        "url": ev.get("url"), "recap_url": url, "sheets": sheets})
    (PARSED / "wgi_recaps.json").write_text(json.dumps(out, ensure_ascii=False))
    total = kept + dropped
    log(f"wgi recaps: {len(out)} events, {kept}/{total} unit rows verified"
        + (f" ({100 * dropped / total:.1f}% dropped: {reasons})" if total else ""))
    return len(out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--year", type=int, action="append")
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    main(a.year, a.limit)
