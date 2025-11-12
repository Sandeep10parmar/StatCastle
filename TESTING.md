# Testing Guide for StatCastle

## Prerequisites

1. **Install dependencies** (if not already installed):
```bash
cd /Users/ssp/Downloads/statcastle
python3 -m venv .venv  # if virtual environment doesn't exist
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium  # Required for fetching scorecards and info pages
```

## Step 1: Test Data Export (Fetch Info Pages)

The export script now fetches the `info.do` page for each match to get series, ground, toss, and PoM data.

```bash
python3 cricclubs_export.py
```

**What to check:**
- Script should fetch scorecard, ball-by-ball, AND info.do for each match
- Look for messages like: `[fetch] 1872 …` and `[warn] match info fetch failed` (if any)
- Check that `cricclubs_export_out/HoustonPremierT20League_25/matches.json` contains `info_html` field for each match

**Quick verification:**
```bash
# Check if info_html is present in matches.json
python3 -c "import json; data=json.load(open('cricclubs_export_out/HoustonPremierT20League_25/matches.json')); print('Matches:', len(data)); print('Has info_html:', all('info_html' in m for m in data))"
```

## Step 2: Test Data Analysis

Run the analysis script to parse the new metadata and generate JSON files:

```bash
python3 analyze.py
```

**What to check:**
- Script should parse series, ground, toss, PoM from info_html
- Should track batting positions
- Should parse match results (Win/Loss/Draw)
- Should generate new JSON files:
  - `team_dashboard/assets/match_results.json` (last 5 matches)
  - `team_dashboard/assets/team_analytics.json` (win rates)
  - `team_dashboard/assets/series_list.json` (unique series)
  - `team_dashboard/assets/player_stats.json` (with position stats, recent performances, PoM)

**Quick verification:**
```bash
# Check generated files
ls -la team_dashboard/assets/*.json

# Check CSV columns include new fields
head -1 team_dashboard/assets/_debug_batting_rows.csv | tr ',' '\n' | grep -E "(Batting_Position|series|ground|toss|player_of_match|match_result|opponent)"
```

## Step 3: Test Dashboard

Open the dashboard in a web browser:

```bash
open team_dashboard/index.html
# Or on Linux:
# xdg-open team_dashboard/index.html
```

**What to test:**

### Home Page
1. ✅ **Last 5 Results** - Should show table with Date, Opponent, Result, Ground, Series
2. ✅ **Top 5 Batsmen** - Four cards showing:
   - Best Strike Rate (min 20 balls)
   - Most Runs
   - Most 4s
   - Most 6s
3. ✅ **Top 5 Bowlers** - Four cards showing:
   - Most Wickets
   - Most Dots
   - Best Economy
   - Best Strike Rate
4. ✅ **Player of the Match** - Should show PoM awards from last 5 matches

### Team Stats Page
1. ✅ Click "Team Stats" button in navigation
2. ✅ **Win Percentage** - Should show overall win %
3. ✅ **Win Rate by Ground** - Table with wins/losses/draws per ground
4. ✅ **Win Rate by Toss Outcome** - Table with wins/losses when batted/bowled first
5. ✅ **Win Rate by Match Type** - Table with League vs Playoff stats

### Player Stats Page
1. ✅ Click "Player Stats" button in navigation
2. ✅ Select a player from dropdown
3. ✅ **Player Card** - Should show:
   - Profile picture
   - Aggregated batting stats (Runs, SR, Avg, Dot%, 4s, 6s)
   - Aggregated bowling stats (Wickets, Overs, Econ, Dot%)
4. ✅ **Batting by Position** - Table showing SR and Avg for each position played
5. ✅ **Recent Performances** - Last 5 batting innings and bowling spells
6. ✅ **Man of the Match Awards** - List of matches where player was PoM

### Filters (All Pages)
1. ✅ **Date Range Picker** - Default should be last 30 days
2. ✅ Change start/end dates and click "Apply Filters"
3. ✅ **Series Multi-Select** - Should show all available series, all selected by default
4. ✅ Deselect some series, click "Apply Filters" - data should filter
5. ✅ Verify that all three pages update based on filters

## Step 4: Verify Data Quality

Check that the new fields are being populated correctly:

```bash
# Check batting CSV for new columns
python3 -c "
import pandas as pd
df = pd.read_csv('team_dashboard/assets/_debug_batting_rows.csv')
print('Columns:', list(df.columns))
print('\nSample rows with new fields:')
print(df[['Name', 'Batting_Position', 'series', 'ground', 'match_result', 'opponent_team']].head(10))
print('\nUnique series:', df['series'].dropna().unique())
print('\nUnique grounds:', df['ground'].dropna().unique())
"

# Check match results JSON
python3 -c "
import json
with open('team_dashboard/assets/match_results.json') as f:
    results = json.load(f)
print('Last 5 matches:')
for m in results:
    print(f\"  {m.get('match_date')} vs {m.get('opponent')} - {m.get('result')} ({m.get('ground')})\")
"

# Check team analytics
python3 -c "
import json
with open('team_dashboard/assets/team_analytics.json') as f:
    ta = json.load(f)
print('Overall Win %:', ta.get('overall_win_pct'))
print('Win rate by ground:', ta.get('win_rate_by_ground'))
"
```

## Troubleshooting

### If info_html is empty or missing:
- Check that Playwright is installed: `playwright install chromium`
- Try running with `HEADLESS=0 python3 cricclubs_export.py` to see browser
- Check network/connectivity to CricClubs

### If metadata fields are empty:
- Verify info_html was fetched (check matches.json)
- Check that the info.do page structure matches expected format
- May need to adjust regex patterns in `parse_match_metadata()`

### If batting positions are wrong:
- Positions are based on order in batting table
- Check that tables are being detected correctly
- Verify that invalid rows (extras, totals) are being filtered out

### If dashboard shows no data:
- Check browser console for JavaScript errors (F12)
- Verify all JSON files exist in `team_dashboard/assets/`
- Check that JSON files are valid: `python3 -m json.tool team_dashboard/assets/player_stats.json`

### If filters don't work:
- Check browser console for errors
- Verify date format in match_results.json matches YYYY-MM-DD
- Check that series names match exactly between series_list.json and match_results.json

## Expected Output Files

After running both scripts, you should have:

```
team_dashboard/assets/
├── _debug_batting_rows.csv      (with new columns)
├── _debug_bowling_rows.csv      (with new columns)
├── player_stats.json            (with position_stats, recent_batting, recent_bowling, pom_matches)
├── player_photos.json
├── match_results.json           (last 5 matches)
├── team_analytics.json          (win rates)
└── series_list.json             (unique series names)
```

## Quick Test Script

Run this to test everything at once:

```bash
#!/bin/bash
echo "1. Testing export..."
python3 cricclubs_export.py

echo "\n2. Testing analysis..."
python3 analyze.py

echo "\n3. Checking generated files..."
ls -la team_dashboard/assets/*.json

echo "\n4. Opening dashboard..."
open team_dashboard/index.html
```

