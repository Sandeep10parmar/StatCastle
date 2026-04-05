# 🏏 StatCastle — CricClubs Tournament Insights

**Automatically analyze your CricClubs team's performance** — fetch match data, generate stats, and visualize results in a web dashboard and PDF report.

> 💡 No admin access required. Just your team's CricClubs URL.  
> 🐳 **Run in minutes with Docker** — no local setup needed!

---

## ⚡️ Quick Start (Docker - Recommended)

Get StatCastle running in minutes:

```bash
# 1️⃣ Clone the repository
git clone https://github.com/Sandeep10parmar/StatCastle.git
cd StatCastle

# 2️⃣ Configure your team
cp config.sample.yaml config.yaml
# Edit config.yaml with your team_id, club_id, league_id

# 3️⃣ Run with Docker Compose
docker-compose up

# ✅ Done! Check team_dashboard/ for your results
```

**That's it!** Your dashboard will be generated in `team_dashboard/index.html`.

### What You Get

- 📊 **Interactive Dashboard** (`team_dashboard/index.html`) — Modern web interface with filters
- 📄 **PDF Report** (`team_dashboard/Team_Stats_Summary.pdf`) — Printable summary
- 📝 **Text Summary** (`team_dashboard/summary.txt`) — Quick overview

---

## 🚀 Features

### Core Capabilities

| Feature | Description |
|---------|-------------|
| 🧠 **Team-based discovery** | Uses `teamResults.do` pages for reliable match fetching — no league admin needed |
| 📊 **Automated analysis** | Generates batting, bowling, and team-level insights automatically |
| 🧩 **Multi-tournament support** | Combine multiple CricClubs seasons for one team in a single analysis |
| 🌐 **GitHub Pages ready** | Auto-deploy dashboards publicly via GitHub Pages |

### Dashboard Features

#### Home Page
- **Recent Match Results** — Last 5 matches (with current filters) with opponent, result, ground, series; special outcomes show both result and detail (e.g. **Draw** + Abandoned, **Win** + Forfeit)
- **Top 5 Batsmen** — Best strike rate, most runs, most 4s, most 6s
- **Top 5 Bowlers** — Most wickets, best economy, best strike rate, most dot balls
- **Player of the Match** — Recent MoM awards

#### Team Stats Page
- **Team Recent Form & Momentum** — Last matches as W/L/D (oldest → newest) with rolling win rate, streak, and comparison to the prior window; **W(F)** / **L(F)** mark forfeit wins/losses; respects the same **date and series filters** as the rest of the dashboard
- **Win Rate by Ground** — W/L/D and win % by venue; **recomputed from filtered matches** in the browser (aligned with `analyze.py` rules, excluding Abandoned / No result / Forfeit from those counts)
- **Win Rate by Toss Outcome** — Same filtering and exclusion rules as ground
- **Win Rate by Match Type** — League vs playoff split with the same filtering and exclusion rules

#### Player Stats Page
- **Player Dropdown** — Select any player to view detailed stats
- **Player Card** — Profile picture, aggregated batting & bowling stats
- **Batting by Position** — Strike rate and average for each batting position
- **Recent Performances** — Last 5 batting innings and bowling spells
- **Man of the Match Awards** — All matches where player was PoM

#### Advanced Filtering
- **Date Range Picker** — Filter by match date (default: last 30 days)
- **Series Multi-Select** — Filter by tournament/series; series options include every competition that appears in **match results**, including metadata-only games. When **all** series are selected, series filtering is not applied (equivalent to “all competitions”)
- **Auto-apply Toggle** — Real-time filtering as you change settings
- **Filter Presets** — Quick access to "Last 5 matches", "This season", "Last 3 months", "All time"

### Analytics Generated

- Top 5 batsmen (runs, strike rate, boundaries)
- Top 5 bowlers (wickets, economy, strike rate)
- Dot-ball % leaderboard
- Win-rate by ground, toss outcome, and match type in **`team_analytics.json`** (played matches only: **Forfeit**, **Abandoned**, and **No result** games are listed in **`match_results.json`** but omitted from these W/L aggregates and from player innings totals)
- Per-player breakdown with position analysis
- Aggregated performance across multiple tournaments
- Match results with full context (opponent, ground, series, toss, `result_detail` when relevant)

---

## 🐳 Docker Deployment

Docker is the **recommended** way to run StatCastle. It handles all dependencies automatically.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed
- Docker Compose (included with Docker Desktop)

### Quick Start

```bash
# Configure your team
cp config.sample.yaml config.yaml
# Edit config.yaml with your team details

# Run the full pipeline
docker-compose up
```

