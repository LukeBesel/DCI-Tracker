#!/usr/bin/env python3
"""Official judge-level recaps from CompetitionSuite.

CompetitionSuite is the platform DCI's own recaps are generated from, so its
data is authoritative and identical to dci.org's — but it is reachable from
the cloud even when dci.org Cloudflare-blocks the runner. This backfills the
caption breakdown for shows the totals-only mirrors (drum-corps.net,
downbeatdesigns) filled without recaps.

Path: the public "bridge" API lists a season's competitions with GUIDs
(GetCompetitionsBySeason — the org-scoped list is empty for the live season,
the season-scoped one is not), each GUID resolves to per-round recap URLs
(GetCompetition), and each recap page carries every judge's sub-scores.

Value encoding (verified against known-good dci.org data — DCI Central Texas
2026, 6/6 corps caption-for-caption): CompetitionSuite stores judge
sub-scores ×10 with at most one decimal (84 → 8.400), and caption/sub/totals
as-is with two or more decimals (16.80 → 16.800). Every parsed row is then
re-verified arithmetically by build_data (non-reconciling rows are dropped),
so a mis-parse can never surface as a wrong score.
"""
from __future__ import annotations

import json
import re

from common import ROOT, fetch, log, norm_space, canon_corps

PARSED = ROOT / "data" / "parsed"
DCI_ORG = "96b77ec2-333e-41e9-8d7d-806a8cbe116b"
BRIDGE = "https://bridge.competitionsuite.com/api/orgscores"

ROUND_CLASS = {
    "world class": "World Class",
    "open class": "Open Class",
    "all age": "All-Age",
    "all-age": "All-Age",
    "soundsport": "SoundSport",
    "international": "International",
    "exhibition": "Exhibition",
}

_ANCHOR = re.compile(
    r"<td class='content topBorder rightBorderDouble'>([^<]+)</td>\s*"
    r"<td class='content topBorder rightBorderDouble'[^>]*>([^<]*,\s*[A-Z]{2})</td>")
# each score sits in a wrapper <td> whose class names the column's role:
#   verified / subcaptionTotal / categoryTotal ... = a real judge score, a
#   judge's caption total, or a block (GE/Visual/Music) total — all kept;
#   captionTotal = the redundant combined total a *doubled* sub-caption panel
#   inserts, which isn't in the sheet layout build_data reconciles against, so
#   it's dropped. (subcaptionTotal contains the substring "captionTotal" — the
#   match is on whole class words, not a substring.)
_SCORE_CELL = re.compile(
    r"<td class='([^']*)'[^>]*>\s*(<table class='scoreTable'.*?</table>)\s*</td>", re.S)
_NUM = re.compile(r"data-translate-number='([^']*)'")
_RANK = re.compile(r"class='content rank'>([^<]*)<")


def _bridge(endpoint: str):
    txt = fetch(f"{BRIDGE}/{endpoint}", force=True, accept_json=True) or \
          fetch(f"{BRIDGE}/{endpoint}", accept_json=True)
    if not txt:
        return None
    txt = txt.strip()
    if not txt.startswith("{") and not txt.startswith("["):  # strip any jQuery(...) wrapper
        i, j = txt.find("("), txt.rfind(")")
        if 0 <= i < j:
            txt = txt[i + 1:j]
    try:
        return json.loads(txt)
    except Exception:
        return None


def _atom(raw: str, rank: str) -> str:
    raw = raw.strip()
    if raw in ("", "--", "-"):
        return "0"
    dec = len(raw.split(".")[1]) if "." in raw else 0
    val = float(raw) / 10 if dec <= 1 else float(raw)
    return f"{val:.3f}" + (f" {rank}" if rank and rank.isdigit() else "")


def parse_recap(html: str) -> list[dict]:
    """CompetitionSuite recap page -> rows [{corps, total, cells:[atoms]}]."""
    anchors = list(_ANCHOR.finditer(html))
    rows = []
    for k, a in enumerate(anchors):
        corps = canon_corps(a.group(1))
        if not corps:
            continue
        end = anchors[k + 1].start() if k + 1 < len(anchors) else len(html)
        atoms = []
        for cell in _SCORE_CELL.finditer(html[a.end():end]):
            if "captionTotal" in cell.group(1).split():
                continue  # doubled-panel combined total — not part of the layout
            nm = _NUM.search(cell.group(2))
            if not nm:
                continue
            rk = _RANK.search(cell.group(2))
            atoms.append(_atom(nm.group(1), rk.group(1).strip() if rk else ""))
        if not atoms:
            continue
        nums = [float(x.split()[0]) for x in atoms if x != "0"]
        rows.append({"corps": corps, "total": max(nums) if nums else 0.0, "cells": atoms})
    return rows


def _season_guid(year: int) -> str | None:
    seasons = _bridge(f"GetSeasons/jsonp?organization={DCI_ORG}") or []
    for s in seasons:
        if norm_space(str(s.get("name"))) == str(year):
            return s.get("seasonGuid")
    return None


def _competitions(season_guid: str) -> list[dict]:
    d = _bridge(f"GetCompetitionsBySeason/jsonp?season={season_guid}") or {}
    return d.get("competitions") or []


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", norm_space(s or "").lower())


def main(year: int = 2026) -> int:
    events_path = PARSED / "dci_events.json"
    if not events_path.exists():
        return 0
    events = json.loads(events_path.read_text())
    # only shows for this year that HAVE results but LACK a caption recap
    need = {}
    for e in events:
        if e.get("year") != year or e.get("recap"):
            continue
        if any(c.get("results") for c in e.get("classes") or []):
            need[(_norm(e["name"]), e.get("date"))] = e
            need.setdefault(_norm(e["name"]), e)  # date-agnostic fallback
    if not need:
        log("compsuite: every show already has a recap — nothing to do")
        return 0

    season = _season_guid(year)
    if not season:
        log(f"compsuite: no season GUID for {year} — skipping")
        return 0
    comps = _competitions(season)
    log(f"compsuite: {len(comps)} competitions listed for {year}; {len(set(id(v) for v in need.values()))} shows need recaps")

    filled = 0
    for comp in comps:
        date = (comp.get("competitionDate") or "")[:10]
        ev = need.get((_norm(comp.get("name")), date)) or need.get(_norm(comp.get("name")))
        if not ev or ev.get("recap"):
            continue
        detail = _bridge(f"GetCompetition/jsonp?competition={comp['competitionGuid']}")
        if not detail:
            continue
        recap = []
        for rnd in detail.get("rounds") or []:
            url = (rnd.get("fullRecapUrl") or "").replace("http://", "https://")
            if not url:
                continue
            html = fetch(url, force=True) or fetch(url)
            if not html:
                continue
            rows = parse_recap(html)
            if rows:
                cls = ROUND_CLASS.get(norm_space(rnd.get("name") or "").lower(), rnd.get("name") or "Results")
                recap.append({"class": cls, "captions": [], "rows": rows})
        if recap:
            ev["recap"] = recap
            filled += 1
            log(f"  + recap for {ev['name']} ({date}) — {sum(len(c['rows']) for c in recap)} corps across {len(recap)} class(es)")

    if filled:
        events_path.write_text(json.dumps(events, ensure_ascii=False, indent=1))
        log(f"compsuite: attached {filled} recap(s) → {events_path}")
    else:
        log("compsuite: no new recaps attached")
    return 0


if __name__ == "__main__":
    import sys
    raise SystemExit(main(int(sys.argv[1]) if len(sys.argv) > 1 else 2026))
