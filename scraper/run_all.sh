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
else
  run "dci.org current season" python scraper/scrape_dci.py --season "$YEAR" --force
  # opportunistically continue the history backfill a little each night
  run "dci.org history chunk"  python scraper/scrape_dci.py --max-fetches 150
fi

run "build site data" python scraper/build_data.py

echo "finished=$(date -u +'%F %T UTC')" >> "$REPORT"
cat "$REPORT"
test -f docs/data/meta.json