### Manual Docker Commands

```bash
# Build the image
docker build -t statcastle:latest .

# Run export and analysis
docker run --rm \
  -v $(pwd)/config.yaml:/app/config.yaml:ro \
  -v $(pwd)/cricclubs_export_out:/app/cricclubs_export_out \
  -v $(pwd)/team_dashboard:/app/team_dashboard \
  statcastle:latest \
  sh -c "python3 cricclubs_export.py && python3 analyze.py"
```

### Environment Variables

Customize behavior with environment variables:

```bash
docker run --rm \
  -e HEADLESS=1 \
  -e MAX_LEAGUE_WORKERS=3 \
  -e MAX_MATCH_WORKERS=4 \
  -e MATCH_DELAY=0.3 \
  -v $(pwd)/config.yaml:/app/config.yaml:ro \
  statcastle:latest \
  python3 cricclubs_export.py
```

| Variable | Default | Description |
|----------|---------|-------------|
| `HEADLESS` | `1` | Run Playwright in headless mode (0 for visible browser) |
| `MAX_LEAGUE_WORKERS` | `3` | Parallel leagues to process |
| `MAX_MATCH_WORKERS` | `4` | Parallel matches per league |
| `MATCH_DELAY` | `0.3` | Delay between match requests (seconds) |
| `FORCE_REFRESH` | `0` | Force re-fetch even if data exists |

**📖 For detailed Docker and Kubernetes deployment instructions, see [DOCKER.md](DOCKER.md)**

---

## 💻 Local Setup (Alternative)

If you prefer running locally without Docker:

### Prerequisites

- Python 3.11 or higher
- pip (Python package manager)

### Installation

```bash
# 1️⃣ Clone and setup
git clone https://github.com/Sandeep10parmar/StatCastle.git
cd StatCastle
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# 2️⃣ Install dependencies
pip install -r requirements.txt
playwright install chromium

# 3️⃣ Configure your team
cp config.sample.yaml config.yaml
# Edit config.yaml with your team_id, club_id, league_id

# 4️⃣ Run analysis
python3 cricclubs_export.py && python3 analyze.py

# 5️⃣ Open dashboard
open team_dashboard/index.html  # macOS
# Or: xdg-open team_dashboard/index.html  # Linux
```

---

## ⚙️ Configuration

### Finding Your Team IDs

1. Open your team's CricClubs URL:
   ```
   https://cricclubs.com/HoustonPremierT20League/teamResults.do?teamId=598&league=25&clubId=1366
   ```

2. Extract from URL:
   - `teamId=598` → `team_id: 598`
   - `league=25` → `league_id: 25`
   - `clubId=1366` → `club_id: 1366`

### Example `config.yaml`

```yaml
team_name: "Royals"

leagues:
  - base_path: "https://cricclubs.com/HoustonPremierT20League"
    club_id: 1366
    league_id: 25
    team_id: 598

  # Add more tournaments to combine data
  - base_path: "https://cricclubs.com/HoustonUnitedPremierLeague"
    club_id: 1366
    league_id: 32
    team_id: 712
```

### Optional Settings

**Player Photos:**
```yaml
players_csv: "players.csv"  # CSV with name,photo_url columns
```

**Specific Matches Only:**
```yaml
leagues:
  - base_path: "..."
    match_ids: [1861, 1843, 1841]  # Skip discovery, fetch only these
```

**Customize Team Logo:**
- Replace `team_dashboard/assets/Royals_Logo.png` with your logo
- Or add logo path in config (if supported)

---

## ⚡️ Data Export Features

The `cricclubs_export.py` script includes several performance and efficiency features:

### Incremental Updates (Default)

**By default, StatCastle only fetches new matches** - it's smart about not re-downloading data you already have:

- ✅ **First run**: Discovers and fetches all matches for your team
- ✅ **Subsequent runs**: Only fetches new matches that weren't in previous runs
- ✅ **Automatic detection**: Compares discovered match IDs with existing `matches.json` files
- ✅ **Efficient**: Saves time and bandwidth by skipping already-fetched matches

**Example:**
```bash
# First run - fetches all 50 matches
python3 cricclubs_export.py
# Output: "saved 50 matches (50 new, 0 existing)"

# Second run (after 5 new matches played) - only fetches 5 new matches
python3 cricclubs_export.py
# Output: "saved 55 matches (5 new, 50 existing)"
```

### Force Refresh

To re-fetch all matches (useful if data was corrupted or you want fresh data):

```bash
# Docker
FORCE_REFRESH=1 docker-compose up

# Local
FORCE_REFRESH=1 python3 cricclubs_export.py
```

