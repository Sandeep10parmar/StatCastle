# AGENTS.md

Guidance for AI coding agents (and human contributors) working in this repository. This file is tool-agnostic — see `CLAUDE.md`, `.cursor/rules/`, etc. for any tool-specific pointers back to this file.

## What this is

StatCastle scrapes CricClubs-hosted cricket league team pages, computes batting/bowling/team analytics, and publishes a static web dashboard + PDF/text report. It runs as a three-stage pipeline: `cricclubs_export.py` (scrape) → `analyze.py` (compute + emit JSON) → `summary_report.py` (PDF/text). The dashboard (`team_dashboard/`) is deployed to GitHub Pages via `.github/workflows/ci.yml` on push to `main` and every Monday 12:00 UTC.

## Commands

```bash
# Setup
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium

# Run the full pipeline
python3 cricclubs_export.py   # scrape -> cricclubs_export_out/<League>_<id>/matches.json
python3 analyze.py            # analyze -> team_dashboard/assets/*.json + CSVs
open team_dashboard/index.html

# Force re-fetch all matches instead of incremental
FORCE_REFRESH=1 python3 cricclubs_export.py

# Tune scraper concurrency (env vars, all optional)
MAX_LEAGUE_WORKERS=3 MAX_MATCH_WORKERS=4 MATCH_DELAY=0.3 python3 cricclubs_export.py

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

1. **`cricclubs_export.py`** — Playwright-driven scraper. For each `leagues[]` entry in `config.yaml` (a `base_path` + `club_id` + `league_id` + `team_id` combo), it discovers match IDs via the team's `teamResults.do` page (no league-admin access needed), then fetches each match's scorecard HTML, ball-by-ball HTML, and `info.do` metadata HTML in parallel (`MAX_LEAGUE_WORKERS` leagues x `MAX_MATCH_WORKERS` matches). Output lands in `cricclubs_export_out/<LeagueName>_<team_id>/matches.json`, one folder per league entry. Incremental by default (diffs against existing `matches.json`); `FORCE_REFRESH=1` re-fetches everything. `match_ids: [...]` in a league entry skips discovery entirely.

2. **`analyze.py`** — the core engine, loads every `matches.json` under `cricclubs_export_out/`, merges across leagues/seasons for one team, and does all parsing/classification:
   - `parse_match_metadata` / `parse_match_result` / `infer_opponent_from_vs` read the raw scorecard + `info.do` HTML to extract series, ground, toss, PoM, and result (including **Abandoned**, **No result**, and **Forfeit** as special cases stored via `result_detail`).
   - `parse_batting_row` / `parse_bowling_row` turn scorecard table rows into per-innings/per-spell records, with `plausible_batting` / `plausible_bowling` sanity-filtering implausible scraped rows (e.g. SR cap of 600, 0(0) dismissals — see CHANGELOG v1.9.1/v1.9.2 for the exact edge cases these were built for).
   - `match_counts_toward_record_stats` / `exclude_non_played_match_rows` is the single source of truth for which matches count toward win/loss aggregates: **Forfeit/Abandoned/No-result games are kept in `match_results.json` for display but excluded from `team_analytics.json` and player aggregates.** Any new stat that touches win/loss or player totals must respect this split.
   - `normalize_ground_name` (with `GROUND_NAME_ALIASES`) collapses venue name variants (e.g. "Badri Cricket Ground #3" vs "Badri Cricket Ground - 3") so ground-based stats aren't fragmented.
   - `build_match_results`, `build_team_analytics`, `build_player_assets` are the output builders — they write the JSON files consumed by the dashboard.
   - Output: `team_dashboard/assets/{match_results,team_analytics,series_list,player_stats,player_photos}.json` plus debug CSVs (`_debug_batting_rows.csv`, `_debug_bowling_rows.csv`) and public `batting_stats.csv`/`bowling_stats.csv`. **All of these are gitignored** (`team_dashboard/assets/*.json`, `*.csv`) — they're regenerated per-run, either locally or by CI, and are never committed. Only `dashboard.js`, `dashboard.css`, `index.html`, and the logo are tracked source files under `team_dashboard/`.

3. **`summary_report.py`** — thin entry point that generates the PDF (`Team_Stats_Summary.pdf`) and `summary.txt` from the same analyzed data.

### Dashboard

`team_dashboard/index.html` + `assets/dashboard.js` (~2800 lines) + `assets/dashboard.css` is a static, client-side app with three views (Home, Team Stats, Player Stats) driven entirely by the JSON files `analyze.py` produces — there is no server. Filtering (date range, series multi-select) is applied in JS at render time, and several "Team Stats" tables (win rate by ground/toss/match-type) are **recomputed client-side from filtered `match_results.json`** using the same exclusion rules as `analyze.build_team_analytics`, rather than reading pre-aggregated numbers — keeping the two in sync is a manual responsibility when either side's filtering logic changes. JSON assets are cache-busted on load (query-string trick) so stale data isn't served after a rebuild.

### Configuration

`config.yaml` (committed, unlike a typical secrets file — see the note in `.gitignore`) lists every `leagues[]` entry (team+league+club triplet) to combine into one team's stats, plus `team_name` (must exactly match the name as it appears on CricClubs scorecards for filtering to work) and optional `players_csv` for profile photos. `config.sample.yaml` is the template for new setups.

## Project-specific conventions

- No tool/AI attribution footers anywhere user-facing: README, CHANGELOG, dashboard UI, PDF/text reports, or suggested commit messages (see `.cursor/rules/no-tool-attribution.mdc`). Keep credits focused on StatCastle and contributors.
- CHANGELOG.md is actively maintained per release and is a good source of truth for *why* a particular parsing edge case exists in `analyze.py` before changing it.
