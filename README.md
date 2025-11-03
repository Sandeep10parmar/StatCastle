# 🏏 Team Analytics — CricClubs Tournament Insights

**Automatically analyze your CricClubs team’s performance** — fetch match data, generate stats, and visualize results in a web dashboard and PDF report.

> 💡 No admin access required. Just your team’s CricClubs URL.

---

## ⚡️ Quick Start

```bash
# 1️⃣ Clone and install dependencies
git clone https://github.com/<your-username>/team_analytics.git
cd team_analytics
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 2️⃣ Configure your CricClubs team
cp config.sample.yaml config.yaml
# then edit config.yaml with your team_id, club_id, league_id

# 3️⃣ Run analysis
python cricclubs_export.py && python analyze.py
open team_dashboard/index.html
```

✅ You’ll get:
- `index.html` — interactive dashboard  
- `Team_Stats_Summary.pdf` — printable report  
- `summary.txt` — quick textual summary

---

## 🚀 Features

| Capability | Description |
|-------------|--------------|
| 🧠 **Team-based discovery** | Uses `teamResults.do` pages for reliable match fetching — no league admin needed |
| 📊 **Automated analysis** | Generates batting, bowling, and team-level insights |
| 🧩 **Multi-tournament support** | Combine multiple CricClubs seasons for one team |
| 👤 **Player insights** | Dropdown to view per-player stats (runs, strike rate, wickets, etc.) |
| 📍 **Ground-level analytics** | Win-rate and trends by venue |
| 🧾 **PDF report** | Auto-generated `Team_Stats_Summary.pdf` |
| 🌐 **GitHub Pages ready** | Share dashboards publicly via Pages hosting |

---

## ⚙️ Configuration

Copy the sample config and edit it:
```bash
cp config.sample.yaml config.yaml
```

### Example `config.yaml`
```yaml
team_name: "Royals"

leagues:
  - base_path: "https://cricclubs.com/HoustonPremierT20League"
    club_id: 1366
    league_id: 25
    team_id: 598
```

> 🔍 **Find your team_id**  
> Open your team’s CricClubs URL like  
> `https://cricclubs.com/HoustonPremierT20League/teamResults.do?teamId=598&league=25&clubId=1366`  
> → `teamId=598` is your team ID.

#### Customize
- Replace `team_dashboard/assets/royals_logo.png` with your team logo (optional).
---

## 📊 Outputs

```
cricclubs_export_out/
  ├─ HoustonPremierT20League_25/
  │   └─ matches.json
team_dashboard/
  ├─ index.html
  ├─ Team_Stats_Summary.pdf
  └─ summary.txt
```

Open the dashboard:
```bash
open team_dashboard/index.html
```

---

## 🧠 Insights Generated

- Top 5 batsmen (runs, strike rate, boundaries)
- Top 5 bowlers (wickets, economy)
- Dot-ball % leaderboard
- Win-rate by ground
- Common themes in matches lost
- Per-player breakdown via dropdown
- Aggregated performance across tournaments

---

## 🌐 GitHub Pages Hosting

You can make your dashboard publicly shareable via **GitHub Pages**:

1. Commit and push the generated `team_dashboard/` folder  
2. Go to **Settings → Pages**  
3. Choose **Source → GitHub Actions** (or `/ (root)` if available)  
4. Your dashboard will be available at:  
   ```
   https://<your-username>.github.io/team_analytics/
   ```

---

## 🧩 Optional Enhancements

| Feature | How to enable |
|----------|----------------|
| 🖼 Player photos | Add `players_csv: "players.csv"` to config, and create `name,photo_url` mapping |
| 🎯 Specific matches | Add `match_ids: [1861, 1843, 1841]` under a league |
| 🧵 Multi-tournament merge | Add more league blocks in `config.yaml` |
| 🔁 Retry/backoff | (optional) Improves reliability for large datasets |

---

## 🧰 Folder Structure

```
team_analytics/
│
├── cricclubs_export.py         # Fetch data from CricClubs (teamResults-based)
├── analyze.py                  # Compute stats, build dashboard
├── summary_report.py           # Create summary text/PDF
├── config.sample.yaml          # Template configuration
├── team_dashboard/             # Generated outputs
│   ├── index.html
│   ├── assets/
│   ├── Team_Stats_Summary.pdf
│   └── summary.txt
└── cricclubs_export_out/       # Raw match data
```

---

## 🧾 Version History

| Version | Change |
|----------|---------|
| **v1.0** | League-based discovery (deprecated) |
| **v1.1** | Switched to team-based `teamResults.do` discovery |
| **v1.2** | Added player dropdown insights & multi-tournament merge |

---

## 🧩 Troubleshooting

| Issue | Fix |
|-------|-----|
| `Found 0 matches` | Check your `team_id`, `league_id`, and `club_id` in config |
| `ModuleNotFoundError: yaml` | Run `pip install -r requirements.txt` again |
| `NotOpenSSLWarning` | Harmless; upgrade to Python 3.12+ to remove it |
| Empty PDF | Ensure matches.json contains at least one scorecard |

---

## 🏁 Credits

Built by cricket enthusiasts for cricket enthusiasts 🏏  
Easily adaptable for any CricClubs-hosted league or tournament.