**When to use:**
- Data corruption or incomplete fetches
- Want to refresh all match data
- Testing or debugging

### Multi-Threading for Performance

StatCastle uses parallel processing to speed up data fetching:

**Two-Level Parallelism:**
1. **League-level**: Multiple leagues processed simultaneously
2. **Match-level**: Multiple matches per league fetched in parallel

**Performance Tuning:**

```bash
# Increase parallel workers for faster fetching (if you have good internet)
MAX_LEAGUE_WORKERS=5 MAX_MATCH_WORKERS=8 python3 cricclubs_export.py

# Reduce workers if you're getting rate-limited
MAX_LEAGUE_WORKERS=1 MAX_MATCH_WORKERS=2 python3 cricclubs_export.py
```

**Environment Variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_LEAGUE_WORKERS` | `3` | Number of leagues to process in parallel |
| `MAX_MATCH_WORKERS` | `4` | Number of matches per league to fetch in parallel |
| `MATCH_DELAY` | `0.3` | Delay between match requests (seconds) - prevents rate limiting |
| `FORCE_REFRESH` | `0` | Set to `1` to re-fetch all matches (ignores incremental mode) |

**Performance Tips:**
- **Fast internet + stable connection**: Increase `MAX_MATCH_WORKERS` to 6-8
- **Slow/unstable connection**: Reduce to 2-3 workers, increase `MATCH_DELAY` to 0.5-1.0
- **Rate limiting issues**: Increase `MATCH_DELAY` to 0.5-1.0 seconds
- **Multiple leagues**: `MAX_LEAGUE_WORKERS=3` is usually optimal

**Example with custom settings:**
```bash
# Aggressive fetching (fast connection, many matches)
MAX_LEAGUE_WORKERS=5 MAX_MATCH_WORKERS=8 MATCH_DELAY=0.2 python3 cricclubs_export.py

# Conservative fetching (slow connection, avoid rate limits)
MAX_LEAGUE_WORKERS=2 MAX_MATCH_WORKERS=2 MATCH_DELAY=0.8 python3 cricclubs_export.py
```

---

## 📊 Output Structure

```
statcastle/
├── cricclubs_export_out/      # Raw scraped data (gitignored)
│   └── [LeagueName]_[ID]/
│       └── matches.json
│
└── team_dashboard/            # Generated outputs
    ├── index.html             # Interactive dashboard ⭐
    ├── Team_Stats_Summary.pdf  # PDF report
    ├── summary.txt            # Text summary
    ├── batting_stats.csv      # Aggregated batting stats
    ├── bowling_stats.csv      # Aggregated bowling stats
    └── assets/
        ├── dashboard.css      # Dashboard styles
        ├── dashboard.js        # Dashboard logic
        ├── *.json              # Data files (generated)
        └── [team-logo].png     # Team logo (optional)
```

---

## 🌐 GitHub Pages Deployment

StatCastle automatically deploys your dashboard to GitHub Pages on every push to `main`.

### Setup (One-Time)

1. **Enable GitHub Pages:**
   - Go to repository **Settings → Pages**
   - Source: **GitHub Actions**

2. **Push to main branch:**
   ```bash
   git add .
   git commit -m "Update dashboard"
   git push origin main
   ```

3. **Access your dashboard:**
   ```
   https://sandeep10parmar.github.io/StatCastle/team_dashboard/
   ```

### Auto-Deployment

The `.github/workflows/ci.yml` workflow:
- ✅ Runs on every push to `main`
- ✅ Builds dashboard and PDF
- ✅ Deploys to GitHub Pages automatically
- ✅ Scheduled runs (every Monday at 12:00 UTC)

**Note:** The workflow uses Python directly (not Docker) for GitHub Actions compatibility.

---

## 🧩 Advanced Usage

### Multi-Tournament Analysis

Combine data from multiple seasons:

```yaml
leagues:
  - base_path: "https://cricclubs.com/League2023"
    club_id: 1366
    league_id: 25
    team_id: 598
  - base_path: "https://cricclubs.com/League2024"
    club_id: 1366
    league_id: 32
    team_id: 598  # Same team, different season
