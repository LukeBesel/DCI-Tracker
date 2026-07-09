#!/usr/bin/env bash
# Tolerant scrape runner: keeps going if any single source fails, and writes
# data/scrape_report.txt so run health is visible from the committed repo.
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
  run "dci.org all seasons"      python scraper/scrape_dci.py
  run "drum-corps.net archives"  python scraper/scrape_dcnet.py ${REFRESH:+--refresh}
  run "historical finals"        python scraper/scrape_history.py
else
  run "dci.org current season"   python scraper/scrape_dci.py --season "$YEAR" --force
  run "drum-corps.net recent"    python scraper/scrape_dcnet.py
  if [ ! -f data/parsed/dci_finals_history.json ]; then
    run "historical finals (first run)" python scraper/scrape_history.py
  fi
fi

run "dca site"  python scraper/scrape_dca_site.py
run "news"      python scraper/scrape_news.py
run "build"     python scraper/build_data.py

echo "finished=$(date -u +'%F %T UTC')" >> "$REPORT"
cat "$REPORT"
# build must have produced the core file, otherwise fail the job visibly
test -f docs/data/meta.json
