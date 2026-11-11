#!/usr/bin/env python3
"""WGI World Championship finals, 1980-2023, from wgi.org's historical pages.

Why this exists alongside scrape_wgi.py
---------------------------------------
The wgiserver.org API only has season records from 2024 on. Everything older
lives on wgi.org/historical_scores/<year>/ — one page per year, allowed by
robots (the disallowed paths are /event/, /show/, /season/, /group/, /orgs/,
none of which are touched here).

Those pages carry World Championship FINALS only — not the regionals — and
only Color Guard. Percussion and Winds history is not published in that
series, and Winds did not exist before 2015. So this source answers exactly
one question per year, and the events it emits say so in their name rather
than pretending to be a full season.

Known gaps, all WGI's rather than this parser's:
  2014        wgi.org serves a 404 for it; the season is simply not online.
  2020, 2021  no championship to publish — 2020 was cancelled outright and
              2021 ran virtually.
  2022, 2023  published as a dated event listing at a different URL
              (/color-guard/cg-scores-<year>/) that renders no score tables
              at all, so there is nothing here to read.
Everything from 1980-2019 parses; a year that does not is skipped loudly.

Page shape
----------
    <h2>2004 INDEPENDENT WORLD</h2>
    <table><tr><th>Name</th><th>Score</th></tr>
           <tr><td>Fantasia</td><td>98.25</td></tr> ...

The heading's wording drifts across eras ("Name"/"Unit"/"Color Guard" column
headers; a trailing "*" marks a tie or a withdrawn unit) but the shape holds:
a class heading followed by its finals recap. A year whose page doesn't parse
into at least one class is skipped rather than half-emitted.
"""
from __future__ import annotations

import argparse
import json
import re
from html import unescape

from common import ROOT, fetch, log, norm_space, slugify

PARSED = ROOT / "data" / "parsed"

FIRST_YEAR, LAST_YEAR = 1980, 2023
PAGE = "https://www.wgi.org/historical_scores/{year}/"
DIVISION = "Color Guard"

# "2004 INDEPENDENT WORLD" -> "Independent World"
TIERS = ("World", "Open", "A")
AFFIL = ("Independent", "Scholastic")

H2 = re.compile(r"<h2[^>]*>(.*?)</h2>", re.I | re.S)
TABLE = re.compile(r"<table[^>]*>(.*?)</table>", re.I | re.S)
ROW = re.compile(r"<tr[^>]*>(.*?)</tr>", re.I | re.S)
CELL = re.compile(r"<t[dh][^>]*>(.*?)</t[dh]>", re.I | re.S)
TAGS = re.compile(r"<[^>]+>")
SCORE = re.compile(r"^(\d{1,3}(?:\.\d{1,3})?)$")


def _text(fragment: str) -> str:
    return norm_space(unescape(TAGS.sub(" ", fragment or "")))


def parse_class_heading(heading: str, year: int) -> str | None:
    """'2004 INDEPENDENT WORLD' -> 'Independent World'; None if not a class."""
    h = _text(heading)
    h = re.sub(rf"\b{year}\b", " ", h)
    h = norm_space(h)
    if not h:
        return None
    low = h.lower()
    affil = next((a for a in AFFIL if a.lower() in low), None)
    # tier: match the longest first so "World" isn't shadowed by "A"
    tier = None
    for t in TIERS:
        if re.search(rf"\b{t.lower()}\b", low):
            tier = t
            break
    if not affil or not tier:
        return None
    return f"{affil} {tier}"


def parse_rows(table_html: str) -> list[dict]:
    out = []
    for raw in ROW.findall(table_html):
        cells = [_text(c) for c in CELL.findall(raw)]
        if len(cells) < 2:
            continue
        name, score_raw = cells[0], cells[-1]
        # a trailing * marks a tie / withdrawn unit in these pages
        name = norm_space(name.rstrip("*").strip())
        score_raw = score_raw.replace(",", "").strip()
        if not name or not SCORE.match(score_raw):
            continue          # header row, or a note line
        if name.lower() in ("name", "unit", "color guard", "group", "ensemble"):
            continue
        try:
            score = float(score_raw)
        except ValueError:
            continue
        if score <= 0:
            continue
        out.append({"place": len(out) + 1, "corps": name, "score": score})
    return out


def parse_year(year: int, html: str) -> dict | None:
    """One event per year: that year's World Championship finals, all classes."""
    # pair each h2 with the table that follows it
    pieces = []
    for m in H2.finditer(html):
        cls = parse_class_heading(m.group(1), year)
        if cls:
            pieces.append((cls, m.end()))
    if not pieces:
        return None
    classes = []
    for cls, start in pieces:
        t = TABLE.search(html, start)
        if not t:
            continue
        rows = parse_rows(t.group(1))
        if rows:
            classes.append({"class": cls, "division": DIVISION, "results": rows})
    if not classes:
        return None
    name = f"WGI World Championships {year}"
    return {
        "url": PAGE.format(year=year),
        "slug": f"wgi-{year}-world-championships",
        "year": year,
        "circuit": "WGI",
        "name": name,
        "date_display": f"{year}",
        "date_iso": "",                 # the pages carry no date, only the year
        "location": "",
        "recap_url": "",
        "classes": classes,
        "source": "wgi.org",
        "finals_only": True,            # NOT a full season — championships only
    }


def main(years: list[int]) -> int:
    events = []
    for year in years:
        html = fetch(PAGE.format(year=year))
        if not html:
            log(f"wgi history {year}: page unavailable")
            continue
        ev = parse_year(year, html)
        if not ev:
            log(f"wgi history {year}: no classes parsed — skipped")
            continue
        groups = sum(len(c["results"]) for c in ev["classes"])
        log(f"wgi history {year}: {len(ev['classes'])} classes, {groups} units")
        events.append(ev)

    PARSED.mkdir(parents=True, exist_ok=True)
    out = PARSED / "wgi_history_events.json"
    out.write_text(json.dumps(events, indent=1, ensure_ascii=False))
    log(f"wgi history: wrote {len(events)} seasons -> {out}")
    return len(events)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--year", type=int, action="append", help="single year (repeatable)")
    ap.add_argument("--from", dest="start", type=int, default=FIRST_YEAR)
    ap.add_argument("--to", dest="end", type=int, default=LAST_YEAR)
    a = ap.parse_args()
    main(a.year or list(range(a.end, a.start - 1, -1)))
