#!/usr/bin/env python3
"""WGI scores from WGI's own public JSON API.

Source
------
wgiserver.org is the API that wgi.org's own public scores pages call. It
carries no robots restrictions (its robots.txt is the Cloudflare
content-signal preamble with no directives and no signals set), so the
endpoints below are fetched directly.

wgi.org's robots.txt DOES disallow /event/, /show/, /season/, /group/,
/orgs/, /events/, /group_seasons/, /group_season_show/ and /venue/. Nothing
here touches any of those — the only wgi.org paths used are /scores/... for
human-facing links, which is allowed.

Endpoints
---------
  /v1/seasonapi=<key>?Division=<D>&SeasonId=<sid>  -> events in a season
  /v1/showapi=<key>?Division=<D>&ShowId=<showid>   -> results by class + RecapURL

A season's events are listed per division, but one calendar event often hosts
more than one division (Type__c "Color Guard, Percussion, and Winds"), so the
three division passes are merged on show-id-key into a single event carrying
one class group per division+class.

RecapURL points at recaps.competitionsuite.com — the same recap format
scrape_compsuite.parse_recap already handles for DCI — so judge-level caption
detail is parsed by that existing, already-verified code rather than a second
implementation.

Coverage
--------
The API is backed by Salesforce season records that only exist from 2024 on.
2023 and earlier live on older, differently-shaped wgi.org pages and are NOT
covered here; 2020-2022 have no historical page at all (the 2020 and 2021
seasons were cut short, and 2022 sits at a bespoke URL). SEASONS therefore
lists only what this source can actually answer for — a year absent from it
yields no events rather than a half-parsed guess.
"""
from __future__ import annotations

import argparse
import json
import re
from typing import Any

from common import ROOT, fetch, log, norm_space, slugify

PARSED = ROOT / "data" / "parsed"

API_KEY = "pvk7syNgSZbCyTtTf_tWAw"
BASE = "https://wgiserver.org/v1"
DIVISIONS = ("Guard", "Percussion", "Winds")

# Division label as it should read in the app (the API's param spelling is
# terse; "Guard" alone is ambiguous next to DCI's colour guard caption).
DIVISION_LABEL = {"Guard": "Color Guard", "Percussion": "Percussion", "Winds": "Winds"}

# Salesforce season ids, harvested from the robots-allowed historical pages.
# A year is listed only when the API genuinely answers for it.
SEASONS: dict[int, str] = {
    2027: "a0sUy000002CVwXIAW",   # current season — empty until it starts
    2026: "a0sUy000001dAGfIAM",
    2025: "a0sUy0000007hTFIAY",
    2024: "a0s4P00000f8CALQA2",
}

SCORE_RE = re.compile(r"^\s*-?\d+(?:\.\d+)?\s*$")


def _api(kind: str, **params) -> Any:
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    raw = fetch(f"{BASE}/{kind}={API_KEY}?{qs}", accept_json=True)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        log(f"wgi: non-JSON from {kind} {params}")
        return None


def season_events(season_id: str, division: str) -> list[dict]:
    d = _api("seasonapi", Division=division, SeasonId=season_id)
    return d if isinstance(d, list) else []


def show_detail(show_id: str, division: str) -> dict | None:
    d = _api("showapi", Division=division, ShowId=show_id)
    return d if isinstance(d, dict) else None


def _score(row: dict) -> float | None:
    """A group's score, or None when WGI is withholding it.

    gss_bool_Hide_Score__c / gss_bool_Score_Display__c are the source's own
    display flags; a withheld score is dropped rather than shown as 0.
    """
    if row.get("gss_bool_Hide_Score__c") is True:
        return None
    if row.get("gss_bool_Score_Display__c") is False:
        return None
    raw = norm_space(str(row.get("gss_cs_score__c") or ""))
    if not raw or not SCORE_RE.match(raw):
        return None
    try:
        v = float(raw)
    except ValueError:
        return None
    return v if v > 0 else None


def _group_name(row: dict) -> str:
    return norm_space(str(row.get("backend_Group_Friendly_Name__c") or "")) or ""


