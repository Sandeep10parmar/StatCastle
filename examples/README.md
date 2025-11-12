# Examples

This directory contains example files for StatCastle configuration.

## Files

- **`players.csv.example`** — Example player photo mapping CSV
  - Format: `Name,PhotoURL`
  - Copy to root directory as `players.csv` and update with your team's player photos
  - Reference in `config.yaml` with `players_csv: "players.csv"`

- **`logo.example.png`** — Example team logo
  - Replace `team_dashboard/assets/Royals_Logo.png` with your team logo
  - Or update the dashboard code to reference your logo path
  - Supported formats: PNG, JPG, SVG

## Usage

```bash
# Copy example files to use them
cp examples/players.csv.example players.csv
# Edit players.csv with your team's data

# Copy logo
cp examples/logo.example.png team_dashboard/assets/your-team-logo.png
```

