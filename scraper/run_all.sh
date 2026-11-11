#!/usr/bin/env bash
# DCI-only scrape runner. Writes data/scrape_report.txt for observability.
set -u
MODE="${1:-update}"   # update | backfill
export PYTHONPATH=scraper
REPORT=data/scrape_report.txt
mkdir -p data
: > "$REPORT"
echo "mode=$MODE started=$(date -u +'%F %T UTC')" >> "$REPORT"

run() {
  local name="$1"; shift
  echo "::group::$name"
  local t0=$SECONDS
  # Hard cap on every step so a slow/throttled source can never hang the
  # whole pipeline (as happened when a fallback scraper's retry loop stalled
  # the run for the full job timeout). On timeout the step is recorded FAILED
  # and the run moves on, keeping whatever data we already have. Override per
  # call with STEP_TIMEOUT.
  if timeout --preserve-status --kill-after=20 "${STEP_TIMEOUT:-360}" "$@" 2> >(tail -c 20000 >&2); then
    echo "$name: OK ($((SECONDS-t0))s)" >> "$REPORT"
  else
    echo "$name: FAILED exit=$? ($((SECONDS-t0))s)" >> "$REPORT"
  fi
  echo "::endgroup::"
}

YEAR=$(date +%Y)

if [ "$MODE" = "backfill" ]; then
  # History backfill in bounded chunks: each run fetches up to MAX_FETCHES
  # uncached pages (older seasons first stay cached forever once fetched).
  run "dci.org backfill chunk" python scraper/scrape_dci.py --max-fetches "${MAX_FETCHES:-600}"
elif [ "$MODE" = "history" ]; then
  # Pre-2013 archive (dcxmuseum.org), in bounded chunks
  run "dcx history chunk" python scraper/scrape_history.py --max-fetches "${MAX_FETCHES:-2000}"
  run "wiki champions"    python scraper/scrape_wiki_champions.py
else
  # only re-fetch the last few days of shows (score corrections + late
  # recaps); older completed shows stay cached. --deadline bounds the run so
  # a DCI outage/throttle can't stall the pipeline — worst case we keep the
  # data we have and try again next cycle.
  STEP_TIMEOUT=600 run "dci.org current season" python scraper/scrape_dci.py --season "$YEAR" --force-recent 4 --deadline 540
  # Fallback fills: when dci.org is Cloudflare-blocking the runner, pull the
  # same results from public mirrors for any show dci.org couldn't deliver.
  # Both are verified exact matches; neither overwrites dci.org's richer,
  # recap-carrying data, and each show upgrades in place once the block
  # lifts. drum-corps.net posts brand-new shows fastest (per-show pages);
  # downbeatdesigns is a full-season backstop.
  # FETCH_RETRIES=1 so a throttled mirror fails fast instead of retry-storming
  # inside the step's time cap; these fills are best-effort and best-fresh.
  FETCH_RETRIES=1 STEP_TIMEOUT=150 run "drum-corps.net fill"     python scraper/scrape_drumcorpsnet.py "$YEAR"
  FETCH_RETRIES=1 STEP_TIMEOUT=120 run "downbeat fallback fill"  python scraper/scrape_downbeat.py "$YEAR"
  # Judge-level captions from CompetitionSuite (the platform DCI's own
  # recaps are built from) — reachable from the cloud even when dci.org is
  # walled off. Attaches the official caption breakdown to mirror-filled
  # shows; every row is re-verified arithmetically by build_data, and
  # dci.org's own recap replaces it in place once the wall lifts.
  FETCH_RETRIES=1 STEP_TIMEOUT=240 run "compsuite captions"      python scraper/scrape_compsuite.py "$YEAR"
  run "upcoming events"        python scraper/scrape_upcoming.py --refresh-days 10 --deadline 180
  FETCH_RETRIES=1 STEP_TIMEOUT=120 run "dci news"               python scraper/scrape_news.py
  # the deep passes (profiles + history chunks) add ~15 min — the frequent
  # score runs skip them; the daily RUN_HISTORY=1 run picks them up
  # WGI runs Jan-May, so its "current" season is this calendar year's; out of
  # season the API answers with an empty list in three cheap calls. Completed
  # shows stay in the fetch cache, so a mid-season pass only pays for the
  # shows that are actually new.
  FETCH_RETRIES=1 STEP_TIMEOUT=420 run "wgi current season" python scraper/scrape_wgi.py --year "$YEAR"
  if [ "${RUN_HISTORY:-0}" = "1" ]; then
    run "corps profiles"        python scraper/scrape_corps_profiles.py
    run "dci.org history chunk" python scraper/scrape_dci.py --max-fetches 150
    run "dcx history chunk"     python scraper/scrape_history.py --max-fetches 150
    # WGI's two older API seasons, then the 1980-2019 championship archive.
    # Both are immutable once fetched, so this is a no-op after the first run.
    FETCH_RETRIES=1 STEP_TIMEOUT=600 run "wgi api backfill" \
      python scraper/scrape_wgi.py --year $((YEAR-1)) --year $((YEAR-2))
    FETCH_RETRIES=1 STEP_TIMEOUT=300 run "wgi history archive" python scraper/scrape_wgi_history.py
  fi
fi

run "build site data" python scraper/build_data.py
# WGI builds into its own docs/data/wgi/ namespace, so it cannot disturb the
# DCI build above and a WGI failure never blocks publishing DCI scores.
run "build wgi data" python scraper/build_wgi.py
run "validate site data" python scraper/validate_data.py

echo "finished=$(date -u +'%F %T UTC')" >> "$REPORT"
cat "$REPORT"
# the exit code is the gate: a missing or invalid build must fail the run so
# callers (update.yml, watch.yml) never publish a broken docs/data
test -f docs/data/meta.json && python scraper/validate_data.py > /dev/null
