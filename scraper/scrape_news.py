"""News: DCI.org feed, DCA (dcacorps.org) news, drum-corps.net news feed.

Produces data/parsed/news.json: [{source, title, url, date, summary}]
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

from bs4 import BeautifulSoup

from common import ROOT, fetch, log, norm_space

PARSED = ROOT / "data" / "parsed"

FEEDS = [
    ("DCI", "https://www.dci.org/feed/"),
    ("drum-corps.net", "https://www.drum-corps.net/feed"),
    ("DCA", "https://dcacorps.org/feed/"),
]

HTML_FALLBACKS = [
    ("DCI", "https://www.dci.org/news/"),
    ("DCA", "https://dcacorps.org/news"),
]


def parse_rss(source: str, xml: str) -> list[dict]:
    items = []
    soup = BeautifulSoup(xml, "xml")
    for it in soup.find_all("item")[:40]:
        title = norm_space(it.title.get_text()) if it.title else None
        link = norm_space(it.link.get_text()) if it.link else None
        if not link and it.guid:
            link = norm_space(it.guid.get_text())
        date = None
        if it.pubDate:
            try:
                date = parsedate_to_datetime(it.pubDate.get_text()).astimezone(timezone.utc).strftime("%Y-%m-%d")
            except Exception:  # noqa: BLE001
                pass
        desc = ""
        if it.description:
            desc = norm_space(BeautifulSoup(it.description.get_text(), "lxml").get_text())[:300]
        if title and link:
            items.append({"source": source, "title": title, "url": link,
                          "date": date, "summary": desc})
    return items


def parse_news_html(source: str, base_url: str, html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    items = []
    seen = set()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        title = norm_space(a.get_text())
        if not title or len(title) < 25 or len(title) > 200:
            continue
        if not re.search(r"/(news|article|posts?)/", href):
            continue
        if href.startswith("/"):
            href = re.match(r"https?://[^/]+", base_url).group(0) + href
        if href in seen:
            continue
        seen.add(href)
        items.append({"source": source, "title": title, "url": href,
                      "date": None, "summary": ""})
    return items[:25]


if __name__ == "__main__":
    PARSED.mkdir(parents=True, exist_ok=True)
    all_items: list[dict] = []
    got_sources = set()
    for source, url in FEEDS:
        xml = fetch(url, force=True)
        if not xml:
            continue
        try:
            items = parse_rss(source, xml)
        except Exception as e:  # noqa: BLE001
            log(f"rss parse fail {url}: {e}")
            items = []
        if items:
            got_sources.add(source)
            all_items += items
    for source, url in HTML_FALLBACKS:
        if source in got_sources:
            continue
        html = fetch(url, force=True)
        if html:
            try:
                all_items += parse_news_html(source, url, html)
            except Exception as e:  # noqa: BLE001
                log(f"html news parse fail {url}: {e}")

    # de-dup by URL, newest first (undated items keep insertion order, listed after dated)
    seen = {}
    for it in all_items:
        seen.setdefault(it["url"], it)
    items = list(seen.values())
    items.sort(key=lambda x: x["date"] or "0000-00-00", reverse=True)
    (PARSED / "news.json").write_text(json.dumps(items[:120], ensure_ascii=False, indent=1))
    log(f"news: {len(items)} items from {len(got_sources)} feeds (+fallbacks)")
