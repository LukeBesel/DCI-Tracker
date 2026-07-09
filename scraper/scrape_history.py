"""Historical DCI finals (1972-2004) from soundmachine.org, plus DCA
championship history from Wikipedia, plus DCI champions cross-check from
dci.org.

Produces:
  data/parsed/dci_finals_history.json  [{year, results:[{place, corps, score, repertoire}], notes}]
  data/parsed/dci_finals_recaps.json   {year: raw preformatted recap text}
  data/parsed/dca_champions.json       [{year, corps, score, location}]
"""
from __future__ import annotations

import json
import re

from bs4 import BeautifulSoup

from common import ROOT, fetch, log, norm_space, canon_corps

PARSED = ROOT / "data" / "parsed"

SM_HISTORY = "https://www.soundmachine.org/dci/dcihistory.htm"


def parse_soundmachine() -> tuple[list[dict], dict]:
    html = fetch(SM_HISTORY, force=True)
    if not html:
        log("soundmachine history unavailable")
        return [], {}
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text("\n")
    lines = [l.rstrip() for l in text.split("\n")]

    years: list[dict] = []
    cur = None
    # Year headings look like "1972" or "1972 - Whitewater, WI" etc.
    year_pat = re.compile(r"^\s*(19[7-9]\d|200[0-4])\b(.*)$")
    # result rows: "1. 88.10 Anaheim Kingsmen ..." or "1 88.100 Corps - repertoire"
    row_pat = re.compile(r"^\s*(\d{1,2})[.)]?\s+(\d{2,3}\.\d{1,3})\s+(.+)$")
    row_pat2 = re.compile(r"^\s*(\d{1,2})[.)]?\s+(.+?)\s+(\d{2,3}\.\d{1,3})\s*$")

    for line in lines:
        t = norm_space(line)
        ym = year_pat.match(t)
        if ym and len(t) < 60 and not row_pat.match(t):
            cur = {"year": int(ym.group(1)), "heading": t, "results": []}
            years.append(cur)
            continue
        if cur is None:
            continue
        m = row_pat.match(t)
        corps_rep = None
        if m:
            place, score, corps_rep = int(m.group(1)), float(m.group(2)), m.group(3)
        else:
            m = row_pat2.match(t)
            if m:
                place, corps_rep, score = int(m.group(1)), m.group(2), float(m.group(3))
        if m and corps_rep:
            # split "Corps Name - Repertoire" if present
            parts = re.split(r"\s+[-–—]\s+", corps_rep, maxsplit=1)
            corps = canon_corps(parts[0])
            rep = norm_space(parts[1]) if len(parts) > 1 else None
            if 1 <= place <= 30 and 40 <= score <= 100:
                cur["results"].append({"place": place, "corps": corps,
                                       "score": score, "repertoire": rep})

    # de-dup years that appear twice in prose; keep the one with most results
    by_year: dict[int, dict] = {}
    for y in years:
        if y["results"] and (y["year"] not in by_year or len(y["results"]) > len(by_year[y["year"]]["results"])):
            by_year[y["year"]] = y

    # per-year caption recap pages (preformatted text, keep raw)
    recaps = {}
    for yr in sorted(by_year):
        yy = str(yr)[2:]
        html2 = fetch(f"https://www.soundmachine.org/dci/{yy}recaps.htm")
        if html2:
            s2 = BeautifulSoup(html2, "lxml")
            pre = "\n\n".join(p.get_text() for p in s2.find_all("pre")) or s2.get_text("\n")
            recaps[str(yr)] = pre[:60000]

    out = [{"year": y["year"], "results": y["results"]} for y in
           sorted(by_year.values(), key=lambda x: x["year"])]
    log(f"soundmachine: {len(out)} years, {len(recaps)} recap pages")
    return out, recaps


def parse_dca_champions() -> list[dict]:
    """DCA champions table from Wikipedia (Drum Corps Associates article)."""
    html = fetch("https://en.wikipedia.org/wiki/Drum_Corps_Associates", force=True)
    if not html:
        return []
    soup = BeautifulSoup(html, "lxml")
    out = []
    for table in soup.find_all("table"):
        head = " ".join(norm_space(th.get_text()).lower() for th in table.find_all("th")[:8])
        if "champion" not in head and "year" not in head:
            continue
        for tr in table.find_all("tr"):
            cells = [norm_space(c.get_text()) for c in tr.find_all(["td", "th"])]
            if len(cells) < 2:
                continue
            ym = re.match(r"^(19[6-9]\d|20[0-2]\d)", cells[0])
            if not ym:
                continue
            year = int(ym.group(1))
            corps = None
            score = None
            loc = None
            for c in cells[1:]:
                if corps is None and c and not re.match(r"^[\d.]+$", c):
                    corps = canon_corps(re.sub(r"\[\d+\]", "", c))
                sm = re.fullmatch(r"(\d{2,3}\.\d{1,3})", c)
                if sm:
                    score = float(sm.group(1))
                if re.search(r",\s*[A-Z]{2}\b", c) and c != corps:
                    loc = c
            if corps:
                out.append({"year": year, "corps": corps, "score": score, "location": loc})
    # dedupe by year keeping first (main champions table)
    seen = {}
    for r in out:
        seen.setdefault(r["year"], r)
    res = sorted(seen.values(), key=lambda r: r["year"])
    log(f"DCA champions: {len(res)} years")
    return res


if __name__ == "__main__":
    PARSED.mkdir(parents=True, exist_ok=True)
    finals, recaps = parse_soundmachine()
    (PARSED / "dci_finals_history.json").write_text(json.dumps(finals, ensure_ascii=False, indent=1))
    (PARSED / "dci_finals_recaps.json").write_text(json.dumps(recaps, ensure_ascii=False))
    (PARSED / "dca_champions.json").write_text(json.dumps(parse_dca_champions(), ensure_ascii=False, indent=1))
    log("history scrape complete")
