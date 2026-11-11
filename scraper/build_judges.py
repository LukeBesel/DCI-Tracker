#!/usr/bin/env python3
"""Judge analytics from the committed DCI recaps.

What this answers
-----------------
Every DCI recap names the judge behind each sub-caption and gives that
judge's score for every corps in the room. Across a season that is enough to
say something real about a judge that no scoreboard shows:

  tendency  — does this judge score above or below the rest of the panel on
              the same corps, at the same show?
  agreement — does this judge ORDER the field the way the panel does?
  spread    — do they separate the field, or compress it?

Honest construction
-------------------
Tendency compares a judge's sub-score for a corps against THAT CORPS' mean
across every sub-caption in the same room. Comparing against a season average
would punish whoever draws the weaker regionals; comparing within the room
cancels the field's strength out.

It does NOT cancel the caption out: General Effect sits lower than Music on
most sheets, so a GE judge shows a negative tendency by construction. The
caption's own mean tendency is published alongside, and the app only ranks
judges against others of the SAME caption. A number compared across captions
would be meaningless, so nothing here invites that comparison.

Agreement is Spearman rank correlation between the judge's ordering of the
corps in the room and the room's ordering by total score. 1.0 means they saw
the same show as everyone else; a low value is not "wrong" — a specialist
caption legitimately diverges — but a judge who routinely inverts the room is
worth knowing about.

Sample floors (MIN_CORPS, MIN_SHOWS, MIN_SCORES) keep a judge who worked one
small early-season show out of the table entirely rather than publishing a
number built from four data points.
"""
from __future__ import annotations

import json
import math
from collections import defaultdict

from common import ROOT, log, read_json, write_json

OUT_PREFIX = "judges"

MIN_CORPS = 4      # a room smaller than this says little about ordering
MIN_SHOWS = 2      # one show is an anecdote
MIN_SCORES = 12    # total corps-scores behind a published number

# Agreement needs a higher bar than tendency. It is a rank correlation over
# one room, so two rooms will happily produce a perfect 1.000 that means
# nothing — and a perfect score is exactly what catches the eye when the table
# is sorted by it. Below this many rooms the figure is withheld rather than
# published as though it were comparable to a seat with a full season behind
# it. Tendency averages over individual corps-scores, so it steadies much
# sooner and keeps the lower floor.
AGREE_MIN_ROOMS = 5


def recap_columns(groups):
    """The flat column layout a recap row uses: per sub [cols..., Tot], then a
    group Tot after each group. Mirrors how the caption card walks a recap."""
    cols = []
    for g in groups or []:
        for s in g.get("subs") or []:
            for c in s.get("cols") or []:
                cols.append(None)
            cols.append({"caption": s.get("n"), "judge": s.get("j"), "family": g.get("n")})
        cols.append(None)
    return cols


def _spearman(a: list[float], b: list[float]) -> float | None:
    """Rank correlation, average ranks for ties."""
    n = len(a)
    if n < 3:
        return None

    def ranks(v):
        order = sorted(range(n), key=lambda i: v[i])
        r = [0.0] * n
        i = 0
        while i < n:
            j = i
            while j + 1 < n and v[order[j + 1]] == v[order[i]]:
                j += 1
            avg = (i + j) / 2 + 1
            for k in range(i, j + 1):
                r[order[k]] = avg
            i = j + 1
        return r

    ra, rb = ranks(a), ranks(b)
    ma, mb = sum(ra) / n, sum(rb) / n
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    da = math.sqrt(sum((x - ma) ** 2 for x in ra))
    db = math.sqrt(sum((y - mb) ** 2 for y in rb))
    if da == 0 or db == 0:
        return None
    return num / (da * db)


def read_rooms(year: int):
    """Every (show, class) room with judge-attributed sub-scores."""
    doc = read_json(f"recaps/{year}.json")
    rooms = []
    for ev in (doc or {}).get("events") or []:
        for cl in ev.get("classes") or []:
            cols = recap_columns(cl.get("groups"))
            slots = [(i, c) for i, c in enumerate(cols) if c and c.get("judge")]
            if not slots:
                continue
            corps = []
            for row in cl.get("rows") or []:
                # a row is [name, values[], ranks[]] — ranks are the sheet's own
                # per-column placement, which we don't need here. Older rows may
                # carry no ranks at all, so take the first two and ignore the rest.
                if not isinstance(row, list) or len(row) < 2:
                    continue
                name, vals = row[0], row[1]
                if not name or not isinstance(vals, list):
                    continue
                picked = {}
                for i, meta in slots:
                    if i < len(vals) and isinstance(vals[i], (int, float)) and vals[i] > 0:
                        picked[(meta["judge"], meta["caption"])] = float(vals[i])
                if len(picked) == len(slots):      # complete sheets only
                    corps.append((name, picked))
            if len(corps) >= MIN_CORPS:
                rooms.append({"date": ev.get("d"), "event": ev.get("e"),
                              "cls": cl.get("c"), "corps": corps})
    return rooms


