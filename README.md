# Cadence — DCI scores, live standings & history

A free, installable, auto-updating scores dashboard for **Drum Corps
International (DCI)**: live season standings, judge-level caption recaps,
corps histories, champions back to 1972, and optional push alerts the moment
scores post.

**Live app:** https://lukebesel.github.io/DCI-Tracker/

Cadence is an **independent fan project**. It is not affiliated with,
sponsored by, or endorsed by Drum Corps International or CompetitionSuite.
Scores originate from publicly published, credited sources (see below).

## What it covers

- DCI **World Class**, **Open Class**, and **All-Age** divisions
- Current-season standings, trends, movers, and LIVE show tracking
- Judge-level caption sheets (2013+) with shareable caption-winner cards
- Every published score back to 1972; champions, records, and a raw database
- Show schedules with timezone conversion, predictions ("Call the finish"),
  DCI news, and a curated off-season camps/auditions calendar

**Not currently covered:** other circuits (DCA as a separate circuit, BOA,
WGI). Possible future directions live in
[Suggestions](https://lukebesel.github.io/DCI-Tracker/#/suggestions) — nothing
outside DCI is committed.

## Architecture

Zero-backend static product. No accounts, no trackers, no paid tier.

```
scraper/*.py            Python scrapers + build (GitHub Actions, cron)
data/raw/               gzipped page cache (history is never re-fetched)
data/parsed/            normalized per-source JSON (committed inputs)
docs/                   the static site — GitHub Pages serves this folder
docs/data/              GENERATED site JSON (rebuilt by build_data.py; never
                        hand-edit — it is wiped on every build)
docs/onthisday.json     static "This Day in DCI History" index (lives outside
                        docs/data on purpose so rebuilds don't delete it;
                        regenerate with scripts/build_onthisday.py)
docs/lib/               small framework-free modules (config, testable seams)
push-server/            optional Node web-push relay (deployed separately,
                        e.g. Railway) — score alerts + the disabled assistant
tests/                  Python scraper tests, JS unit tests, browser QA suite
```

Frontend is vanilla JS with no build step: `docs/index.html` + `app.js`
(hash router + views) + `charts.js` (hand-rolled SVG) + self-contained
modules (`recap.js` show-recap stories, `wrapped.js` share-image cards,
`install.js` install flows, `arcade.js` easter egg) + `sw.js` (network-first
service worker, versioned cache `cadence-vNN`).

Runtime configuration (public base URL, relay URL, feature flags, release id)
lives in **`docs/lib/config.js`** — a future custom-domain or relay move is a
one-file change. See `OPERATIONS.md` for the migration checklist.

## Data pipeline

- `.github/workflows/update.yml` — the updater: scrape, rebuild
  `docs/data/`, commit, push, dispatch a Pages deploy. Runs every ~12–15 min
  (`pulse.yml` is the heartbeat that keeps cadence despite GitHub's unreliable
  shared cron).
- `.github/workflows/watch.yml` — show-night watcher (May–Aug): polls score
  sources every ~30 s and publishes the moment something changes.
- `.github/workflows/backfill.yml` / `history.yml` — manual historical chunks.
- `.github/workflows/pages.yml` — deploys `docs/` to GitHub Pages (validates
  generated data first).
- `.github/workflows/qa.yml` — path-aware CI: browser QA for app changes,
  scraper tests + validators for pipeline changes.
- `.github/workflows/monitor.yml` — scheduled health checks: site up, data
  fresh (season-aware), relay healthy. Failures update one reusable issue.

Sources, credited: [DCI.org](https://www.dci.org/scores) (primary; caption
recaps), [drum-corps.net](https://www.drum-corps.net),
[Downbeat Designs](https://downbeatdesigns.com), CompetitionSuite public
feeds, [The Sound Machine](https://www.soundmachine.org/dci/dcihistory.htm)
archive, and [Wikipedia](https://en.wikipedia.org) for corps profiles.
Scrapers are rate-limited, cache aggressively, identify themselves, and
respect source protections; mirror-sourced scores are exact-match verified and
upgraded in place when the primary source becomes available. Caption sheets
are re-verified arithmetically before publish.

## Running locally

```bash
# site — no build step; just serve docs/
python3 -m http.server -d docs 8000    # → http://localhost:8000

# data pipeline (optional — the repo already contains built data)
pip install -r scraper/requirements.txt
export PYTHONPATH=scraper
bash scraper/run_all.sh update         # current season + news + rebuild
python scraper/validate_data.py        # integrity-check docs/data
```

## Tests

```bash
python3 -m pytest tests/ -q                 # scraper unit tests
python scraper/validate_data.py             # generated-data validation
node --test tests/unit/                     # JS unit tests (pure seams)
cd tests/qa && npm ci && npm test           # browser QA suite (Playwright)
```

The QA suite serves `docs/` locally and checks console errors, overflow,
navigation, favorites/settings persistence, themes, text sizes, key flows,
fetch-failure states, accessibility, contrast, and tap targets across phone
and desktop viewports. CI runs the relevant subset per change type
(see `OPERATIONS.md`).

## Releases

Any change to the app shell (`index.html`, `app.js`, `app.css`, `charts.js`,
module files, `docs/lib/`) ships by bumping the service-worker cache version
(`cadence-vNN` in `docs/sw.js`) **once per release** so installed clients pick
up the new shell. Data updates need no version bump — the service worker is
network-first.

Deploys happen from `main` (Pages serves `docs/`). The data pipeline commits
to `main` every few minutes, so human changes land via a feature branch and
fetch → rebase → push. See `OPERATIONS.md` for the full flow and
troubleshooting (stale data, push alerts, Pages failures).

## Privacy

No accounts, no ads, no analytics. Personalization (favorites, theme, text
size, predictions) is stored only in the visitor's browser. Optional score
alerts register an anonymous push endpoint plus starred-corps preferences with
the relay; nothing else leaves the device. Full statement: the in-app
**About & privacy** page.

## Credit

Created by Lucas Besel. Scores and marks belong to their respective
organizations; this project republishes publicly posted competition results
with credit, for free, as a fan service. If you represent a source and have
concerns, please open an issue.
