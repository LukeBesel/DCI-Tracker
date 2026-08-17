# Cadence operations runbook

The owner's manual for running, releasing, monitoring, and (one day) moving
Cadence. The README covers what the product is; this covers how to keep it
alive.

## 1. How a change ships

The data pipeline commits to `main` every ~12–15 minutes, so human changes go
through a feature branch:

```bash
git checkout -b my-change            # or the existing Claude feature branch
# …edit, test (see §3)…
git commit
git fetch origin main
git rebase origin/main               # data commits land constantly; expect this
git push -u origin my-change         # then merge via PR
```

Merging to `main` triggers `pages.yml` (on any `docs/**` change) which
publishes `docs/` to GitHub Pages. **If the app shell changed** —
`index.html`, `app.js`, `app.css`, `charts.js`, `recap.js`, `wrapped.js`,
`install.js`, `arcade.js`, anything under `docs/lib/` — bump the service-worker
cache version once per release: `const CACHE = "cadence-vNN"` in `docs/sw.js`.
Installed clients pick up the new shell on their next load. Data-only updates
never need a bump (the SW is network-first).

Verify a release: `curl -s https://lukebesel.github.io/DCI-Tracker/sw.js | grep cadence-v`

## 2. The workflows

| Workflow | Trigger | Job |
| --- | --- | --- |
| `update.yml` | dispatched by pulse (~12 min) + cron backstop | scrape current season/news, rebuild `docs/data`, commit, push, dispatch Pages |
| `pulse.yml` | self-re-arming ~5 h shifts + cron backstop | heartbeat that dispatches `update.yml` (GitHub's shared cron alone is too unreliable) |
| `watch.yml` | cron, May–Aug show windows | 30-second score-source polling; publishes the moment scores change |
| `pages.yml` | push to `main` touching `docs/**`, or dispatched | validate generated data, then deploy `docs/` to Pages |
| `qa.yml` | push/PR touching app, scraper, or workflow paths | path-aware CI (see §3) |
| `monitor.yml` | cron | site up? data fresh (season-aware)? relay healthy? updates one reusable issue |
| `backfill.yml`, `history.yml` | manual | historical scrape chunks |
| `diag.yml`, `probe.yml`, `ci-status.yml` | manual/utility | fetch diagnostics, probe pages, status publishing |

`update.yml` also self-heals: every run makes sure a pulse shift is alive and,
during show windows, that a watcher shift is running.

## 3. Tests and CI

Local commands (CI runs exactly these):

```bash
python3 -m pytest tests/ -q            # scraper unit tests
python scraper/validate_data.py        # generated-data integrity (fast)
node --test tests/unit/                # JS unit tests for docs/lib seams
cd tests/qa && npm ci && npm test      # Playwright browser QA against docs/
```

`qa.yml` is path-aware so score updates stay fast:

- **App paths** (`docs/**` except `docs/data/**`) → full browser QA + JS units
- **Pipeline paths** (`scraper/**`, `scripts/**`, `tests/test_*.py`) → pytest + validator
- **Data-only commits** → nothing in qa.yml; `pages.yml` runs the fast
  validator before deploying, which is the real gate
- Workflow changes → everything

Actions-made commits (the data bot) don't trigger `qa.yml` at all — GitHub
suppresses workflow triggers for `GITHUB_TOKEN` pushes; their deploy path runs
the validator inside `pages.yml`.

**Recommended (owner action):** enable branch protection on `main` requiring
the `qa` check for pull requests, so human changes can't merge red. The data
bot pushes directly and is unaffected.

## 4. Monitoring & troubleshooting

`monitor.yml` keeps one issue (label `ops`) updated instead of spamming new
ones. When it fires, or when something looks wrong:

**Stale scores in-season** (header shows "Updated Xh ago"):
1. Actions → is `pulse.yml` running a shift? If not: Run workflow.
2. Actions → recent `update.yml` runs failing? Open the log; the scrape report
   (`data/scrape_report.txt` in the commit) names the failing source.
3. dci.org Cloudflare-walling the runners is the usual cause — the mirrors
   (drum-corps.net, downbeatdesigns) and the relay's restricted `/fetch`
   proxy normally cover it; a full outage self-heals when the wall lifts.

**Site 404 / not updating:** Settings → Pages must show Source = GitHub
Actions and the repo must be public and not a template. Then Actions → run
`pages.yml`. (All three failure modes have happened.)

**Push alerts not arriving:**
1. `curl https://cadenceapp.up.railway.app/healthz` — expect `ok: true`.
2. `/status` shows `subscribers`, `lastCheck`, `lastPushError`.
3. Railway dashboard → is the service deployed and the volume attached? VAPID
   keys must not rotate (pin them with `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`
   env vars) or every subscriber silently detaches (the app self-heals by
   resubscribing on next open, but alerts in between are lost).
4. The relay only alerts for shows it hasn't alerted before (`notified`
   ledger) — a re-run of the same show never re-pings by design.