```

### Scheduled Updates

**Using Docker:**
```bash
# Add to crontab for weekly updates
0 2 * * 1 cd /path/to/statcastle && docker-compose up
```

**Using Kubernetes:**
See [DOCKER.md](DOCKER.md) for CronJob examples.

### Custom Player Photos

1. Create `players.csv`:
   ```csv
   Name,PhotoURL
   John Smith,https://cricclubs.com/.../profilePic.jpg
   ```

2. Add to `config.yaml`:
   ```yaml
   players_csv: "players.csv"
   ```

---

## 🧰 Project Structure

```
statcastle/
│
├── cricclubs_export.py    # Fetch data from CricClubs
├── analyze.py             # Compute stats, build dashboard
├── summary_report.py      # Generate PDF/text reports
│
├── config.sample.yaml     # Configuration template
├── requirements.txt       # Python dependencies
│
├── Dockerfile             # Multi-stage Docker build
├── docker-compose.yml    # Docker Compose configuration
├── .dockerignore          # Docker build exclusions
│
├── team_dashboard/        # Generated outputs
│   ├── index.html         # Dashboard (source + generated)
│   ├── assets/            # CSS, JS, data files
│   └── *.pdf, *.txt       # Reports
│
├── .github/
│   └── workflows/
│       └── ci.yml         # GitHub Actions (auto-deploy)
│
├── DOCKER.md              # Docker & K8s deployment guide
├── DEPLOYMENT.md          # Comprehensive deployment docs
└── README.md              # This file
```

---

## 🧩 Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| `Found 0 matches` | Check `team_id`, `league_id`, and `club_id` in config.yaml |
| `ModuleNotFoundError` | Run `pip install -r requirements.txt` (or use Docker) |
| `Playwright browser not found` | Run `playwright install chromium` (or use Docker) |
| Empty dashboard | Run `python3 analyze.py` to generate JSON files; hard-refresh the browser so cached `match_results.json` is not reused |
| Docker build fails | Ensure Docker has enough memory (2GB+) |
| GitHub Pages not updating | Check Actions tab for workflow errors |

### Getting Help

1. Check [DEPLOYMENT.md](DEPLOYMENT.md) for detailed troubleshooting
2. Review [DOCKER.md](DOCKER.md) for Docker-specific issues
3. Check GitHub Issues for known problems
4. Verify your `config.yaml` matches the sample format

### Issues & Feature Requests

Found a bug or have an idea for a new feature? We'd love to hear from you!

- **Submit an Issue**: [Open an issue on GitHub](https://github.com/Sandeep10parmar/StatCastle/issues)
- **Bug Reports**: Please include steps to reproduce, error messages, and your environment (Docker/local, Python version, etc.)
- **Feature Requests**: Describe the feature you'd like to see and how it would help you

---

## 📚 Documentation

- **[DOCKER.md](DOCKER.md)** — Docker usage and Kubernetes deployment
- **[DEPLOYMENT.md](DEPLOYMENT.md)** — Comprehensive deployment guide
- **[CHANGELOG.md](CHANGELOG.md)** — Version history and changes
- **[TESTING.md](TESTING.md)** — Testing guide for developers

---

## 🧾 Version History

| Version | Changes |
|---------|---------|
| **v1.9.2** | Batting validation: **0(0)** dismissals (e.g. run out without facing); SR cap **600** for scoring innings; debug-CSV rebuild counts outs from dismissal text |
| **v1.9.1** | **0 (nb)** ducks with SR **0.00** accepted so **Recent batting** shows innings like **0 (2b)** |
| **v1.9** | Filtered team win-rate tables; forfeit/abandoned excluded from aggregates; series list merge; Team Recent Form & Momentum + W(F)/L(F); removed overall win % card |
| **v1.8** | Abandoned / no-result / forfeit parsing, `result_detail`, metadata-only `match_results`, dashboard display |
| **v1.7** | Team form & momentum strip (replaces monthly win-rate chart) |
| **v1.6** | Manual CI runs (`workflow_dispatch`), match-count pipe fix, Badri ground name normalization |
| **v1.5** | Mobile player stats table/chart caching fix on Chrome Mobile |
| **v1.4** | Mobile filter redesign with bottom sheet modal and floating icon button |
| **v1.3** | Docker support, updated README, K8s examples |
| **v1.2** | Player dropdown insights, multi-tournament merge, enhanced analytics |
| **v1.1** | Team-based `teamResults.do` discovery |
| **v1.0** | Initial release (league-based discovery, deprecated) |

---

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

**In short:** You're free to use, modify, and distribute this software. Just include the original license and copyright notice.

---

## 🏁 Credits

Built by cricket enthusiasts for cricket enthusiasts 🏏  
Easily adaptable for any CricClubs-hosted league or tournament.

---

## 🚀 Quick Links

- 🐳 [Docker Guide](DOCKER.md)
- 📖 [Deployment Guide](DEPLOYMENT.md)
- 🧪 [Testing Guide](TESTING.md)
- 📝 [Changelog](CHANGELOG.md)
