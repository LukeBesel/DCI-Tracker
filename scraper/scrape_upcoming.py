"""Scrape dci.org upcoming events + lineups for the homepage.

Discovery: event-sitemap.xml lists /events/<year>-<slug>/ pages.
Each event page: h1 = name, "City, ST" text after the h1, first
"Month D, YYYY" in the body = event date, and a "Lineup & Times" table
whose rows are [time, "Corps - City, ST"] mixed with non-performance
rows (Gates Open, Intermission, Encore, Scores Announced …).

Output: data/parsed/dci_upcoming.json
  [{name, date, date_display, location, url, lineup: [corps, …]}, …]

Only current-season pages are fetched; pages whose cached copy parses to
a date in the future (or very recent past) are re-fetched fresh so
lineups stay current.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

from bs4 import BeautifulSoup

from common import ROOT, fetch, log, norm_space, canon_corps, cache_path

PARSED = ROOT / "data" / "parsed"
SITEMAP = "https://www.dci.org/event-sitemap.xml"

MONTHS = {m: i + 1 for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"])}
DATE_PAT = re.compile(
    r"(January|February|March|April|May|June|July|August|September|October|November|December)"
    r"\s+(\d{1,2}),?\s+(\d{4})")
NON_PERFORMANCE = re.compile(
    r"gates open|welcome|national anthem|intermission|scores? announced|"
    r"age.?out recognition|encore|award|color guard|honor guard|pledge|"
    r"opening ceremon|closing ceremon|drum major|meeting|clinic|autograph", re.I)


def iso_from_display(disp: str) -> str | None:
    m = DATE_PAT.search(disp or "")
    if not m:
        return None
    return f"{int(m.group(3)):04d}-{MONTHS[m.group(1)]:02d}-{int(m.group(2)):02d}"


def parse_event_page(url: str, html: str) -> dict | None:
    soup = BeautifulSoup(html, "lxml")
    ev: dict = {"url": url}

    h1 = soup.find("h1")
    if not h1:
        return None
    ev["name"] = norm_space(h1.get_text())

    # location: first "City, ST" style text after the h1
    for el in h1.find_all_next(string=True)[:60]:
        t = norm_space(str(el))
        if re.fullmatch(r"[A-Za-z .'’-]+,\s*[A-Z]{2}", t):
            ev["location"] = t
            break

    body_txt = soup.get_text(" ", strip=True)
    dm = DATE_PAT.search(body_txt)
    if dm:
        ev["date_display"] = f"{dm.group(1)} {dm.group(2)}, {dm.group(3)}"
        ev["date"] = iso_from_display(ev["date_display"])

    # lineup table under the "Lineup & Times" heading; the full timed
    # schedule (gates, step-offs, intermission, scores announced) rides along
    lineup: list[str] = []
    schedule: list[list[str]] = []
    head = soup.find(lambda t: t.name in ("h2", "h3") and "lineup" in t.get_text().lower())
    if head:
        table = head.find_next("table")
        if table:
            for tr in table.find_all("tr"):
                cells = [norm_space(td.get_text(" ", strip=True)) for td in tr.find_all(["td", "th"])]
                if len(cells) < 2:
                    continue
                time_s, entry = cells[0], cells[-1]
                if not entry:
                    continue
                if NON_PERFORMANCE.search(entry):
                    if len(schedule) < 60:
                        schedule.append([time_s, entry])
                    continue
                # "Corps Name - City, ST" (city part optional)
                name = re.split(r"\s+-\s+", entry)[0]
                name = norm_space(name)
                if not name or len(name) > 60:
                    continue
                cname = canon_corps(name)
                if cname and cname not in lineup:
                    lineup.append(cname)
                    if len(schedule) < 60:
                        schedule.append([time_s, cname])
    ev["lineup"] = lineup
    if schedule and any(t for t, _ in schedule):
        ev["schedule"] = schedule
    return ev if ev.get("date") else None


def main():
    PARSED.mkdir(parents=True, exist_ok=True)
    today = datetime.now(timezone.utc).date()

    xml = fetch(SITEMAP, force=True) or ""
    urls = sorted(set(re.findall(r"<loc>\s*([^<]+/events/[^<]+)\s*</loc>", xml)))
    season = [u for u in urls if re.search(rf"/events/{today.year}-", u)]
    log(f"event sitemap lists {len(urls)} pages, {len(season)} for {today.year}")

    out = []
    for url in season:
        html = fetch(url)
        if not html:
            continue
        try:
            ev = parse_event_page(url, html)
        except Exception as e:  # noqa: BLE001
            log(f"PARSE FAIL {url}: {e}")
            continue
        if not ev:
            continue
        # future events: refresh from a cached copy so lineups stay current
        evd = datetime.strptime(ev["date"], "%Y-%m-%d").date()
        if evd >= today - timedelta(days=1) and cache_path(url).exists():
            fresh = fetch(url, force=True)
            if fresh:
                try:
                    ev = parse_event_page(url, fresh) or ev
                except Exception:  # noqa: BLE001
                    pass
        out.append(ev)

    out.sort(key=lambda e: (e.get("date") or "", e.get("name") or ""))
    p = PARSED / "dci_upcoming.json"
    p.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    future = sum(1 for e in out if e["date"] >= str(today))
    log(f"wrote {p}: {len(out)} events, {future} upcoming")


if __name__ == "__main__":
    main()
