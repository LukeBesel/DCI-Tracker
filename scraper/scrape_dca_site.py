"""DCA official site scores (recent seasons + current).

dcacorps.org publishes score pages per year/event. Structure varies, so we
discover /scores/ links from the scores index and parse tables/lists
defensively. Produces data/parsed/dca_site.json (same event shape as others).
"""
from __future__ import annotations

import json
import re

from bs4 import BeautifulSoup

from common import ROOT, fetch, log, norm_space, canon_corps

PARSED = ROOT / "data" / "parsed"
BASE = "https://dcacorps.org"


def discover_score_pages() -> list[str]:
    urls = set()
    for start in [f"{BASE}/scores/scores", f"{BASE}/scores"]:
        html = fetch(start, force=True)
        if not html:
            continue
        for m in re.finditer(r'href="([^"]*scores[^"#?]*)"', html):
            u = m.group(1)
            if u.startswith("/"):
                u = BASE + u
            if u.startswith(BASE) and "mailto" not in u:
                urls.add(u.rstrip("/"))
    log(f"dca site: {len(urls)} candidate score pages")
    return sorted(urls)


def parse_page(url: str, html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    title_el = soup.find("h1") or soup.find("title")
    page_title = norm_space(title_el.get_text()) if title_el else url
    ym = re.search(r"\b(20[12]\d)\b", page_title + " " + url)
    year = int(ym.group(1)) if ym else None

    events = []
    cur_event = None
    cur_class = None

    def new_event(name):
        nonlocal cur_event, cur_class
        cur_event = {"url": url, "name": norm_space(name), "year": year, "classes": []}
        cur_class = None
        events.append(cur_event)

    for el in soup.find_all(["h1", "h2", "h3", "h4", "table", "p", "li"]):
        t = norm_space(el.get_text())
        if el.name in ("h1", "h2", "h3", "h4"):
            if re.search(r"(championship|prelim|final|invitational|show|classic|review|showcase|celebration)", t, re.I) and len(t) < 90:
                new_event(t)
            elif re.match(r"^(open class|class a|world class|all[- ]age|mini[- ]?corps|exhibition|alumni)", t, re.I):
                cur_class = t
            continue
        if el.name == "table":
            if cur_event is None:
                new_event(page_title)
            rows = []
            for tr in el.find_all("tr"):
                tds = [norm_space(td.get_text()) for td in tr.find_all("td")]
                if len(tds) < 2:
                    continue
                sm = [x for x in tds if re.fullmatch(r"\d{1,3}\.\d{1,3}", x)]
                names = [x for x in tds if x and not re.fullmatch(r"[\d.]+", x)]
                pm = re.fullmatch(r"\d{1,2}", tds[0])
                if sm and names:
                    rows.append({"place": int(tds[0]) if pm else len(rows) + 1,
                                 "corps": canon_corps(names[0]),
                                 "score": float(sm[-1])})
            if rows:
                cur_event["classes"].append({"class": cur_class or "Open Class", "results": rows})
                cur_class = None
            continue
        # plain-text rows "1. Corps 87.5"
        m = re.match(r"^(\d{1,2})[.)]\s+(.+?)\s+(\d{2,3}\.\d{1,3})$", t)
        if m:
            if cur_event is None:
                new_event(page_title)
            if not cur_event["classes"] or cur_event["classes"][-1].get("_txt") is not True:
                cur_event["classes"].append({"class": cur_class or "Open Class", "results": [], "_txt": True})
            cur_event["classes"][-1]["results"].append({
                "place": int(m.group(1)), "corps": canon_corps(m.group(2)),
                "score": float(m.group(3))})

    out = []
    for e in events:
        for c in e["classes"]:
            c.pop("_txt", None)
        e["classes"] = [c for c in e["classes"] if c["results"]]
        if e["classes"]:
            out.append(e)
    return out


if __name__ == "__main__":
    PARSED.mkdir(parents=True, exist_ok=True)
    all_events = []
    for url in discover_score_pages():
        html = fetch(url, force=True)
        if not html:
            continue
        try:
            all_events += parse_page(url, html)
        except Exception as e:  # noqa: BLE001
            log(f"PARSE FAIL {url}: {e}")
    (PARSED / "dca_site.json").write_text(json.dumps(all_events, ensure_ascii=False, indent=1))
    log(f"dca site: {len(all_events)} events parsed")