**The relay is a separate deploy.** Editing `push-server/` in this repo does
nothing until the owner redeploys it on Railway (root directory
`push-server`). `index.js` prints its `VERSION` at `/status` — compare with
the repo to see what's actually running.

## 5. Custom-domain migration checklist (when the owner buys one)

Pick a neutral name — **do not** put "DCI" in the domain. Then:

1. **DNS**: `CNAME` record `www` → `lukebesel.github.io`; apex via ALIAS/ANAME
   or GitHub's four A records.
2. **GitHub**: repo Settings → Pages → Custom domain; wait for the DNS check;
   tick **Enforce HTTPS**. Commit the `CNAME` file GitHub creates into
   `docs/` (Pages serves from `docs/`, so it must live there to survive).
3. **App config**: update `docs/lib/config.js` → `BASE_URL`, `BASE_LABEL`.
   That single file feeds share cards and outbound links.
4. **Static metadata** (not read from config at runtime): update in
   `docs/index.html` — canonical link, `og:url`, `og:image`,
   `twitter:image`; check `docs/manifest.webmanifest` (`start_url`/`scope`
   are relative — they survive the move untouched).
5. **Relay**: set `SITE_URL` env on Railway to the new origin (drives
   redirect, notification deep links, and score polling) and update
   `ALLOWED_ORIGINS` to include it.
6. **Service worker**: scope is relative — no change; bump the cache version
   with the metadata change so installed clients refresh.
7. Validate: share-card link text, a push notification's deep link, social
   preview (opengraph checker), and that the old
   `lukebesel.github.io/DCI-Tracker` URL still redirects (GitHub redirects
   project pages to the custom domain automatically).

## 6. Repository growth

`data/raw` (~150 MB of gzipped page cache) plus a ~27 MB `docs/data` rebuilt
every cycle means git history grows steadily. Current mitigations: the updater
commits only real changes (`git diff --cached --quiet` guard), builds write
canonical formatting (no key-order churn), and artifacts retain ≤3 days.

**Long-term plan (a deliberate future migration, not this repo's current
state):** move the high-frequency build products out of permanent history —
either (a) publish `docs/` to Pages from a build artifact instead of
committing `docs/data` (pages.yml already checks out `main` and could run
`build_data.py` at deploy time), or (b) push `docs/data` to a dedicated
`site-data` branch with periodic history truncation. Option (a) is cleaner:
inputs (`data/parsed`) stay versioned, products become ephemeral. Do it in the
off-season with a full QA pass; never rewrite existing history.

## 7. Ask Cadence (the disabled assistant)

Two switches must BOTH be on before `/ask` does anything:
`docs/lib/config.js → ASK_ENABLED` (client UI) and, on the relay,
`ASK_ENABLED=1` **and** `ANTHROPIC_API_KEY` (server). The relay ships with
per-IP token buckets, a global daily cap, question-length limits, and
output-token caps; keep them. Before enabling, decide a monthly budget and
watch `/status` → `ask` counters for the first week.

## 8. Contact path

The public contact is GitHub Issues (linked from the in-app About page and
Suggestions). If you want an email contact instead, add a monitored address to
the About page — don't publish one that nobody reads.
