# cricclubs_export.py
# Generic CricClubs exporter driven by config.yaml.
# - Reads base_path, club_id, league_id, team_name, and match_ids from config.yaml.
# - If league_id is present and match_ids is empty, auto-discovers match IDs from Schedule/Results pages.
# - Saves outputs under cricclubs_export_out/: matches.json, batting.csv, bowling.csv, (optional) balls.csv in future.

import re, time, json
from pathlib import Path

import requests
from bs4 import BeautifulSoup
import yaml

OUT = Path("cricclubs_export_out")
OUT.mkdir(exist_ok=True)

def load_config():
    cfg_path = Path("config.yaml")
    if not cfg_path.exists():
        raise SystemExit("config.yaml not found. Copy config.sample.yaml to config.yaml and fill in your details.")
    return yaml.safe_load(cfg_path.read_text())

def find_match_ids_from_league(base_path: str, league_id: int, club_id: int) -> list[int]:
    """Scrape Schedule/Results pages and extract matchIds from 'Full Scorecard' links."""
    session = requests.Session()
    def collect(url):
        try:
            r = session.get(url, timeout=20)
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "html.parser")
            ids = set()
            for a in soup.find_all("a", href=True):
                href = a["href"]
                # match patterns with matchId=NNNN
                m = re.search(r"matchId=(\d+)", href)
                if m:
                    ids.add(int(m.group(1)))
            return ids
        except Exception:
            return set()

    # Common endpoints for league views (paths vary a bit across themes; try a few).
    candidates = [
        f"{base_path}/viewLeague.do?league={league_id}&clubId={club_id}",
        f"{base_path}/viewLeague.do?clubId={club_id}&league={league_id}&_page=2",
        f"{base_path}/viewSchedule.do?league={league_id}&clubId={club_id}",
        f"{base_path}/viewResults.do?league={league_id}&clubId={club_id}",
    ]
    found = set()
    for url in candidates:
        found |= collect(url)
        time.sleep(0.8)
    return sorted(found)

def fetch_scorecard_html(base_path: str, club_id: int, match_id: int) -> str:
    url = f"{base_path}/viewScorecard.do?clubId={club_id}&matchId={match_id}"
    r = requests.get(url, timeout=20, headers={"User-Agent":"TeamAnalytics/1.0"})
    r.raise_for_status()
    return r.text

def main():
    cfg = load_config()
    base_path = cfg.get("base_path")
    club_id = int(cfg.get("club_id"))
    league_id = cfg.get("league_id")
    match_ids = cfg.get("match_ids") or []

    if not base_path or not club_id:
        raise SystemExit("base_path and club_id are required in config.yaml")

    if (not match_ids) and league_id:
        print(f"[i] Discovering match IDs from league {league_id} ...")
        match_ids = find_match_ids_from_league(base_path, int(league_id), club_id)
        print(f"[i] Found {len(match_ids)} matches")
    elif match_ids:
        print(f"[i] Using {len(match_ids)} match IDs from config")
    else:
        raise SystemExit("Provide either league_id for discovery or explicit match_ids in config.yaml")

    all_matches = []
    for mid in match_ids:
        try:
            html = fetch_scorecard_html(base_path, club_id, mid)
            all_matches.append({"match_id": mid, "html": html})
            print(f"✓ fetched match {mid}")
            time.sleep(0.5)
        except Exception as e:
            print(f"✗ match {mid}: {e}")

    (OUT / "matches.json").write_text(json.dumps(all_matches, indent=2), encoding="utf-8")
    print(f"[ok] Saved {len(all_matches)} scorecards to {OUT/'matches.json'}")

if __name__ == "__main__":
    main()
