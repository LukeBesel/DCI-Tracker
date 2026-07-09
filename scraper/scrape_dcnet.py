"""Scrape drum-corps.net score archives (DCI 2001+, DCA 2001+).

Enumerates entries via category pagination (allowed by robots.txt; /wp-* and
query strings are disallowed so we never touch wp-json or ?p= URLs).

Produces data/parsed/dcnet_dci.json and data/parsed/dcnet_dca.json.
"""
from __future__ import annotations

import argparse
import json
import re

from bs4 import BeautifulSoup

from common import ROOT, fetch, log, norm_space, canon_corps

PARSED = ROOT / "data" / "parsed"
BASE = "https://www.drum-corps.net"

DIVISION_WORDS = re.compile(
    r"^(world class|open class|all[- ]age|a class|class a|div(?:ision)? ?(i{1,3}|1|2|3)|dci|dca|international|exhibition|soundsport|mini[- ]?corps)\b",
    re.I)


def list_entry_urls(circuit: str) -> list[str]:
    """Walk /category/scores/<circuit>/page/N collecting entry URLs."""
    urls: set[str] = set()
    page = 1
    while page < 200:
        u = f"{BASE}/category/scores/{circuit}" + (f"/page/{page}" if page > 1 else "")
        html = fetch(u, force=(page == 1))
        if not html:
            break
        found = re.findall(rf"{BASE}/scores/{circuit}/(\d+)", html)
        before = len(urls)
        for fid in found:
            urls.add(f"{BASE}/scores/{circuit}/{fid}")
        # stop when a page adds nothing new and pagination link for next page absent
        has_next = re.search(rf"/category/scores/{circuit}/page/{page + 1}", html)
        if not has_next and len(urls) == before and page > 1:
            break
        if not has_next:
            break
        page += 1
    log(f"{circuit}: {len(urls)} entries across {page} listing pages")
    return sorted(urls, key=lambda x: int(x.rsplit("/", 1)[1]))


def parse_entry(url: str, html: str) -> dict | None:
    soup = BeautifulSoup(html, "lxml")
    h1 = soup.find("h1") or soup.find("h2")
    title = norm_space(h1.get_text()) if h1 else ""
    m = re.search(r"\((\d{4})\)", title) or re.search(r"\b(19[6-9]\d|20[0-2]\d)\b", title)
    year = int(m.group(1)) if m else None
    name = re.sub(r"\s*\(\d{4}\)\s*$", "", title)
    name = re.sub(r"^\d{4}\s+", "", name)

    text_nodes = soup.get_text("\n", strip=True).split("\n")
    ev = {"url": url, "name": name, "year": year, "classes": []}

    # location/date lines commonly near the top: "July 4, 2008 - Somewhere, ST"
    for line in text_nodes[:40]:
        dm = re.search(r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}", line)
        if dm and "date_display" not in ev:
            ev["date_display"] = dm.group(0)
        lm = re.search(r"([A-Za-z .'-]+,\s*[A-Z]{2})\s*$", line)
        if lm and "location" not in ev and len(line) < 60 and not re.search(r"\d\.\d", line):
            ev["location"] = norm_space(lm.group(1))

    # Results: lines like "1. Corps Name 88.10" possibly grouped under
    # division headings; also HTML tables. Handle both.
    cur = None

    def ensure(cls_name):
        nonlocal cur
        cls_name = norm_space(cls_name)
        for c in ev["classes"]:
            if c["class"].lower() == cls_name.lower():
                cur = c
                return
        cur = {"class": cls_name, "results": []}
        ev["classes"].append(cur)

    for table in soup.find_all("table"):
        head = None
        for prev in table.find_all_previous(["h2", "h3", "h4", "strong", "b"]):
            t = norm_space(prev.get_text())
            if DIVISION_WORDS.search(t):
                head = t
                break
        ensure(head or "Results")
        for tr in table.find_all("tr"):
            tds = [norm_space(td.get_text()) for td in tr.find_all("td")]
            if len(tds) < 2:
                continue
            joined = " | ".join(tds)
            pm = re.match(r"^(\d{1,2})\.?$", tds[0])
            sm = re.search(r"(\d{1,3}\.\d{1,3})", joined)
            names = [t for t in tds if t and not re.fullmatch(r"[\d.|]+", t)]
            if sm and names:
                cur["results"].append({
                    "place": int(pm.group(1)) if pm else len(cur["results"]) + 1,
                    "corps": canon_corps(names[0]),
                    "score": float(sm.group(1)),
                })

    if not any(c["results"] for c in ev["classes"]):
        ev["classes"] = []
        cur = None
        line_pat = re.compile(r"^\s*(\d{1,2})[.):]?\s+(.+?)\s+(\d{1,3}\.\d{1,3})\s*$")
        for line in text_nodes:
            t = norm_space(line)
            if DIVISION_WORDS.search(t) and len(t) < 45 and not line_pat.match(t):
                ensure(t)
                continue
            m2 = line_pat.match(t)
            if m2:
                if cur is None:
                    ensure("Results")
                cur["results"].append({
                    "place": int(m2.group(1)),
                    "corps": canon_corps(m2.group(2)),
                    "score": float(m2.group(3)),
                })

    ev["classes"] = [c for c in ev["classes"] if c["results"]]
    return ev if ev["classes"] else None


def run(circuit: str, force_first_pages: bool):
    PARSED.mkdir(parents=True, exist_ok=True)
    out_path = PARSED / f"dcnet_{circuit}.json"
    existing = {}
    if out_path.exists():
        for e in json.loads(out_path.read_text()):
            existing[e["url"]] = e

    events = []
    urls = list_entry_urls(circuit)
    for i, url in enumerate(urls):
        if url in existing and not force_first_pages:
            events.append(existing[url])
            continue
        html = fetch(url)
        if not html:
            continue
        try:
            ev = parse_entry(url, html)
        except Exception as e:  # noqa: BLE001
            log(f"PARSE FAIL {url}: {e}")
            ev = None
        if ev:
            events.append(ev)
        if (i + 1) % 50 == 0:
            log(f"...{i + 1}/{len(urls)}")

    events.sort(key=lambda e: (e.get("year") or 0, e.get("date_display") or ""))
    out_path.write_text(json.dumps(events, ensure_ascii=False, indent=1))
    log(f"wrote {out_path} with {len(events)} events")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--circuit", choices=["dci", "dca", "both"], default="both")
    ap.add_argument("--refresh", action="store_true",
                    help="re-parse all cached entries (parser changes)")
    args = ap.parse_args()
    for c in (["dci", "dca"] if args.circuit == "both" else [args.circuit]):
        run(c, args.refresh)
