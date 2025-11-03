# Team Analytics — CricClubs Tournament Insights

Automated scraper, analyzer, and shareable dashboard for your cricket team.

## What's inside
```
team_analytics/
│
├── cricclubs_export.py          # scraper
├── analyze.py                   # generates dashboard + PDF
├── summary_report.py            # text summary generator
├── team_dashboard/              # dashboards + pdfs
│   ├── index.html
│   ├── assets/
│   ├── Team_Stats_Summary.pdf
│   └── summary.txt
└── cricclubs_export_out/        # exported CSV + JSON data
```

## Quick start
```bash
python -m venv .venv
# macOS/Linux:
source .venv/bin/activate
# Windows:
# .venv\Scripts\activate

pip install -r requirements.txt

# 1) (optional) Scrape CricClubs data
python cricclubs_export.py --balls   # if implemented for your league

# 2) Build dashboard & PDF
python analyze.py

# 3) Text summary
python summary_report.py
```

Outputs will be in `team_dashboard/`.

## GitHub Actions (CI)
A workflow is included to build the dashboard and PDF on each push to `main` and upload them as artifacts.
- See **Actions → latest run → Artifacts** to download the HTML & PDF built by CI.

## Customize
- Replace `team_dashboard/assets/royals_logo.png` with your team logo (optional).
- Update match IDs and league details in `cricclubs_export.py`.
- Extend `analyze.py` to compute new insights (e.g., win rate by ground, themes in losses).


---

## Configure via `config.yaml` (for any CricClubs league)

1. Copy the sample config and edit your values:
```bash
cp config.sample.yaml config.yaml
```

2. Open `config.yaml` and set:
- `base_path`: e.g., `https://cricclubs.com/HoustonPremierT20League`
- `club_id`: number from your URLs (e.g., `1366`)
- *Either* set `league_id` (recommended for auto-discovery), *or* list explicit `match_ids`.

3. Export data:
```bash
python cricclubs_export.py
```

4. Build dashboard + PDF:
```bash
python analyze.py
```

This makes the repo reusable for **any** CricClubs league/tournament/team by simply editing `config.yaml`.

## Player Insights (in the HTML dashboard)
- Use the **player selector** at the top to view per-player metrics:
  - Batting: runs, balls, **strike rate**, **dot-ball %** (needs balls.csv)
  - Bowling: wickets, overs, economy
  - **Key impact performances**: best batting innings (by runs) and best bowling (by wickets)
- You can provide profile photos by adding a `players.csv` at repo root with columns:
  ```csv
  name,photo_url
  John Smith,https://cricclubs.com/.../profilePic.jpg
  ```
  If no photo is found, a silhouette is shown.

## Multiple tournaments
- Place exported CSVs for each tournament under **any subfolder** within `cricclubs_export_out/` (e.g., `cricclubs_export_out/2024_spring/`).
- `analyze.py` will **auto-merge** all `batting.csv`, `bowling.csv`, and `balls.csv` files it finds recursively under `cricclubs_export_out/`.
