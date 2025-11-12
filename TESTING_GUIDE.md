# Testing Guide for Match Results Data

This guide explains how to test and validate the match results data to ensure correctness.

## Quick Test

Run the automated test script:

```bash
python3 test_match_results.py
```

This will validate:
- ✅ All expected matches are present
- ✅ Opponent names are valid (not navigation elements, series names, etc.)
- ✅ Toss winner and decision are populated
- ✅ Toss decision is contextual to team_name
- ✅ Match results are valid
- ✅ Required fields are present
- ✅ Data consistency

## Manual Verification Steps

### 1. Verify Match Count

Check that all expected matches are in the results:

```bash
# Count matches in results
python3 -c "import json; data=json.load(open('team_dashboard/assets/match_results.json')); print(f'Total matches: {len(data)}'); print('Match IDs:', sorted([m['match_id'] for m in data]))"

# Compare with config.yaml
python3 -c "import yaml; config=yaml.safe_load(open('config.yaml')); print('Expected match IDs:', config['leagues'][0]['match_ids'])"
```

**Expected**: 7 matches (match 1793 excluded due to forfeit)

### 2. Verify Opponent Names

Check that opponent names are actual team names, not navigation elements:

```bash
python3 -c "import json; data=json.load(open('team_dashboard/assets/match_results.json')); print('Opponent names:'); [print(f\"  Match {m['match_id']}: {m['opponent']}\") for m in sorted(data, key=lambda x: x['match_id'], reverse=True)]"
```

**Expected**: Valid team names like "Revenants", "Cypress Lakers", "Cyber Sluggers", etc.
**Should NOT see**: "Player Search", "Last Updated", "Series", "HPT20L", player names, etc.

### 3. Verify Toss Data

Check that toss_winner and toss_decision are populated and correct:

```bash
python3 -c "import json; data=json.load(open('team_dashboard/assets/match_results.json')); [print(f\"Match {m['match_id']}: toss_winner={m.get('toss_winner')}, toss_decision={m.get('toss_decision')} (Royals {'batted' if m.get('toss_decision')=='batted' else 'bowled'} first)\") for m in sorted(data, key=lambda x: x['match_id'], reverse=True)]"
```

**Expected**:
- `toss_winner` should be a team name (not null)
- `toss_decision` should be "batted" or "bowled"
- `toss_decision` should indicate what **Royals** did (batted or bowled first)

**Example validation**:
- If Royals won toss and elected to bat → `toss_decision: "batted"` ✓
- If Opponent won toss and elected to bat → `toss_decision: "bowled"` ✓ (Royals bowled first)

### 4. Verify Match Results

Check that match results are valid:

```bash
python3 -c "import json; data=json.load(open('team_dashboard/assets/match_results.json')); results = {}; [results.update({m['result']: results.get(m['result'], 0) + 1}) for m in data]; print('Results:', results)"
```

**Expected**: Only "Win", "Loss", "Draw", or "Tie"

### 5. Cross-Reference with Source Data

Compare with the exported match data:

```bash
# Check which matches were exported
python3 -c "import json; data=json.load(open('cricclubs_export_out/HoustonPremierT20League_25/matches.json')); print('Exported match IDs:', sorted([m['match_id'] for m in data]))"

# Check which matches have batting data
python3 -c "import csv; f=open('team_dashboard/assets/_debug_batting_rows.csv'); reader=csv.DictReader(f); match_ids=set(row['Match_Id'] for row in reader if row.get('Match_Id') and row['Match_Id'] != 'Match_Id'); f.close(); print('Matches with batting data:', sorted([int(m) for m in match_ids]))"
```

**Expected**: 
- All 8 matches exported
- 7 matches have batting data (1793 excluded due to forfeit)
- 7 matches in match_results.json

### 6. Visual Inspection

Open the JSON file and manually verify a few matches:

```bash
# Pretty print the results
python3 -m json.tool team_dashboard/assets/match_results.json | head -50
```

Check for:
- ✅ All fields populated
- ✅ Opponent names look correct
- ✅ Dates are in YYYY-MM-DD format
- ✅ Toss data makes sense

## Common Issues and Fixes

### Issue: Opponent name is "Player Search" or similar
**Cause**: Extraction is picking up navigation elements
**Fix**: The extraction logic filters these out. If still happening, check the HTML structure.

### Issue: Opponent name is a series name (e.g., "HPT20L_SERIES_22")
**Cause**: Extraction is picking up series metadata instead of team name
**Fix**: Series names are filtered. Verify table extraction is working.

### Issue: toss_winner is null
**Cause**: Toss info not parsed from info_html
**Fix**: Check that `info_html` is being fetched in `cricclubs_export.py`

### Issue: toss_decision doesn't match who won toss
**Cause**: Logic error in contextual conversion
**Fix**: Verify the logic in `parse_match_metadata` - if opponent won and elected to bat, Royals should have "bowled" first.

### Issue: Match 1793 missing
**Cause**: Forfeited match has no batting data
**Fix**: This is expected. Forfeited matches won't appear in results.

## Regression Testing

After making changes to `analyze.py`, run:

```bash
# 1. Re-run analysis
python3 analyze.py

# 2. Run automated tests
python3 test_match_results.py

# 3. Compare before/after (if you saved previous results)
diff team_dashboard/assets/match_results.json team_dashboard/assets/match_results.json.backup
```

## Continuous Validation

Add this to your workflow:

```bash
# In your analysis pipeline
python3 analyze.py && python3 test_match_results.py
```

The test script will exit with code 1 if any tests fail, making it suitable for CI/CD pipelines.

