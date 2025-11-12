# StatCastle

## Running the Dashboard

The dashboard requires a local HTTP server due to browser CORS restrictions. You cannot open `index.html` directly in a browser.

### Option 1: Using the provided script

```bash
cd team_dashboard
./serve.sh
```

Then open http://localhost:8000 in your browser.

### Option 2: Using Python

```bash
cd team_dashboard
python3 -m http.server 8000
```

Then open http://localhost:8000 in your browser.

### Option 3: Using Node.js (if you have it)

```bash
cd team_dashboard
npx http-server -p 8000
```

Then open http://localhost:8000 in your browser.

## Troubleshooting

If data is not loading:
1. Make sure you're accessing via `http://localhost:8000` (not `file://`)
2. Check the browser console (F12) for error messages
3. Verify that all JSON files exist in the `assets/` directory:
   - `player_stats.json`
   - `player_photos.json`
   - `match_results.json`
   - `team_analytics.json`
   - `series_list.json`

