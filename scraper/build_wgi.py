#!/usr/bin/env python3
"""Build the app's WGI data from data/parsed/wgi_events.json.

Why a separate builder
----------------------
build_data.py feeds every one of its eighteen outputs from ONE event stream
whose downstream logic is DCI's: canon_class, the championship cutoff, the
corps index, records, pace curves, caption titles. Merging WGI into that
stream would need a circuit flag threaded through all of it, and any slip
would put high-school guards in the corps index or "Scholastic Open" on a
DCI board.

So WGI gets its own namespace under docs/data/wgi/ instead. DCI's output is
untouched and stays byte-identical; the app picks a circuit and reads from
one prefix or the other. The season file shape deliberately matches
seasons/<year>.json so the app's existing event rendering is reused.

WGI's own shape
---------------
A WGI season is Jan-May of its own calendar year (DCI's is Jun-Aug), so the
two coexist in one year without colliding. Competition is split three ways —
Color Guard, Percussion, Winds — and each division runs its own classes
(Scholastic/Independent x A/Open/World, plus Marching/Concert variants in
Percussion). Division is therefore a first-class axis here, not a class
prefix: the app selects a division, then a class within it.
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone

from common import ROOT, log, write_json

PARSED = ROOT / "data" / "parsed"
PREFIX = "wgi"

SOURCE = {"name": "WGI Sport of the Arts — official scores",
          "url": "https://www.wgi.org/scores/"}

DIVISION_ORDER = ["Color Guard", "Percussion", "Winds"]

# Within a division, WGI ranks classes World > Open > A, with Independent
# listed before Scholastic at each tier (that is how WGI's own finals run).
_TIER = ["World", "Open", "A"]


def class_sort_key(name: str):
    n = name or ""
    tier = next((i for i, t in enumerate(_TIER) if f" {t}" in f" {n} " or n.endswith(f" {t}")), len(_TIER))
    indep = 0 if n.startswith("Independent") else 1
    return (tier, indep, n)


def sort_classes(names):
    return sorted(names, key=class_sort_key)


def _read(name: str) -> list[dict]:
    p = PARSED / name
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text())
    except ValueError:
        log(f"wgi: {name} is not valid JSON — ignored")
        return []


def load_events() -> list[dict]:
    """The API seasons (2024+, every show, all three divisions) plus the
    historical pages (1980-2023, Color Guard World Championship finals only).

    The two never overlap: the API's earliest season record is 2024 and the
    historical series stops at 2023. If that ever changes, the API wins for a
    year it covers — it carries every show, not just the championship."""
    api = _read("wgi_events.json")
    api_years = {e.get("year") for e in api}
    hist = [e for e in _read("wgi_history_events.json") if e.get("year") not in api_years]
    if hist:
        log(f"wgi: merged {len(hist)} historical championship season(s)")
    evs = api + hist
    if not evs:
        log("wgi: no parsed events — nothing to build")
        return []
    out = []
    for ev in evs:
        if not ev.get("year") or not ev.get("classes"):
            continue
        # drop class groups that carry no usable rows
        classes = [c for c in ev["classes"] if c.get("results")]
        if not classes:
            continue
        ev = dict(ev)
        ev["classes"] = classes
        out.append(ev)
    log(f"wgi: {len(out)} usable events")
    return out


def build_seasons(events) -> list[dict]:
    by = defaultdict(list)
    for ev in events:
        by[ev["year"]].append(ev)
    index = []
    for year, evs in sorted(by.items()):
        evs.sort(key=lambda e: (e.get("date_iso") or "9999-99-99", e.get("name") or ""))
        slim = [{
            "name": ev.get("name"),
            "date": ev.get("date_iso"),
            "date_display": ev.get("date_display"),
            "location": ev.get("location") or None,
            "url": ev.get("url"),
            "recap_url": ev.get("recap_url"),
            "source": ev.get("source"),
            "classes": ev.get("classes"),
            "has_recap": bool(ev.get("recap") or ev.get("recap_url")),
            "finals_only": bool(ev.get("finals_only")),
        } for ev in evs]
        write_json(f"{PREFIX}/seasons/{year}.json", slim)
        index.append({
            "year": year,
            "events": len(evs),
            "divisions": sort_divisions({c.get("division") for ev in evs for c in ev["classes"]}),
            # a pre-2024 year is the World Championship recap and nothing else;
            # the app says so rather than implying a whole season is listed
            "finals_only": all(ev.get("finals_only") for ev in evs),
        })
    return index


def sort_divisions(found) -> list[str]:
    found = {d for d in found if d}
    ordered = [d for d in DIVISION_ORDER if d in found]
    return ordered + sorted(found - set(ordered))


def build_rankings(events) -> dict:
    """Latest season's standings, per division then class.

    A group's standing is its best score of the season (WGI groups compete a
    handful of times, and the championship is the point), with the event and
    date that produced it so the app can link to the show.
    """
    if not events:
        return {}
    season = max(ev["year"] for ev in events)
    rows: dict[tuple[str, str], dict[str, dict]] = defaultdict(dict)
    for ev in events:
        if ev["year"] != season:
            continue
        for grp in ev["classes"]:
            div, cls = grp.get("division") or "", grp.get("class") or ""
            if not div or not cls:
                continue
            for r in grp["results"]:
                name, score = r.get("corps"), r.get("score")
                if not name or not isinstance(score, (int, float)):
                    continue
                cur = rows[(div, cls)].get(name)
                if cur is None or score > cur["score"]:
                    rows[(div, cls)][name] = {
                        "corps": name, "score": score,
                        "date": ev.get("date_iso"), "event": ev.get("name"),
                    }
    standings: dict[str, dict] = {}
    for (div, cls), groups in rows.items():
        ordered = sorted(groups.values(), key=lambda r: -r["score"])
        for i, r in enumerate(ordered, 1):
            r["rank"] = i
        standings.setdefault(div, {})[cls] = {"rows": ordered}
    divisions = sort_divisions(standings)
    return {
        "season": season,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "divisions": divisions,
        "classes": {d: sort_classes(standings[d]) for d in divisions},
        "standings": standings,
        "source": SOURCE,
    }


def build_captions() -> list[dict]:
    """Caption sheets for the WGI Captions tab, from the verified recaps.

    Every row here already passed scrape_wgi_recaps' three checks (captions
    sum to the sub-total, sub-total minus penalty is the total, and the total
    is the score WGI's API published), so this step only reshapes. One file per
    season: each sheet is one class at one show, with its caption columns, the
    judges behind each caption, and a row per unit aligned to those columns.
    """
    p = PARSED / "wgi_recaps.json"
    if not p.exists():
        return []
    try:
        recaps = json.loads(p.read_text())
    except ValueError:
        log("wgi: wgi_recaps.json is not valid JSON — captions skipped")
        return []
    by_year = defaultdict(list)
    for ev in recaps:
        for sh in ev.get("sheets") or []:
            caps = sh.get("captions") or []
            panel = {c: [] for c in caps}
            for row in sh.get("rows") or []:
                for j in row.get("judges") or []:
                    if j.get("c") in panel and j.get("j") and j["j"] not in panel[j["c"]]:
                        panel[j["c"]].append(j["j"])
            rows = [[r["unit"], [r["caps"].get(c) for c in caps], r.get("total"), r.get("pen") or 0]
                    for r in sh.get("rows") or []]
            rows.sort(key=lambda r: -(r[2] or 0))
            by_year[ev["year"]].append({
                "d": ev.get("date"), "e": ev.get("event"), "u": ev.get("url"),
                "r": ev.get("recap_url"), "v": sh.get("division"), "c": sh.get("class"),
                "caps": caps, "panel": panel, "rows": rows})
    index = []
    for year, sheets in sorted(by_year.items()):
        sheets.sort(key=lambda s: (s["d"] or "", s["e"] or "", s["v"] or "", s["c"] or ""))
        write_json(f"{PREFIX}/captions/{year}.json", {"year": year, "sheets": sheets})
        index.append({"year": year, "sheets": len(sheets),
                      "rows": sum(len(s["rows"]) for s in sheets),
                      "divisions": sort_divisions({s["v"] for s in sheets})})
    write_json(f"{PREFIX}/captions/index.json",
               {"seasons": sorted(index, key=lambda s: -s["year"])})
    log(f"wgi: caption sheets for {len(index)} season(s)")
    return index


def main() -> int:
    build_captions()
    events = load_events()
    if not events:
        # still publish an empty, well-formed meta so the app can say
        # "no WGI data" rather than fail a fetch
        write_json(f"{PREFIX}/meta.json", {
            "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "seasons": [], "divisions": [], "counts": {"events": 0, "groups": 0},
            "source": SOURCE,
        })
        return 0

    season_index = build_seasons(events)
    rankings = build_rankings(events)
    write_json(f"{PREFIX}/rankings.json", rankings)

    groups = {r["corps"] for ev in events for c in ev["classes"] for r in c["results"] if r.get("corps")}
    divisions = sort_divisions({c.get("division") for ev in events for c in ev["classes"]})
    write_json(f"{PREFIX}/meta.json", {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "seasons": sorted(season_index, key=lambda s: -s["year"]),
        "divisions": divisions,
        "counts": {"events": len(events), "groups": len(groups)},
        "source": SOURCE,
    })
    log(f"wgi: built {len(events)} events, {len(groups)} groups, "
        f"{len(season_index)} season(s), divisions={divisions}")
    return len(events)


if __name__ == "__main__":
    main()
