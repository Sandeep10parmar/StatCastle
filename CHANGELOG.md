# Changelog

## v1.10.0 — Player trends, filter fixes, and filtered player stats (2026-04-05)
- **Dashboard (`dashboard.js`, `dashboard.css`)**: **Performance trends** on the player page use **bar charts** (last five innings / spells) instead of line charts — clearer for discrete matches. X-axis uses **opponent · short date**; tooltips show **balls / SR** (batting) and **runs conceded / overs** (bowling). Chart area min-height adjusted for label room. **`player_photos.json`** is cache-busted on load like other assets.
- **Dashboard**: Applying **date/series filters** no longer resets the **player dropdown** to the first name; the selected player is kept when options are rebuilt.
- **Dashboard**: When filters are active, the **player stats** view (headline batting/bowling, **batting by position**, **dismissals**, **recent** lists, **PoM**, **batting/bowling by ground**, **performance charts**) is derived from per-match rows that match the filter, not only all-time aggregates.
- **analyze.py**: Each player gains **`batting_innings`** (per scorecard batting row: date, opponent, runs, balls, 4s/6s, position, ground, dismissal, outs, dot tracking) and **`bowling_spells`** (per spell: date, opponent, wickets, runs, overs, balls, dots, ground) for dashboard filtering. **`pom_matches`** dates/opponents normalized with **`_match_date_json`** / **`_opponent_json`**. **`simplify_dismissal_type()`** centralizes dismissal bucketing (also used by dismissal aggregates).
- **Dashboard**: **`calculateFilteredStats`** (home **Top** batsmen/bowlers) prefers **`batting_innings`** / **`bowling_spells`** when present so filtered windows are not limited to the last five rows only.
- **TESTING.md**: Documents that **`match_results.json`** holds **all** matches (dashboard applies UI limits/filters); adds **Performance Trends** checklist; sample scripts updated accordingly.

## v1.9.2 — 0(0) dismissals and SR cap 600 (2026-04-04)
- **analyze.py**: `plausible_batting` treats **all** **0-run** innings (including **0 balls**, e.g. run out without facing) with SR in **0–400** or missing; scoring innings allow **SR up to 600** (e.g. **6 off 1** not out). `parse_batting_row` SR cell fallback now scans up to **600**.
- **analyze.py**: Rebuilding public batting CSV from debug rows counts **`is_out`** from dismissal text only (not `runs > 0 or balls > 0`), so **0(0)** outs affect **Avg** correctly.
- **Tests**: `PlausibleBattingTests` extended in `test_abandoned_forfeit.py`.

## v1.9.1 — Batting ducks in recent performances (2026-04-04)
- **analyze.py**: `plausible_batting` no longer rejects innings with **0 runs**, balls faced **> 0**, and **strike rate 0.00** (CricClubs-style ducks). Those rows were dropped before, so **Recent batting** on the player page could miss e.g. `0 (2b)` vs an opponent when the same player also had a bowling row in that match.

## v1.9 — Filtered team stats, forfeit display, aggregate rules (2026-04-04)
- **Aggregates vs match list**: Matches with **Forfeit**, **Abandoned**, or **No result** stay in `match_results.json` (with `result_detail`) for the dashboard match list and form strip, but **do not** count toward server-built **team analytics** (overall W/L, ground, toss, league vs playoff) or **player** batting/bowling aggregates (`analyze.py`).
- **Series list**: `series_list.json` is the **union** of series from played-match rows and from every `match_results` entry so the series filter cannot hide metadata-only games.
- **Dashboard filters**: On the **Team** tab, **Win Rate by Ground / Toss / Match Type** are recomputed in the browser from **filtered** `match_results`, using the same exclusions as `analyze.build_team_analytics`, so they stay in sync with **Team Recent Form & Momentum** when date or series filters change. Choosing **all** series options skips series-based filtering for matches.
- **Team stats UI**: Renamed section to **Team Recent Form & Momentum**; removed the standalone **Win Percentage** card (overall % was easy to misread next to filtered form). Form pills show **W(F)** / **L(F)** for forfeit wins/losses, with tooltips like “Win (forfeit)”.
- **Home table**: Still shows combined result + detail (e.g. Win Forfeit, Draw Abandoned); recent-results row limit remains **5**; `match_results.json` is cache-busted on load.

