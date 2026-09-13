# AGENTS.md

Guidance for AI coding agents (and human contributors) working in this repository. This file is tool-agnostic — see `CLAUDE.md`, `.cursor/rules/`, etc. for any tool-specific pointers back to this file.

## What this is

StatCastle computes batting/bowling/team analytics for a CricClubs-hosted cricket team and publishes a static web dashboard + PDF/text report. The pipeline is `analyze.py` (compute + emit JSON) → `summary_report.py` (PDF/text), fed by match data under `cricclubs_export_out/`. The dashboard (`team_dashboard/`) is deployed to GitHub Pages via `.github/workflows/ci.yml` on push to `main`.

**Important: `cricclubs_export.py` (the Playwright scraper) is currently non-functional.** As of 2026-09, CricClubs' Cloudflare protection hard-blocks the automated browser on every page type (discovery, scorecard, info, ball-by-ball) — confirmed on multiple environments and networks, not IP-specific. This isn't a bug to fix; it's a deliberate anti-bot measure, and no fingerprint-evasion workaround should be attempted. **New match data is added via `pdf_ingest.py`** instead, which parses CricClubs' own working per-match "Score Card PDF" export (still a legitimate, functioning site feature) into the same row shapes the old HTML parsers produced, so the rest of the pipeline is unaffected. See `cricclubs_export.py`'s session-persistence support and `cricclubs_login.py` for a partial, ultimately unsuccessful attempt at reviving the scraper — kept in case CricClubs' protection ever changes, but don't extend that effort further.

## Commands

```bash
# Setup
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Add a new match (scraper is dead - see above; this is the current path)
python3 -c "
import json, pdf_ingest as pi
entry = pi.build_manual_match_entry('/path/to/Score Card PDF.pdf', team_name='Royals', match_id=1234)
path = 'cricclubs_export_out/<LeagueName>_<season>/matches.json'
data = json.load(open(path)) if __import__('pathlib').Path(path).exists() else []
data.append(entry)
json.dump(data, open(path, 'w'), indent=2)
"

# Run the build
python3 analyze.py            # analyze -> team_dashboard/assets/*.json + CSVs
open team_dashboard/index.html

# Unit tests (unittest-based, run individually — no pytest/test runner configured)
python3 test_abandoned_forfeit.py
python3 -m unittest test_abandoned_forfeit.ParseSpecialResultsTests.test_forfeit_winner_royals_is_win

# Data-quality validation against generated output (run after analyze.py)
python3 test_match_results.py

# Docker (recommended path per README)
docker-compose up
```

There is no build/lint step; this is a plain Python + static HTML/CSS/JS project.

## Architecture

### Pipeline and data flow