def _results(detail: dict, division: str) -> list[dict]:
    """showapi Results -> the app's [{class, division, results:[...]}] shape."""
    out = []
    for cls, rounds in (detail.get("Results") or {}).items():
        cls = norm_space(cls)
        if not cls or not isinstance(rounds, dict):
            continue
        rows: list[dict] = []
        # a show's rounds are keyed "Round 0", "Round 1", ...; the groups are
        # the same ensembles re-scored, so take the LAST round that has scores
        for _, group_rows in sorted(rounds.items()):
            if not isinstance(group_rows, list):
                continue
            cand = []
            for g in group_rows:
                if not isinstance(g, dict):
                    continue
                name, sc = _group_name(g), _score(g)
                if not name or sc is None:
                    continue
                cand.append({"place": g.get("Placement"), "corps": name, "score": sc})
            if cand:
                rows = cand
        if not rows:
            continue
        # trust the source's Placement when it is a clean 1..n, else rank by score
        places = [r["place"] for r in rows]
        if sorted(p for p in places if isinstance(p, int)) != list(range(1, len(rows) + 1)):
            rows.sort(key=lambda r: -r["score"])
            for i, r in enumerate(rows, 1):
                r["place"] = i
        else:
            rows.sort(key=lambda r: r["place"])
        out.append({"class": cls, "division": DIVISION_LABEL.get(division, division),
                    "results": rows})
    return out


def _event_url(show_id: str, division: str) -> str:
    """Human-facing WGI page for the show — under /scores/, which robots allows."""
    page = {"Guard": "color-guard", "Percussion": "percussion", "Winds": "winds"}[division]
    return f"https://www.wgi.org/scores/{page}-score-event?ShowId={show_id}"


def build_year(year: int, limit: int | None = None) -> list[dict]:
    season_id = SEASONS.get(year)
    if not season_id:
        log(f"wgi: no season id for {year} — this source does not cover it")
        return []

    merged: dict[str, dict] = {}
    for division in DIVISIONS:
        evs = season_events(season_id, division)
        log(f"wgi {year} {division}: {len(evs)} events listed")
        for i, ev in enumerate(evs):
            if limit and i >= limit:
                break
            show_id = norm_space(str(ev.get("show-id-key") or ""))
            name = norm_space(str(ev.get("Name") or ""))
            iso = norm_space(str(ev.get("Show_Date__c") or ""))[:10]
            if not show_id or not name:
                continue
            detail = show_detail(show_id, division)
            if not detail:
                continue
            classes = _results(detail, division)
            if not classes:
                continue
            slug = f"wgi-{year}-{slugify(name)}"
            cur = merged.get(show_id)
            if cur is None:
                cur = merged[show_id] = {
                    "url": _event_url(show_id, division),
                    "slug": slug,
                    "year": year,
                    "circuit": "WGI",
                    "name": name,
                    "date_display": norm_space(str(detail.get("ShowDate") or "")) or iso,
                    "date_iso": iso,
                    "location": "",
                    "recap_url": norm_space(str(detail.get("RecapURL") or "")),
                    "classes": [],
                    "source": "wgi.org",
                }
            cur["classes"].extend(classes)
            if not cur.get("recap_url") and detail.get("RecapURL"):
                cur["recap_url"] = norm_space(str(detail["RecapURL"]))

    events = sorted(merged.values(), key=lambda e: (e.get("date_iso") or "", e["name"]))
    log(f"wgi {year}: {len(events)} events with results "
        f"({sum(len(e['classes']) for e in events)} class groups)")
    return events


def main(years: list[int], limit: int | None = None) -> int:
    all_events: list[dict] = []
    for y in years:
        all_events.extend(build_year(y, limit=limit))
    PARSED.mkdir(parents=True, exist_ok=True)
    out = PARSED / "wgi_events.json"
    out.write_text(json.dumps(all_events, indent=1, ensure_ascii=False))
    log(f"wgi: wrote {len(all_events)} events -> {out}")
    return len(all_events)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--year", type=int, action="append",
                    help="season year (repeatable); default: every covered year")
    ap.add_argument("--limit", type=int, default=None,
                    help="cap events per division (smoke tests)")
    a = ap.parse_args()
    main(a.year or sorted(SEASONS, reverse=True), limit=a.limit)
