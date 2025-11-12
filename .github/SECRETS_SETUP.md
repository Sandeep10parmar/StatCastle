# GitHub Secrets Setup Guide

This guide explains how to configure GitHub Secrets for automatic StatCastle deployment.

## Required Secrets

To enable automatic data fetching and dashboard generation, you need to set up the following GitHub Secrets:

### Basic Configuration

1. **`TEAM_NAME`** - Your team name as it appears on CricClubs
   - Example: `Royals`

### League Configuration

For each league/tournament, you need 4 secrets. The workflow supports up to 10 leagues (numbered 1-10).

**Format:** `LEAGUE_N_BASE_PATH`, `LEAGUE_N_CLUB_ID`, `LEAGUE_N_LEAGUE_ID`, `LEAGUE_N_TEAM_ID`

**Example for League 1:**
- `LEAGUE_1_BASE_PATH`: `https://cricclubs.com/HoustonPremierT20League`
- `LEAGUE_1_CLUB_ID`: `1366`
- `LEAGUE_1_LEAGUE_ID`: `25`
- `LEAGUE_1_TEAM_ID`: `598`

**Example for League 2:**
- `LEAGUE_2_BASE_PATH`: `https://cricclubs.com/HoustonUnitedPremierLeague`
- `LEAGUE_2_CLUB_ID`: `13647`
- `LEAGUE_2_LEAGUE_ID`: `32`
- `LEAGUE_2_TEAM_ID`: `276`

## How to Set Up Secrets

1. Go to your repository on GitHub
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add each secret with its name and value
5. Click **Add secret**

## Finding Your Team IDs

1. Open your team's CricClubs URL:
   ```
   https://cricclubs.com/HoustonPremierT20League/teamResults.do?teamId=598&league=25&clubId=1366
   ```

2. Extract from URL:
   - `teamId=598` → `LEAGUE_N_TEAM_ID: 598`
   - `league=25` → `LEAGUE_N_LEAGUE_ID: 25`
   - `clubId=1366` → `LEAGUE_N_CLUB_ID: 1366`
   - Base URL → `LEAGUE_N_BASE_PATH: https://cricclubs.com/HoustonPremierT20League`

## Example: Setting Up 3 Leagues

If you have 3 leagues, set these secrets:

```
TEAM_NAME = "Royals"

LEAGUE_1_BASE_PATH = "https://cricclubs.com/HoustonPremierT20League"
LEAGUE_1_CLUB_ID = "1366"
LEAGUE_1_LEAGUE_ID = "25"
LEAGUE_1_TEAM_ID = "598"

LEAGUE_2_BASE_PATH = "https://cricclubs.com/HoustonUnitedPremierLeague"
LEAGUE_2_CLUB_ID = "13647"
LEAGUE_2_LEAGUE_ID = "32"
LEAGUE_2_TEAM_ID = "276"

LEAGUE_3_BASE_PATH = "https://cricclubs.com/HoustonPremierT20League"
LEAGUE_3_CLUB_ID = "1366"
LEAGUE_3_LEAGUE_ID = "24"
LEAGUE_3_TEAM_ID = "571"
```

## Verification

After setting up secrets:

1. The workflow will automatically create `config.yaml` from secrets
2. Data will be fetched and dashboard generated on each push
3. Check the Actions tab to see if the workflow runs successfully
4. Your dashboard will be available at: `https://<username>.github.io/StatCastle/`

## Security Notes

- Secrets are encrypted and never exposed in logs
- Only repository collaborators with write access can view/edit secrets
- Secrets are masked in workflow logs (values won't appear)
- The generated `config.yaml` is not committed to the repository

## Troubleshooting

**Dashboard shows empty data:**
- Check that all required secrets are set
- Verify secret names match exactly (case-sensitive)
- Check Actions logs for errors

**Workflow fails:**
- Ensure all league secrets are set (BASE_PATH, CLUB_ID, LEAGUE_ID, TEAM_ID)
- Verify team IDs are correct
- Check that TEAM_NAME matches your CricClubs team name

