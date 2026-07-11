"""Build the static site's data (docs/data) from DCI.org scrape output ONLY.

Input:  data/parsed/dci_events.json
Output: docs/data/
  meta.json                dataset stats, seasons list, sources
  rankings.json            current-season standings/movers/battles per class
  champions.json           {year: {class: {corps, score}}} from championship finals
  seasons/<year>.json      full event list w/ results + caption recaps
  corps_index.json         per-corps summary + season-best series
  corps/<slug>.json        every performance for one corps
  db/perfs_<decade>s.json  flat sortable rows + db/index.json
"""
from __future__ import annotations

import json
import re
import shutil
from collections import defaultdict
from datetime import datetime, timezone

from common import ROOT, OUT, write_json, log, norm_space, canon_corps, slugify

PARSED = ROOT / "data" / "parsed"

MONTHS = {m: i + 1 for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"])}


def iso_date(ev) -> str | None:
    d = ev.get("date_display")
    if not d:
        return None
    m = re.match(r"(\w+)\s+(\d{1,2}),?\s+(\d{4})", d)
    if not m or m.group(1) not in MONTHS:
        return None
    return f"{int(m.group(3)):04d}-{MONTHS[m.group(1)]:02d}-{int(m.group(2)):02d}"


CLASS_CANON = [
    (re.compile(r"all[- ]?age|^sr\.?$|^senior", re.I), "All-Age"),
    (re.compile(r"world class|division i\b", re.I), "World Class"),
    (re.compile(r"open class|division ii", re.I), "Open Class"),
    (re.compile(r"international", re.I), "International"),
    (re.compile(r"exhibition|soundsport|mini|^exh\.?$|rained", re.I), "Exhibition"),
    # historical junior-corps division systems (pre-DCI-class era)
    (re.compile(r"^(class\s*)?a$|^junior a$", re.I), "Class A"),
    (re.compile(r"^(class\s*)?b$|^junior b$", re.I), "Class B"),
    (re.compile(r"^(class\s*)?c$|^junior c$", re.I), "Class C"),
    (re.compile(r"all[- ]?girl", re.I), "All-Girl"),
    (re.compile(r"^(jr\.?|junior)$", re.I), "Junior"),
]

# Individual & Ensemble contest categories — people, not corps. These must
# never reach corps pages, rankings, or the database.
IE_CLASS = re.compile(
    r"^(brass|woodwind|percussion|visual|vocal|mixed|color ?guard)\s*[-–—]"
    r"|solo\b|ensemble\b|individual", re.I)


def canon_class(name: str) -> str:
    n = norm_space(name or "")
    for pat, out in CLASS_CANON:
        if pat.search(n):
            return out
    return n or "World Class"


def load_events():
    """dci_events.json (DCI.org, 2013+) merged with history_events.json
    (pre-2013 archive scrape, same schema). History only contributes years
    the official source doesn't cover, so DCI.org stays authoritative."""
    events = []
    p = PARSED / "dci_events.json"
    if p.exists():
        events = json.loads(p.read_text())
    dci_years = {e.get("year") for e in events}
    hp = PARSED / "history_events.json"
    if hp.exists():
        hist = [e for e in json.loads(hp.read_text())
                if e.get("year") and (e["year"] < 2013 or e["year"] not in dci_years)]
        events += hist
        log(f"merged {len(hist)} historical events")
    if not events:
        log("no parsed events — nothing to build")
        return []
    out = []
    for ev in events:
        if not ev.get("year") or not ev.get("classes") or ev.get("non_corps"):
            continue
        ev = dict(ev)
        ev["date"] = ev.get("date") or iso_date(ev)
        classes = []
        for c in ev["classes"]:
            if IE_CLASS.search(norm_space(c.get("class") or "")):
                continue  # individual/ensemble category, not corps competition
            cc = canon_class(c.get("class"))
            results = [dict(r, corps=canon_corps(r["corps"])) for r in c["results"] if r.get("corps")]
            if not results or cc == "Exhibition":
                continue
            classes.append({"class": cc, "results": results})
        # merge duplicate canonical classes
        merged: dict[str, dict] = {}
        for c in classes:
            if c["class"] in merged:
                merged[c["class"]]["results"].extend(c["results"])
            else:
                merged[c["class"]] = c
        for c in merged.values():
            c["results"].sort(key=lambda r: (r["place"] if r["place"] is not None else 99, -(r["score"] or 0)))
        ev["classes"] = list(merged.values())
        if ev["classes"]:
            out.append(ev)
    log(f"loaded {len(out)} usable events")
    return out


def build_seasons(events):
    by = defaultdict(list)
    for ev in events:
        by[ev["year"]].append(ev)
    season_index = []
    for year, evs in sorted(by.items()):
        evs.sort(key=lambda e: (e.get("date") or f"{year}-12-31", e.get("name") or ""))
        slim = [{
            "name": ev.get("name"), "date": ev.get("date"),
            "date_display": ev.get("date_display"), "location": ev.get("location"),
            "url": ev.get("url"), "recap_url": ev.get("recap_url"),
            "classes": ev.get("classes"), "recap": ev.get("recap"),
        } for ev in evs]
        write_json(f"seasons/{year}.json", slim)
        season_index.append({"year": year, "events": len(evs)})
    return season_index


def build_champions(events):
    champs = defaultdict(dict)
    for ev in events:
        n = (ev.get("name") or "").lower()
        if "championship" not in n or "final" not in n or "semi" in n or "prelim" in n or "quarter" in n:
            continue
        # archive-sourced events cover other circuits too (VFW, DCA …):
        # only a DCI championship crowns a DCI champion
        if ev.get("source") == "dcx" and "dci" not in n:
            continue
        for c in ev["classes"]:
            res = [r for r in c["results"] if r.get("score")]
            if not res:
                continue
            res.sort(key=lambda r: (r["place"] if r["place"] is not None else 99, -(r["score"] or 0)))
            cls = c["class"]
            if "open class" in n and cls == "World Class":
                cls = "Open Class"
            if "all-age" in n or "all age" in n:
                cls = "All-Age"
            cur = champs[ev["year"]].get(cls)
            if cur is None or (res[0]["score"] or 0) > (cur["score"] or 0):
                champs[ev["year"]][cls] = {"corps": res[0]["corps"], "score": res[0]["score"]}

    # fall back to the documented public record (Wikipedia) for seasons
    # where no championship-finals event has been scraped
    wp = PARSED / "wiki_champions.json"
    if wp.exists():
        filled = 0
        for year, w in json.loads(wp.read_text()).items():
            if "World Class" not in champs[int(year)] and w.get("corps"):
                champs[int(year)]["World Class"] = {"corps": w["corps"], "score": w.get("score")}
                filled += 1
        if filled:
            log(f"champions: filled {filled} seasons from public record")
    champs = {y: v for y, v in champs.items() if v}
    return {str(y): v for y, v in sorted(champs.items())}


def build_corps(events):
    perfs = defaultdict(list)
    for ev in events:
        for c in ev["classes"]:
            for r in c["results"]:
                perfs[r["corps"]].append({
                    "y": ev["year"], "d": ev.get("date"), "ev": ev.get("name"),
                    "cls": c["class"], "p": r.get("place"), "s": r.get("score"),
                })
    index = []
    for corps, plist in sorted(perfs.items()):
        plist.sort(key=lambda x: (x["y"], x["d"] or ""))
        years = sorted({p["y"] for p in plist})
        scored = [p["s"] for p in plist if p["s"]]
        slug = slugify(corps)
        write_json(f"corps/{slug}.json", {"name": corps, "performances": plist})
        season_best = defaultdict(float)
        season_class = {}
        for p in plist:
            if (p["s"] or 0) > season_best[p["y"]]:
                season_best[p["y"]] = p["s"]
                season_class[p["y"]] = p["cls"]
        index.append({
            "name": corps, "slug": slug,
            "first": years[0], "last": years[-1], "seasons": len(years),
            "best": max(scored) if scored else None, "n": len(plist),
            "series": [[y, season_best[y] or None, season_class.get(y)] for y in years],
        })
    write_json("corps_index.json", index)

    by_decade = defaultdict(list)
    for corps, plist in perfs.items():
        for p in plist:
            by_decade[(p["y"] // 10) * 10].append(
                [p["y"], p.get("d"), p.get("ev"), corps, p.get("cls"), p.get("p"), p.get("s")])
    decades = []
    for dec, rows in sorted(by_decade.items()):
        rows.sort(key=lambda r: (r[0], r[1] or "", r[2] or "", r[5] if r[5] is not None else 99))
        write_json(f"db/perfs_{dec}s.json", rows)
        decades.append({"decade": f"{dec}s", "rows": len(rows)})
    write_json("db/index.json", decades)
    return index


def build_rankings(events):
    now = datetime.now(timezone.utc)
    season = max((e["year"] for e in events), default=now.year)
    dated = sorted([e for e in events if e.get("date") and e["year"] == season],
                   key=lambda e: e["date"])
    per_class = defaultdict(dict)
    for ev in dated:
        for c in ev["classes"]:
            for r in c["results"]:
                if not r.get("score"):
                    continue
                per_class[c["class"]].setdefault(r["corps"], []).append(
                    {"date": ev["date"], "score": r["score"], "event": ev["name"]})
    standings = {}
    for cls, corps_map in per_class.items():
        rows = []
        for corps, hist in corps_map.items():
            hist.sort(key=lambda h: h["date"])
            latest, prev = hist[-1], (hist[-2] if len(hist) > 1 else None)
            rows.append({
                "corps": corps, "score": latest["score"], "date": latest["date"],
                "event": latest["event"],
                "high": max(h["score"] for h in hist),
                "prev_score": prev["score"] if prev else None,
                "delta": round(latest["score"] - prev["score"], 3) if prev else None,
                "outings": len(hist),
                "trend": [[h["date"], h["score"]] for h in hist][-10:],
            })
        rows.sort(key=lambda r: -(r["score"] or 0))
        for i, r in enumerate(rows):
            r["rank"] = i + 1
        movers = sorted([r for r in rows if r["delta"] is not None],
                        key=lambda r: -abs(r["delta"]))[:3]
        battles = []
        for a, b in zip(rows, rows[1:]):
            battles.append({"a": a["corps"], "b": b["corps"], "ra": a["rank"], "rb": b["rank"],
                            "sa": a["score"], "sb": b["score"],
                            "gap": round(a["score"] - b["score"], 3)})
        battles.sort(key=lambda x: x["gap"])
        standings[cls] = {"rows": rows, "movers": movers, "battles": battles[:3]}

    recent = []
    for ev in dated[-10:][::-1]:
        winner = None
        for c in ev["classes"]:
            res = [r for r in c["results"] if r.get("score")]
            res.sort(key=lambda r: -(r["score"] or 0))
            if res and (winner is None or (res[0]["score"] or 0) > (winner["score"] or 0)):
                winner = {"corps": res[0]["corps"], "score": res[0]["score"], "class": c["class"]}
        recent.append({"name": ev["name"], "date": ev.get("date"),
                       "location": ev.get("location"), "winner": winner})

    return {
        "generated": now.strftime("%Y-%m-%d %H:%M UTC"),
        "season": season,
        "standings": standings,
        "recent_events": recent,
    }


def build_upcoming():
    """docs/data/upcoming.json from data/parsed/dci_upcoming.json (events
    calendar scrape): future events with lineups for the homepage."""
    p = PARSED / "dci_upcoming.json"
    rows = []
    if p.exists():
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        for ev in json.loads(p.read_text()):
            if ev.get("date") and ev["date"] >= today:
                rows.append({
                    "name": ev.get("name"), "date": ev["date"],
                    "date_display": ev.get("date_display"),
                    "location": ev.get("location"), "url": ev.get("url"),
                    "lineup": [canon_corps(c) for c in (ev.get("lineup") or [])],
                })
        rows.sort(key=lambda e: (e["date"], e.get("name") or ""))
    write_json("upcoming.json", rows[:60])


def main():
    # wipe output dir so removed features never leave stale files behind
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True, exist_ok=True)

    events = load_events()
    season_index = build_seasons(events)
    champions = build_champions(events)
    corps_index = build_corps(events)
    rankings = build_rankings(events)
    build_upcoming()

    write_json("champions.json", champions)
    write_json("rankings.json", rankings)
    write_json("meta.json", {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "seasons": season_index,
        "counts": {"events": len(events), "corps": len(corps_index)},
        "source": {"name": "DCI.org — official scores (Competition Suite)",
                   "url": "https://www.dci.org/scores"},
    })
    log("build complete")


if __name__ == "__main__":
    main()