def build_year(year: int) -> dict | None:
    rooms = read_rooms(year)
    if not rooms:
        return None

    acc = defaultdict(lambda: {"devs": [], "scores": [], "agrees": [],
                               "shows": set(), "captions": set(), "classes": set()})
    for room in rooms:
        names = [c[0] for c in room["corps"]]
        # the room's own view of each corps: its mean across every sub-caption
        corps_mean = {n: (sum(p.values()) / len(p)) for n, p in room["corps"]}
        order = [corps_mean[n] for n in names]
        per_judge = defaultdict(list)
        for name, picked in room["corps"]:
            for (judge, caption), v in picked.items():
                key = (judge, caption)
                acc[key]["devs"].append(v - corps_mean[name])
                acc[key]["scores"].append(v)
                acc[key]["shows"].add((room["date"], room["event"], room["cls"]))
                acc[key]["captions"].add(caption)
                acc[key]["classes"].add(room["cls"])
                per_judge[key].append(v)
        for key, vals in per_judge.items():
            if len(vals) == len(names):
                r = _spearman(vals, order)
                if r is not None:
                    acc[key]["agrees"].append(r)

    def mean(v):
        return sum(v) / len(v) if v else None

    judges = []
    for (judge, caption), a in acc.items():
        if len(a["shows"]) < MIN_SHOWS or len(a["scores"]) < MIN_SCORES:
            continue
        sc = a["scores"]
        mu = mean(sc)
        var = sum((x - mu) ** 2 for x in sc) / len(sc) if len(sc) > 1 else 0.0
        judges.append({
            "judge": judge, "caption": caption,
            "shows": len(a["shows"]), "scores": len(sc),
            "classes": sorted(a["classes"]),
            "mean": round(mu, 3),
            "tendency": round(mean(a["devs"]), 3),
            "spread": round(math.sqrt(var), 3),
            "agreement": (round(mean(a["agrees"]), 3)
                          if len(a["agrees"]) >= AGREE_MIN_ROOMS else None),
            "agreement_rooms": len(a["agrees"]),
        })
    if not judges:
        return None

    # caption context: the systematic offset a caption carries, so a GE judge
    # is never read as "harsh" for judging GE
    by_caption = defaultdict(list)
    for j in judges:
        by_caption[j["caption"]].append(j)
    captions = {}
    for cap, js in by_caption.items():
        t = [j["tendency"] for j in js]
        captions[cap] = {"judges": len(js), "tendency": round(sum(t) / len(t), 3)}
        for j in js:                      # tendency relative to this caption's own norm
            j["rel"] = round(j["tendency"] - captions[cap]["tendency"], 3)

    judges.sort(key=lambda j: (j["caption"], -j["shows"], j["judge"]))
    return {"year": year, "judges": judges, "captions": captions,
            "rooms": len(rooms),
            "floors": {"corps": MIN_CORPS, "shows": MIN_SHOWS, "scores": MIN_SCORES,
                       "agreement_rooms": AGREE_MIN_ROOMS}}


def main() -> int:
    index = []
    idx = read_json("recaps/index.json") or {}
    years = [s["year"] for s in (idx.get("seasons") or []) if s.get("year")]
    if not years:                       # no index: fall back to what is on disk
        p = ROOT / "docs" / "data" / "recaps"
        years = sorted((int(f.stem) for f in p.glob("*.json") if f.stem.isdigit()),
                       reverse=True) if p.exists() else []
    for year in years:
        built = build_year(int(year))
        if not built:
            continue
        write_json(f"{OUT_PREFIX}/{year}.json", built)
        index.append({"year": int(year), "judges": len(built["judges"]),
                      "rooms": built["rooms"]})
    index.sort(key=lambda r: -r["year"])
    write_json(f"{OUT_PREFIX}/index.json", {"years": index})
    log(f"judges: built {len(index)} season(s)")
    return len(index)


if __name__ == "__main__":
    main()
