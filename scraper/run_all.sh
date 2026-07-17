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
  if "$@" 2> >(tail -c 20000 >&2); then
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
  run "dci.org current season" python scraper/scrape_dci.py --season "$YEAR" --force-recent 4 --deadline 420
  run "upcoming events"        python scraper/scrape_upcoming.py --refresh-days 10 --deadline 180
  # the deep passes (profiles + history chunks) add ~15 min — the frequent
  # score runs skip them; the daily RUN_HISTORY=1 run picks them up
  if [ "${RUN_HISTORY:-0}" = "1" ]; then
    run "corps profiles"        python scraper/scrape_corps_profiles.py
    run "dci.org history chunk" python scraper/scrape_dci.py --max-fetches 150
    run "dcx history chunk"     python scraper/scrape_history.py --max-fetches 150
  fi
fi

run "build site data" python scraper/build_data.py

echo "finished=$(date -u +'%F %T UTC')" >> "$REPORT"
cat "$REPORT"
test -f docs/data/meta.json
