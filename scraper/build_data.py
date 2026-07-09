"""Merge every parsed source into the static site's data files (docs/data).

Inputs (data/parsed/):
  dci_events.json          dci.org 2013+  (authoritative, has caption recaps)
  dcnet_dci.json           drum-corps.net DCI 2001+
  dcnet_dca.json           drum-corps.net DCA 2001+
  dca_site.json            dcacorps.org recent DCA
  dci_finals_history.json  soundmachine finals 1972-2004 (+repertoires)
  dci_finals_recaps.json   raw caption recap text per year
  dca_champions.json       Wikipedia DCA champions 1965+
  news.json

Outputs (docs/data/):
  meta.json, news.json, today.json, champions.json,
  seasons/dci_<year>.json, seasons/dca_<year>.json,
  corps_index.json, corps/<slug>.json,
  history/finals_recap_<year>.json
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from common import ROOT, OUT, write_json, log, norm_space, canon_corps, slugify

PARSED = ROOT / "data" / "parsed"


def load(name, default):
    p = PARSED / name
    if not p.exists():
        log(f"missing input {name}")
        return default
    return json.loads(p.read_text())


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
    (re.compile(r"world class|division i\b|div(ision)? ?1\b|open class \(dci\)", re.I), "World Class"),
    (re.compile(r"open class|division ii\b|div(ision)? ?2\b|a-?60", re.I), "Open Class"),
    (re.compile(r"all[- ]age|dca|senior", re.I), "All-Age"),
    (re.compile(r"class a\b|a class", re.I), "Class A"),
    (re.compile(r"division iii|div(ision)? ?3", re.I), "Division III"),
    (re.compile(r"international|exhibition|soundsport|mini", re.I), "Other"),
]


def canon_class(name: str, circuit: str) -> str:
    n = norm_space(name or "")
    for pat, out in CLASS_CANON:
        if pat.search(n):
            return out
    if circuit == "dca":
        return n if n and n.lower() != "results" else "Open Class"
    return n if n and n.lower() != "results" else "World Class"


def event_key(ev):
    return (ev.get("year"), slugify(re.sub(r"\b(dci|dca|presented by.*|the)\b", "", (ev.get("name") or "").lower())))


def merge_events():
    """Combine sources; dci.org wins for DCI 2013+, dcnet fills the rest."""
    dci_org = load("dci_events.json", [])
    dcnet_dci = load("dcnet_dci.json", [])
    dcnet_dca = load("dcnet_dca.json", [])
    dca_site = load("dca_site.json", [])

    events = {}
    for src_rank, (circuit, evs) in enumerate([
            ("dci", dci_org), ("dci", dcnet_dci), ("dca", dcnet_dca), ("dca", dca_site)]):
        for ev in evs:
            if not ev.get("year") or not ev.get("classes"):
                continue
            ev = dict(ev)
            ev["circuit"] = circuit
            # DCA championships sometimes live in the DCI feed as All-Age; keep circuit tag from source
            k = (circuit,) + event_key(ev)
            if k in events:
                continue  # first source wins (ordered by authority)
            ev["date"] = iso_date(ev)
            for c in ev["classes"]:
                c["class"] = canon_class(c.get("class"), circuit)
                for r in c["results"]:
                    r["corps"] = canon_corps(r["corps"])
            events[k] = ev
    log(f"merged: {len(events)} events")
    return list(events.values())


def build_seasons(events):
    by = defaultdict(list)
    for ev in events:
        by[(ev["circuit"], ev["year"])].append(ev)
    season_index = defaultdict(list)
    for (circuit, year), evs in sorted(by.items()):
        evs.sort(key=lambda e: (e.get("date") or f"{year}-01-01", e.get("name") or ""))
        slim = []
        for ev in evs:
            slim.append({
                "name": ev.get("name"), "date": ev.get("date"),
                "date_display": ev.get("date_display"), "location": ev.get("location"),
                "url": ev.get("url"), "recap_url": ev.get("recap_url"),
                "classes": ev.get("classes"), "recap": ev.get("recap"),
            })
        write_json(f"seasons/{circuit}_{year}.json", slim)
        season_index[circuit].append({"year": year, "events": len(evs)})
    return season_index


def is_championship_finals(ev):
    n = (ev.get("name") or "").lower()
    return ("world championship" in n and "final" in n and
            "semi" not in n and "prelim" not in n and "quarter" not in n
            and "all-age" not in n and "individual" not in n)


def build_champions(events, finals_history, dca_champions):
    """champions.json: {dci: {year: {class: {corps, score}}}, dca: {...}}"""
    dci = defaultdict(dict)
    for row in finals_history:  # 1972-2004 finals (world class = top result)
        res = sorted(row["results"], key=lambda r: r["place"])
        if res:
            dci[row["year"]]["World Class"] = {"corps": res[0]["corps"], "score": res[0]["score"]}
    for ev in events:
        if ev["circuit"] != "dci":
            continue
        n = (ev.get("name") or "").lower()
        if "world championship" not in n or "final" not in n or "semi" in n or "prelim" in n:
            continue
        for c in ev["classes"]:
            res = sorted(c["results"], key=lambda r: r["place"])
            if not res:
                continue
            cls = c["class"]
            if "open class" in n and cls == "World Class":
                cls = "Open Class"
            if "all-age" in n or "all age" in n:
                cls = "All-Age"
            cur = dci[ev["year"]].get(cls)
            if cur is None or (res[0]["score"] or 0) >= (cur["score"] or 0):
                dci[ev["year"]][cls] = {"corps": res[0]["corps"], "score": res[0]["score"]}
    dca = {}
    for r in dca_champions:
        dca[r["year"]] = {"Open Class": {"corps": r["corps"], "score": r["score"]}}
    # DCA champs from events (finals) override/extend Wikipedia list
    for ev in events:
        if ev["circuit"] != "dca":
            continue
        n = (ev.get("name") or "").lower()
        if "championship" in n and "final" in n and "prelim" not in n:
            for c in ev["classes"]:
                res = sorted(c["results"], key=lambda r: r["place"])
                if res:
                    dca.setdefault(ev["year"], {})[c["class"]] = {
                        "corps": res[0]["corps"], "score": res[0]["score"]}
    return {"dci": {str(k): v for k, v in sorted(dci.items())},
            "dca": {str(k): v for k, v in sorted(dca.items())}}


def build_corps(events, finals_history):
    """Per-corps performance log across all circuits/years."""
    perfs = defaultdict(list)  # corps -> [{y,d,ev,cls,place,score,circuit}]
    for ev in events:
        for c in ev["classes"]:
            for r in c["results"]:
                perfs[r["corps"]].append({
                    "y": ev["year"], "d": ev.get("date"),
                    "ev": ev.get("name"), "cls": c["class"],
                    "p": r["place"], "s": r["score"], "cir": ev["circuit"],
                })
    for row in finals_history:
        for r in row["results"]:
            perfs[r["corps"]].append({
                "y": row["year"], "d": None,
                "ev": "DCI World Championship Finals", "cls": "World Class",
                "p": r["place"], "s": r["score"], "cir": "dci",
                "rep": r.get("repertoire"),
            })

    index = []
    for corps, plist in sorted(perfs.items()):
        plist.sort(key=lambda x: (x["y"], x["d"] or ""))
        years = sorted({p["y"] for p in plist})
        best = max((p["s"] or 0) for p in plist)
        slug = slugify(corps)
        write_json(f"corps/{slug}.json", {"name": corps, "performances": plist})
        # compact season series: year -> best score that season
        season_best = defaultdict(float)
        season_class = {}
        for p in plist:
            if (p["s"] or 0) > season_best[p["y"]]:
                season_best[p["y"]] = p["s"]
                season_class[p["y"]] = p["cls"]
        index.append({
            "name": corps, "slug": slug,
            "first": years[0], "last": years[-1], "seasons": len(years),
            "best": best, "n": len(plist),
            "series": [[y, season_best[y], season_class[y]] for y in years],
            "circuits": sorted({p["cir"] for p in plist}),
        })
    write_json("corps_index.json", index)

    # Flat sortable database, sharded by decade:
    # rows [year, date, event, corps, class, circuit, place, score]
    by_decade = defaultdict(list)
    for corps, plist in perfs.items():
        for p in plist:
            by_decade[(p["y"] // 10) * 10].append(
                [p["y"], p.get("d"), p.get("ev"), corps, p.get("cls"),
                 p.get("cir"), p.get("p"), p.get("s")])
    decades = []
    for dec, rows in sorted(by_decade.items()):
        rows.sort(key=lambda r: (r[0], r[1] or "", r[2] or "", r[6] or 99))
        write_json(f"db/perfs_{dec}s.json", rows)
        decades.append({"decade": f"{dec}s", "rows": len(rows)})
    write_json("db/index.json", decades)
    return index


def build_today(events, news):
    """The 'pulse' page: standings + movers + battles + caption leaders."""
    now = datetime.now(timezone.utc)
    season = now.year
    dated = [e for e in events if e.get("date") and e["year"] == season]
    dated.sort(key=lambda e: e["date"])

    per_class = defaultdict(dict)  # class -> corps -> list of (date, score, event)
    for ev in dated:
        if ev["circuit"] != "dci":
            continue
        for c in ev["classes"]:
            for r in c["results"]:
                per_class[c["class"]].setdefault(r["corps"], []).append(
                    {"date": ev["date"], "score": r["score"], "event": ev["name"]})

    standings = {}
    for cls, corps_map in per_class.items():
        rows = []
        for corps, hist in corps_map.items():
            hist.sort(key=lambda h: h["date"])
            latest = hist[-1]
            prev = hist[-2] if len(hist) > 1 else None
            rows.append({
                "corps": corps, "score": latest["score"], "date": latest["date"],
                "event": latest["event"],
                "prev_score": prev["score"] if prev else None,
                "delta": round(latest["score"] - prev["score"], 3) if prev else None,
                "outings": len(hist),
                "trend": [h["score"] for h in hist][-8:],
            })
        rows.sort(key=lambda r: -(r["score"] or 0))
        for i, r in enumerate(rows):
            r["rank"] = i + 1
        # movers & battles
        movers = sorted([r for r in rows if r["delta"] is not None],
                        key=lambda r: -abs(r["delta"]))[:3]
        battles = []
        for a, b in zip(rows, rows[1:]):
            if a["score"] and b["score"]:
                battles.append({"a": a["corps"], "b": b["corps"],
                                "ra": a["rank"], "rb": b["rank"],
                                "sa": a["score"], "sb": b["score"],
                                "gap": round(a["score"] - b["score"], 3)})
        battles.sort(key=lambda x: x["gap"])
        standings[cls] = {"rows": rows, "movers": movers, "battles": battles[:3]}

    # caption leaders from the latest recap available this season
    caption_leaders = None
    for ev in reversed(dated):
        if ev.get("recap"):
            caption_leaders = {"event": ev["name"], "date": ev.get("date"),
                               "recap_url": ev.get("recap_url")}
            break

    recent = []
    for ev in dated[-12:][::-1]:
        winner = None
        for c in ev["classes"]:
            res = sorted(c["results"], key=lambda r: r["place"])
            if res and (winner is None or (res[0]["score"] or 0) > (winner["score"] or 0)):
                winner = {"corps": res[0]["corps"], "score": res[0]["score"], "class": c["class"]}
        recent.append({"name": ev["name"], "date": ev.get("date"),
                       "location": ev.get("location"), "winner": winner,
                       "circuit": ev["circuit"]})

    return {
        "generated": now.strftime("%Y-%m-%d %H:%M UTC"),
        "season": season,
        "standings": standings,
        "caption_leaders_ref": caption_leaders,
        "recent_events": recent,
        "news": news[:10],
    }


def main():
    events = merge_events()
    finals_history = load("dci_finals_history.json", [])
    finals_recaps = load("dci_finals_recaps.json", {})
    dca_champions = load("dca_champions.json", [])
    news = load("news.json", [])

    season_index = build_seasons(events)
    champions = build_champions(events, finals_history, dca_champions)
    corps_index = build_corps(events, finals_history)
    today = build_today(events, news)

    write_json("champions.json", champions)
    write_json("news.json", news)
    write_json("today.json", today)
    write_json("finals_history.json", finals_history)
    for year, text in finals_recaps.items():
        write_json(f"history/finals_recap_{year}.json", {"year": year, "text": text})

    write_json("meta.json", {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "seasons": {k: v for k, v in season_index.items()},
        "counts": {
            "events": len(events),
            "corps": len(corps_index),
            "finals_years": len(finals_history),
            "recap_years": sorted(finals_recaps.keys()),
        },
        "sources": [
            {"name": "DCI.org (Competition Suite)", "url": "https://www.dci.org/scores"},
            {"name": "drum-corps.net archives", "url": "https://www.drum-corps.net"},
            {"name": "The Sound Machine DCI history", "url": "https://www.soundmachine.org/dci/dcihistory.htm"},
            {"name": "DCA / dcacorps.org", "url": "https://dcacorps.org"},
            {"name": "Wikipedia (DCA champions)", "url": "https://en.wikipedia.org/wiki/Drum_Corps_Associates"},
        ],
    })
    log("build_data complete")


if __name__ == "__main__":
    main()
