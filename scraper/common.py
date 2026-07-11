"""Shared fetch/cache utilities for the DCI/DCA dashboard scrapers.

Design:
  - Every fetched page is cached gzipped under data/raw/ so parsing can be
    re-run offline and daily runs only fetch what changed.
  - Polite: rate-limited, identifies itself, retries with backoff.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import requests

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "docs" / "data"

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
RATE_LIMIT_SECONDS = 1.5

_session = requests.Session()
_session.headers.update({
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    # transparency about the automated fetcher without tripping bot walls
    "From": "dci-tracker bot https://github.com/LukeBesel/DCI-Tracker",
})
_last_fetch = [0.0]


def log(*args):
    print(*args, file=sys.stderr, flush=True)


def cache_path(url: str) -> Path:
    p = urlparse(url)
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "_", (p.path + ("_" + p.query if p.query else "")).strip("/"))[:180]
    h = hashlib.sha1(url.encode()).hexdigest()[:10]
    return RAW / p.netloc / f"{slug}_{h}.gz"


def fetch(url: str, *, force: bool = False, timeout: int = 30, retries: int = 4,
          accept_json: bool = False) -> str | None:
    """Fetch a URL with on-disk gzip cache. Returns text, or None on hard failure."""
    cp = cache_path(url)
    if cp.exists() and not force:
        with gzip.open(cp, "rt", encoding="utf-8", errors="replace") as f:
            return f.read()

    headers = {}
    if accept_json:
        headers["Accept"] = "application/json"

    delay = 5.0
    for attempt in range(retries):
        wait = RATE_LIMIT_SECONDS - (time.time() - _last_fetch[0])
        if wait > 0:
            time.sleep(wait)
        try:
            _last_fetch[0] = time.time()
            r = _session.get(url, timeout=timeout, headers=headers)
            if r.status_code == 404:
                log(f"404 {url}")
                return None
            if r.status_code in (403, 429):
                # bot-wall / throttle: back off hard before retrying
                retry_after = int(r.headers.get("Retry-After") or 0)
                pause = max(retry_after, 45 * (attempt + 1))
                log(f"{r.status_code} throttle on {url}; sleeping {pause}s")
                time.sleep(pause)
                continue
            if r.status_code >= 400:
                raise requests.HTTPError(f"{r.status_code} for {url}")
            text = r.text
            cp.parent.mkdir(parents=True, exist_ok=True)
            with gzip.open(cp, "wt", encoding="utf-8") as f:
                f.write(text)
            return text
        except Exception as e:  # noqa: BLE001
            log(f"fetch attempt {attempt + 1}/{retries} failed: {url}: {e}")
            time.sleep(delay)
            delay *= 2
    return None


def write_json(relpath: str, obj) -> None:
    p = OUT / relpath
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log(f"wrote {p} ({p.stat().st_size:,} bytes)")


def read_json(relpath: str, default=None):
    p = OUT / relpath
    if not p.exists():
        return default
    return json.loads(p.read_text(encoding="utf-8"))


def norm_space(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


# Canonical corps-name normalization: map common variants to one display name
# so per-corps history threads correctly across 50 years of typography.
CORPS_ALIASES = {
    "the cadets": "The Cadets",
    "cadets": "The Cadets",
    "holy name cadets": "The Cadets",
    "cadets of bergen county": "The Cadets",
    "garfield cadets": "The Cadets",
    "the cavaliers": "The Cavaliers",
    "cavaliers": "The Cavaliers",
    "the academy": "The Academy",
    "academy": "The Academy",
    "santa clara vanguard": "Santa Clara Vanguard",
    "vanguard": "Santa Clara Vanguard",
    "scv": "Santa Clara Vanguard",
    "27th lancers": "27th Lancers",
    "blue devils": "Blue Devils",
    "bluecoats": "Bluecoats",
    "phantom regiment": "Phantom Regiment",
    "madison scouts": "Madison Scouts",
    "the madison scouts": "Madison Scouts",
    "carolina crown": "Carolina Crown",
    "boston crusaders": "Boston Crusaders",
    "crossmen": "Crossmen",
    "blue knights": "Blue Knights",
    "blue stars": "Blue Stars",
    "colts": "Colts",
    "troopers": "Troopers",
    "spirit of atlanta": "Spirit of Atlanta",
    "spirit": "Spirit of Atlanta",
    "spirit from jsu": "Spirit of Atlanta",
    "mandarins": "Mandarins",
    "pacific crest": "Pacific Crest",
    "music city": "Music City",
    "genesis": "Genesis",
    "seattle cascades": "Seattle Cascades",
    "cascades": "Seattle Cascades",
    "jersey surf": "Jersey Surf",
    "the battalion": "The Battalion",
    "battalion": "The Battalion",
    "golden empire": "Golden Empire",
    "gold": "Gold",
    "guardians": "Guardians",
    "vessel": "Vessel",
    "impulse": "Impulse",
    "vanguard cadets": "Vanguard Cadets",
    "santa clara vanguard cadets": "Vanguard Cadets",
    "blue devils b": "Blue Devils B",
    "blue devils c": "Blue Devils C",
    "star of indiana": "Star of Indiana",
    "suncoast sound": "Suncoast Sound",
    "sky ryders": "Sky Ryders",
    "velvet knights": "Velvet Knights",
    "freelancers": "Freelancers",
    "north star": "North Star",
    "bridgemen": "Bridgemen",
    "crossmen of san antonio": "Crossmen",
    "glassmen": "Glassmen",
    "kiwanis kavaliers": "Kiwanis Kavaliers",
    "carolina gold": "Carolina Gold",
    "atlanta cv": "Atlanta CV",
    "cv": "Atlanta CV",
    "reading buccaneers": "Reading Buccaneers",
    "buccaneers": "Reading Buccaneers",
    "hawthorne caballeros": "Hawthorne Caballeros",
    "caballeros": "Hawthorne Caballeros",
    "bushwackers": "Bushwackers",
    "fusion core": "Fusion Core",
    "cadets2": "Cadets2",
    "sun devils": "Sun Devils",
    "white sabers": "White Sabers",
    "governaires": "Govenaires",
    "govenaires": "Govenaires",
    "minnesota brass": "Minnesota Brass",
    "mn brass": "Minnesota Brass",
    "kilties": "Kilties",
    "royal airs": "Royal Airs",
    "skyliners": "Skyliners",
    "empire statesmen": "Empire Statesmen",
    "syracuse brigadiers": "Syracuse Brigadiers",
    "brigadiers": "Syracuse Brigadiers",
}


def canon_corps(name: str) -> str:
    n = norm_space(name)
    n = re.sub(r"\s*\((?:World|Open|All[- ]Age|Int'l|International|Class A|Exhibition)[^)]*\)\s*$", "", n, flags=re.I)
    n = re.sub(r'["“”]', "", n)  # Blue Devils "B" → Blue Devils B
    n = norm_space(n.rstrip("*+^~ "))
    key = n.lower().strip()
    return CORPS_ALIASES.get(key, n)


def slugify(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s or "x"