## v1.8 — Abandoned, forfeit, and result_detail (2026-04-04)
- **Dashboard**: Cache-bust `match_results.json` on load (same as other JSON) so the browser does not keep an old file without new matches. Home table stays at **5** recent rows by default; filters widen or narrow what appears in that table.
- **Match results**: `parse_match_result` now classifies **Abandoned** and **No result** / **N/R** as **Draw** with `result_detail` labels; **Forfeit** outcomes (e.g. `Forfeited. Winner: …`, `won by forfeit`) as **Win** or **Loss** with `result_detail` **Forfeit**.
- **Metadata-only matches**: Games with no roster-qualified scorecard rows but parseable HTML still appear in `match_results.json` (merged after normal aggregation).
- **Analytics**: Team analytics are built from the merged `match_results` list (see v1.9 for exclusions of non-played games from W/L-style aggregates).
- **Dashboard**: Recent results table shows `result_detail` next to W/L/D (e.g. Abandoned, Forfeit); home table cells escape user-facing text safely.
- **Tests**: `test_abandoned_forfeit.py` (unittest); `test_match_results.py` waives opponent requirement for Abandoned/No result rows without an opponent.

## v1.7 — Team form & momentum (2026-04-04)
- **Team stats**: Replaced the monthly “Win Rate Over Time” chart with **Recent form & momentum** — a last-10 match W/L/D strip (oldest → newest), rolling win rate and record, current streak, and comparison to the previous 10 matches when enough data exists. Respects dashboard filters (`team_dashboard/assets/dashboard.js`, `index.html`, `dashboard.css`).

## v1.6 — CI & Venue Normalization (2026-04-04)
- **Venue name merge**: Normalized `Badri Cricket Ground #3` to `Badri Cricket Ground - 3` in `analyze.py` so win rate by ground and player ground stats use a single label (`GROUND_NAME_ALIASES` / `normalize_ground_name()`).
- **GitHub Actions**: Added `workflow_dispatch` so the build-and-deploy workflow can be run manually from the Actions tab.
- **GitHub Actions**: Fixed `cat: write error: Broken pipe` during match count verification by using `find … -exec cat {} +` and a safer grep fallback.

## v1.5 — Mobile Player Stats Caching Fix (2025-11-15)
- **Fixed Mobile Table Caching Issue**: Resolved issue where player stats tables (Batting by Position, Batting Stats by Ground, Bowling Stats by Ground) showed cached data from default player on Chrome Mobile
  - Clear existing table cards before updating table data
  - Recreate cards after table update to ensure fresh data display
  - Fixes mobile-specific caching where table cards weren't updating when switching players
- **Enhanced Chart Rendering**: Improved chart rendering for mobile browsers
  - Canvas elements are now completely removed and recreated for each player switch
  - Prevents Chrome Mobile from caching canvas elements at browser/GPU level
  - Ensures charts always display correct player data

## v1.4 — Mobile Filter Experience Enhancement (2024-11-15)
- **Mobile Filter Redesign**: Replaced space-consuming filter section with compact floating icon button
  - Floating filter icon button (bottom-right corner) for easy access on mobile
  - Bottom sheet modal that slides up smoothly with all filter controls
  - Badge indicator showing active filter count on icon
  - Active filter chips remain visible outside modal for quick reference
- **Cross-Platform Sync**: Full synchronization between mobile and desktop filter inputs
- **Enhanced Mobile UX**: 
  - Significantly reduced vertical space usage on mobile screens
  - Smooth animations and transitions for modal open/close
  - Touch-friendly filter controls optimized for mobile interaction
- **Desktop Experience**: Original filter section remains unchanged for desktop users
- **Accessibility**: Added proper ARIA labels, keyboard navigation, and focus management

## v1.3 — Docker Support & Production Readiness (2025-11-12)
- **Docker Support**: Multi-stage Dockerfile for easy deployment
  - No local setup required - run in minutes with `docker-compose up`
  - Includes Playwright browser installation
  - Optimized for production use
- **Docker Compose**: Added `docker-compose.yml` for local development
- **Kubernetes Support**: Full K8s deployment examples (Jobs, CronJobs)
- **Comprehensive Documentation**:
  - Complete README rewrite with Docker-first approach
  - New DOCKER.md with Docker and Kubernetes guides
  - New DEPLOYMENT.md with deployment instructions for various platforms
  - Updated GitHub Actions workflow with Playwright installation
- **Enhanced Features Documentation**:
  - Documented all dashboard features (filters, player stats, team stats)
  - Added troubleshooting guides
  - Environment variables documentation
- **Repository Cleanup**: Updated .gitignore and .dockerignore
- **GitHub Pages**: Improved auto-deployment workflow

## v1.2 — Team-Based Discovery & Enhanced Analytics (2025-11-03)
- Switched to team-based match discovery using `teamResults.do` (no admin access required)
- Removed league-based fallback for simpler, faster scraping
- Multi-tournament support in a single run
- Player dropdown insights (runs, SR, dot%, wickets, economy, impact games)
- Improved dashboard/PDF outputs and folder structure
- Updated README with Quick Start; updated config.sample.yaml

## v1.1 — Team-Based Discovery (2025-10-31)
- Team-based `teamResults.do` discovery
- Initial team-based match discovery implementation

## v1.0 — Initial Release (2025-10-25)
- Initial release with league-based discovery (deprecated)
- Basic dashboard functionality
- Match data export and analysis
