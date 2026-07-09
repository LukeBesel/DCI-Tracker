"""Scrape dci.org: competition sitemaps -> final-scores pages -> recap pages.

Produces data/parsed/dci_events.json (list of event dicts with results and
caption recaps). Covers 2013-present (everything dci.org publishes).

Usage:
  python scrape_dci.py            # incremental: only fetch uncached pages
  python scrape_dci.py --season 2026 --force   # re-fetch one season (daily job)
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from bs4 import BeautifulSoup

from common import ROOT, fetch, log, norm_space, canon_corps

PARSED = ROOT / "data" / "parsed"

SITEMAP_INDEX = "https://www.dci.org/wp-sitemap.xml"


def get_competition_urls() -> list[str]:
    """All /scores/final-scores/ URLs from the competition sitemaps."""
    urls: list[str] = []
    idx = fetch(SITEMAP_INDEX, force=True)
    maps = re.findall(r"<loc>\s*([^<]+competition-sitemap\d*\.xml)\s*</loc>", idx or "")
    if not maps:
        maps = [f"https://www.dci.org/competition-sitemap{n}.xml" for n in ("", "2", "3")]
    for m in maps:
        xml = fetch(m, force=True)
        if not xml:
            continue
        urls += re.findall(r"<loc>\s*([^<]+/scores/final-scores/[^<]+)\s*</loc>", xml)
    urls = sorted(set(u.strip() for u in urls))
    log(f"found {len(urls)} competition URLs in sitemaps")
    return urls


def year_of(url: str) -> int | None:
    m = re.search(r"/final-scores/(\d{4})-", url)
    return int(m.group(1)) if m else None


def _clean_class_name(s: str) -> str:
    s = norm_space(s)
    s = re.sub(r"\s*(final scores|scores|results)\s*$", "", s, flags=re.I)
    return s


def parse_event_page(url: str, html: str) -> dict | None:
    soup = BeautifulSoup(html, "lxml")
    ev: dict = {"url": url, "slug": url.rstrip("/").split("/")[-1], "year": year_of(url)}

    h1 = soup.find("h1")
    title = norm_space(h1.get_text()) if h1 else ev["slug"].replace("-", " ").title()
    title = re.sub(r"^\d{4}\s+", "", title)
    ev["name"] = title

    text = soup.get_text(" ", strip=True)
    m = re.search(r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+(\d{4})", text)
    if m:
        ev["date_display"] = m.group(0)
    m = re.search(r"in\s+([A-Za-z .'-]+,\s*[A-Z]{2})\b", text)
    if m:
        ev["location"] = norm_space(m.group(1))

    recap_a = soup.find("a", string=re.compile(r"view full recap", re.I)) or \
              soup.find("a", href=re.compile(r"/scores/recap/"))
    if recap_a and recap_a.get("href"):
        href = recap_a["href"]
        if href.startswith("/"):
            href = "https://www.dci.org" + href
        ev["recap_url"] = href

    # Results tables: each class section is a heading followed by a table
    # with Place/Corps/Score columns. Parse generically.
    classes = []
    for table in soup.find_all("table"):
        headers = [norm_space(th.get_text()).lower() for th in table.find_all("th")]
        if not headers or "corps" not in " ".join(headers):
            continue
        # find nearest previous heading for the class name
        cls = None
        for prev in table.find_all_previous(["h2", "h3", "h4"]):
            t = _clean_class_name(prev.get_text())
            if t and not re.search(r"final scores|scores by|breadcrumb", t, re.I):
                cls = t
                break
        rows = []
        for tr in table.find_all("tr"):
            tds = [norm_space(td.get_text()) for td in tr.find_all("td")]
            if len(tds) < 2:
                continue
            place = corps = score = None
            nums = [t for t in tds if re.fullmatch(r"\d{1,2}", t)]
            scores = [t for t in tds if re.fullmatch(r"\d{1,3}\.\d{1,3}", t)]
            names = [t for t in tds if t and not re.fullmatch(r"[\d.]+", t)]
            if nums:
                place = int(nums[0])
            if scores:
                score = float(scores[-1])
            if names:
                corps = canon_corps(names[0])
            if corps and score is not None:
                rows.append({"place": place, "corps": corps, "score": score})
        if rows:
            for i, r in enumerate(rows):
                if r["place"] is None:
                    r["place"] = i + 1
            classes.append({"class": cls or "Results", "results": rows})
    ev["classes"] = classes
    return ev if classes else (ev if ev.get("recap_url") else None)


# ---------------- recap parsing (caption-level detail) ----------------

CAPTION_PAT = re.compile(
    r"(general effect|visual|color ?guard|music|brass|percussion|analysis|proficiency|guard|effect)", re.I)


def parse_recap_page(url: str, html: str) -> list[dict]:
    """Parse a dci.org recap page into per-class caption tables.

    Returns [{class, captions: [names...], rows: [{corps, total, place,
    caption_scores: {caption: {score, rank}}}]}]. Structure on dci.org is a
    wide table per class; we parse defensively and keep raw cell text if the
    layout surprises us.
    """
    soup = BeautifulSoup(html, "lxml")
    out = []
    for table in soup.find_all("table"):
        txt = table.get_text(" ", strip=True).lower()
        if not CAPTION_PAT.search(txt):
            continue
        cls = None
        for prev in table.find_all_previous(["h2", "h3", "h4"]):
            t = norm_space(prev.get_text())
            if t and len(t) < 60 and not re.search(r"recap|final scores|official", t, re.I):
                cls = t
                break

        # Header rows: captions often span two rows (caption name / sub-cols).
        thead_rows = table.find_all("tr")[:3]
        caption_names: list[str] = []
        for tr in thead_rows:
            cells = tr.find_all(["th", "td"])
            names = [norm_space(c.get_text()) for c in cells]
            cand = [n for n in names if CAPTION_PAT.search(n)]
            if len(cand) >= 3:
                caption_names = names
                break

        rows = []
        for tr in table.find_all("tr"):
            cells = [norm_space(c.get_text()) for c in tr.find_all("td")]
            if len(cells) < 4:
                continue
            name_cells = [c for c in cells[:3] if c and not re.fullmatch(r"[\d. ]+", c)]
            if not name_cells:
                continue
            corps = canon_corps(re.sub(r"\s*-\s*$", "", name_cells[0]))
            numbers = re.findall(r"\d{1,3}\.\d{1,3}", " ".join(cells))
            if not numbers or not corps or CAPTION_PAT.search(corps):
                continue
            total = max(float(n) for n in numbers)
            rows.append({"corps": corps, "total": total, "cells": cells})
        if rows:
            out.append({"class": cls or "Results", "captions": caption_names, "rows": rows})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=None, help="only this season")
    ap.add_argument("--force", action="store_true", help="re-fetch season pages even if cached")
    ap.add_argument("--since", type=int, default=2013)
    args = ap.parse_args()

    PARSED.mkdir(parents=True, exist_ok=True)
    existing_path = PARSED / "dci_events.json"
    existing: dict[str, dict] = {}
    if existing_path.exists():
        for e in json.loads(existing_path.read_text()):
            existing[e["url"]] = e

    urls = [u for u in get_competition_urls()
            if (year_of(u) or 0) >= args.since
            and (args.season is None or year_of(u) == args.season)]

    events = []
    for i, url in enumerate(urls):
        force = args.force and (args.season is None or year_of(url) == args.season)
        html = fetch(url, force=force)
        if html is None:
            if url in existing:
                events.append(existing[url])
            continue
        try:
            ev = parse_event_page(url, html)
        except Exception as e:  # noqa: BLE001
            log(f"PARSE FAIL event {url}: {e}")
            ev = None
        if not ev:
            continue
        if ev.get("recap_url"):
            rhtml = fetch(ev["recap_url"], force=force)
            if rhtml:
                try:
                    ev["recap"] = parse_recap_page(ev["recap_url"], rhtml)
                except Exception as e:  # noqa: BLE001
                    log(f"PARSE FAIL recap {ev['recap_url']}: {e}")
        events.append(ev)
        if (i + 1) % 25 == 0:
            log(f"...{i + 1}/{len(urls)} events")

    # merge with existing events outside the selected slice
    if args.season is not None:
        merged = {u: e for u, e in existing.items()}
        for e in events:
            merged[e["url"]] = e
        events = list(merged.values())

    events.sort(key=lambda e: (e.get("year") or 0, e.get("date_display") or "", e.get("name") or ""))
    existing_path.write_text(json.dumps(events, ensure_ascii=False, indent=1))
    log(f"wrote {existing_path} with {len(events)} events")


if __name__ == "__main__":
    main()