0. **`pdf_ingest.py`** — the current way new match data enters the system (see the scraper note above). `build_manual_match_entry(pdf_path, team_name, match_id, dot_counts=None)` parses CricClubs' per-match "Score Card PDF" export (Info tab, top-right icons) and returns a `matches.json`-shaped entry with `"source": "pdf_manual"`. Key things to know:
   - The PDF has everything except per-bowler **dot-ball counts** (pass `dot_counts={bowler_name: count}`, read off the live scorecard page's Bowling tab) and the official **Player of the Match** / **match type** (League vs Playoff) fields — those stay `null` unless supplied some other way.
   - **Bowling figures for "our" team are parsed from the *opponent's* innings block, not our own** — a scorecard's bowling table under `TeamX - 1` lists whoever bowled *at* TeamX, i.e. the other side. `build_manual_match_entry` already handles this; don't "fix" it if it looks backwards.
   - `match_id` must be numeric (analyze.py's `build_match_results` calls `int(match_id)`); use the real CricClubs match ID from the scorecard URL (`viewScorecard.do?matchId=XXXX`), not a synthetic string.
   - Append the returned entry into the right `cricclubs_export_out/<LeagueName>_<season>/matches.json` (create the folder/file if it's a new season) and re-run `analyze.py`.

1. **`cricclubs_export.py`** — the (currently non-functional, see above) Playwright scraper. When/if CricClubs' protection changes: for each `leagues[]` entry in `config.yaml` (`base_path` + `club_id` + `league_id` + `team_id`), it discovers match IDs via `teamResults.do`, then fetches scorecard/ball-by-ball/`info.do` HTML in parallel. Output lands in `cricclubs_export_out/<LeagueName>_<league_id>/matches.json`. Incremental by default; `FORCE_REFRESH=1` re-fetches everything; `match_ids: [...]` in a league entry skips discovery.

2. **`analyze.py`** — the core engine, loads every `matches.json` under `cricclubs_export_out/`, merges across leagues/seasons for one team, and does all parsing/classification:
   - In `main()`, each match branches on `match.get("source") == "pdf_manual"`: manual entries skip straight to attaching metadata and normalizing names (their rows are already structured); everything else goes through the legacy HTML-parsing path below. Both branches converge on the same `bats`/`bowls` lists, so all downstream logic is shared.
   - `parse_match_metadata` / `parse_match_result` / `infer_opponent_from_vs` read the raw scorecard + `info.do` HTML to extract series, ground, toss, PoM, and result (including **Abandoned**, **No result**, and **Forfeit** as special cases stored via `result_detail`) — HTML path only; `pdf_ingest.derive_match_meta` is the manual-entry equivalent.
   - `parse_batting_row` / `parse_bowling_row` turn scorecard table rows into per-innings/per-spell records, with `plausible_batting` / `plausible_bowling` sanity-filtering implausible scraped rows (e.g. SR cap of 600, 0(0) dismissals — see CHANGELOG v1.9.1/v1.9.2 for the exact edge cases these were built for).
   - `match_counts_toward_record_stats` / `exclude_non_played_match_rows` is the single source of truth for which matches count toward win/loss aggregates: **Forfeit/Abandoned/No-result games are kept in `match_results.json` for display but excluded from `team_analytics.json` and player aggregates.** Any new stat that touches win/loss or player totals must respect this split.
   - `normalize_ground_name` (with `GROUND_NAME_ALIASES`) collapses venue name variants (e.g. "Badri Cricket Ground #3" vs "Badri Cricket Ground - 3") so ground-based stats aren't fragmented.
   - `build_match_results`, `build_team_analytics`, `build_player_assets` are the output builders — they write the JSON files consumed by the dashboard.
   - Output: `team_dashboard/assets/{match_results,team_analytics,series_list,player_stats,player_photos}.json` plus debug CSVs (`_debug_batting_rows.csv`, `_debug_bowling_rows.csv`) and public `batting_stats.csv`/`bowling_stats.csv`. **These are gitignored** — regenerated per-run, either locally or by CI. `cricclubs_export_out/` (the raw match data) is the opposite: **committed to the repo**, since CI can no longer regenerate it by scraping (see CI note below). Only `dashboard.js`, `dashboard.css`, `index.html`, and the logo are tracked source files under `team_dashboard/`.

3. **`summary_report.py`** — thin entry point that generates the PDF (`Team_Stats_Summary.pdf`) and `summary.txt` from the same analyzed data.

### Dashboard

`team_dashboard/index.html` + `assets/dashboard.js` (~2800 lines) + `assets/dashboard.css` is a static, client-side app with three views (Home, Team Stats, Player Stats) driven entirely by the JSON files `analyze.py` produces — there is no server. Filtering (date range, series multi-select) is applied in JS at render time, and several "Team Stats" tables (win rate by ground/toss/match-type) are **recomputed client-side from filtered `match_results.json`** using the same exclusion rules as `analyze.build_team_analytics`, rather than reading pre-aggregated numbers — keeping the two in sync is a manual responsibility when either side's filtering logic changes. JSON assets are cache-busted on load (query-string trick) so stale data isn't served after a rebuild.

### CI / Deployment

`.github/workflows/ci.yml` no longer scrapes — it checks out the repo (which now includes `cricclubs_export_out/`), runs `analyze.py` against that committed data, and deploys `team_dashboard/` to GitHub Pages. No scheduled/cron trigger: since nothing is fetched automatically anymore, a rebuild only makes sense when a push actually adds new match data (via `pdf_ingest.py` locally, then committed). If you're re-adding scraping in the future, remember CI starts every run from a fresh checkout with nothing cached — incremental fetch logic that relies on comparing against existing `matches.json` won't help there.

### Configuration

`config.yaml` (committed, unlike a typical secrets file — see the note in `.gitignore`) lists every `leagues[]` entry (team+league+club triplet) to combine into one team's stats, plus `team_name` (must exactly match the name as it appears on CricClubs scorecards for filtering to work) and optional `players_csv` for profile photos. `config.sample.yaml` is the template for new setups.

## Project-specific conventions

- No tool/AI attribution footers anywhere user-facing: README, CHANGELOG, dashboard UI, PDF/text reports, or suggested commit messages (see `.cursor/rules/no-tool-attribution.mdc`). Keep credits focused on StatCastle and contributors.
- CHANGELOG.md is actively maintained per release and is a good source of truth for *why* a particular parsing edge case exists in `analyze.py` before changing it.
