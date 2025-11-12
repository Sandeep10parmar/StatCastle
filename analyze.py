
#!/usr/bin/env python3
"""
analyze_loose_v6.py — stricter guards to stop batting rows leaking into bowling,
and to clean batting names + drop noise rows.

Fixes based on your samples:
- Batting:
  * Name is split from dismissal *even if the dismissal text is in the same cell*.
  * Drop rows whose first meaningful cell is "O", "R", or starts with "(" (Extras row like "(B 0 Lb 0 ...)").
  * Keep only: Name, Runs, Balls, 4s, 6s, SR, Dismissal Type, Match_Id.
- Bowling:
  * Reject any row containing dismissal keywords anywhere (c , b , lbw, st , run out, not out).
  * After the bowler's name, require that >= 80% of remaining tokens are numeric.
  * Keep the shift-left fix and basic plausibility bounds; require ≥4 of {o,m,dot,r,w,econ}.
- Section/header filters expanded.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from datetime import datetime

import numpy as np
import pandas as pd
import yaml
from bs4 import BeautifulSoup
from pathlib import Path

def norm(s): return re.sub(r"\s+", " ", (str(s) if s is not None else "").strip())
def lower(s): return norm(s).lower()
def title_clean(s): return norm(s).replace("*","").strip().title()

def _balls_from_overs_fallback(ov):
    if ov is None:
        return 0
    s = str(ov).strip()
    if not s:
        return 0
    if "." in s:
        o, b = s.split(".", 1)
        try: o = int(float(o))
        except: o = 0
        try: b = int(float(b))
        except: b = 0
        b = max(0, min(b, 5))
        return o * 6 + b
    try:
        val = int(float(s))
    except:
        return 0
    return val * 6 if val <= 80 else val

def _overs_from_balls_fallback(balls: int) -> str:
    if balls <= 0:
        return "0"
    o, b = divmod(int(balls), 6)
    return f"{o}.{b}"

def _sr_fallback(runs: int, balls: int) -> float:
    return round((runs / balls) * 100, 2) if balls > 0 else 0.0

def _eco_fallback(runs_conc: int, balls: int) -> float:
    return round(runs_conc / (balls / 6.0), 2) if balls > 0 else 0.0

def _avg_fallback(num: int, den: int) -> float:
    return round(num / den, 2) if den and den > 0 else 0.0

def canonical_name(s: str) -> str:
    """Create a normalized key for roster/name comparisons."""
    return re.sub(r"[^a-z0-9]+", " ", lower(s)).strip()

def load_config(path: Path | None = None) -> dict:
    path = path or Path("config.yaml")
    if not path.exists():
        return {}
    try:
        data = yaml.safe_load(path.read_text()) or {}
        if not isinstance(data, dict):
            raise ValueError("Config root must be a mapping.")
        return data
    except Exception as exc:
        raise SystemExit(f"Failed to load config from {path}: {exc}")

def load_roster(csv_path: str | None, base_dir: Path) -> tuple[dict, dict]:
    """Return (canon->display map, display->photo URL map) from players CSV."""
    if not csv_path:
        return {}, {}
    csv_path = csv_path.strip()
    path = Path(csv_path)
    if not path.is_absolute():
        path = (base_dir / csv_path).resolve()
    if not path.exists():
        print(f"[warn] players_csv not found at {path}; continuing without roster filter.")
        return {}, {}

    roster: dict[str, str] = {}
    photos: dict[str, str] = {}
    with path.open("r", encoding="utf-8") as f:
        reader = csv.reader(f)
        for row in reader:
            cells = [norm(c) for c in row if norm(c)]
            if not cells:
                continue
            name = cells[0]
            if lower(name) == "name":
                continue
            if name.lower().startswith("http"):
                continue
            display = title_clean(name)
            roster[canonical_name(name)] = display
            url = cells[1] if len(cells) >= 2 else ""
            if url:
                photos[display] = url
    if roster:
        print(f"[info] loaded {len(roster)} roster entries from {path}.")
    else:
        print(f"[warn] roster file {path} contained no player names.")
    return roster, photos

def normalize_with_roster(name: str, roster: dict[str, str], unknown: set[str]) -> str | None:
    """Return roster display name if known; otherwise add to unknown set."""
    if not roster:
        return name
    key = canonical_name(name)
    if key in roster:
        return roster[key]
    unknown.add(title_clean(name))
    return None

def discover_match_files() -> list[Path]:
    """Find all matches.json outputs in the export folder (latest first)."""
    candidates = []
    root = Path("cricclubs_export_out")
    if root.exists():
        candidates.extend(sorted(root.glob("**/matches.json")))
    standalone = Path("matches.json")
    if standalone.exists():
        candidates.append(standalone)
    # Sort newest first for determinism
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates

def detect_table_context(rows: list[list[str]]) -> tuple[str, str] | tuple[None, None]:
    """Return (kind, team_owner) based on header row, if identifiable."""
    if not rows:
        return (None, None)
    header = lower(" ".join(rows[0]))
    if not header:
        return (None, None)
    if "innings" in header:
        team = header.split("innings", 1)[0].strip(" :-")
        return ("batting", canonical_name(team))
    if "bowling" in header:
        team = header.split("bowling", 1)[0].strip(" :-")
        return ("bowling", canonical_name(team))
    return (None, None)

DATE_PATTERNS = [
    "%m/%d/%Y",  # 10/18/2025 (CricClubs standard format - month/day/year)
    "%m-%d-%Y",  # 10-18-2025 (month-day-year)
    "%b %d %Y",  # Oct 18 2025 (month day year)
    "%d/%m/%Y",  # 18/10/2025 (day/month/year - fallback for other sources)
    "%d-%m-%Y",  # 18-10-2025 (day-month-year)
    "%d %b %Y",  # 18 Oct 2025 (day month year)
    "%Y-%m-%d",  # 2025-10-18 (ISO format - handle with care, may be YYYY-DD-MM)
]

def parse_date_safely(date_str: str) -> str | None:
    """
    Parse a date string, handling ambiguous formats.
    CricClubs uses MM/DD/YYYY format, so we prioritize month/day/year patterns.
    For dates matching YYYY-MM-DD pattern, check if it might actually be YYYY-DD-MM.
    """
    date_str = date_str.strip()
    
    # Try standard patterns first (prioritize CricClubs formats)
    for fmt in DATE_PATTERNS:
        try:
            dt = datetime.strptime(date_str, fmt)
            # If we matched %Y-%m-%d, check if it might actually be YYYY-DD-MM format
            if fmt == "%Y-%m-%d":
                # Check if this could be YYYY-DD-MM format
                parts = date_str.split('-')
                if len(parts) == 3:
                    try:
                        year = int(parts[0])
                        part1 = int(parts[1])
                        part2 = int(parts[2])
                        
                        # If part1 > 12, it's definitely a day (YYYY-DD-MM format)
                        # If part2 > 12, it's also definitely YYYY-DD-MM
                        if part1 > 12 or part2 > 12:
                            # Reinterpret as YYYY-DD-MM: year, day, month
                            day = part1
                            month = part2
                            # Validate month is valid (1-12)
                            if 1 <= month <= 12:
                                dt = datetime(year, month, day)
                        # If both parts <= 12, it's ambiguous
                        # Since CricClubs uses MM/DD/YYYY, YYYY-MM-DD is the correct interpretation
                        # (not YYYY-DD-MM). So we keep the original YYYY-MM-DD interpretation.
                        # Only reinterpret if one part > 12 (definitely YYYY-DD-MM)
                    except (ValueError, IndexError):
                        pass  # Use original interpretation
            return dt.strftime("%Y-%m-%d")
        except (ValueError, TypeError):
            continue
    
    return None

def parse_match_metadata(full_html: str | None, info_html: str | None = None, team_name: str | None = None) -> dict:
    meta = {
        "match_date": None, "match_type": None, "is_playoff": False,
        "series": None, "ground": None, "toss_winner": None, "toss_decision": None,
        "player_of_match": None
    }
    if not full_html and not info_html:
        return meta
    
    # Parse from full_html (scorecard)
    text = full_html or ""
    def _extract(label, source_text=None):
        if source_text is None:
            source_text = text
        patterns = [
            rf"{label}[^<]*</td>\s*<td[^>]*>([^<]+)",
            rf"{label}[^<]*</th>\s*<td[^>]*>([^<]+)",
            rf"{label}\s*[:\-]\s*([A-Za-z0-9,\-/ ]+)",
            rf"<td[^>]*>{label}[^<]*</td>\s*<td[^>]*>([^<]+)",
        ]
        for pat in patterns:
            m = re.search(pat, source_text, flags=re.I)
            if m:
                return norm(m.group(1))
        return None
    
    date_raw = _extract("Date")
    if date_raw:
        meta["match_date"] = parse_date_safely(date_raw)
        if not meta["match_date"]:
            meta["match_date"] = date_raw.strip()
    
    match_type = _extract("Match\\s*Type")
    if match_type:
        meta["match_type"] = match_type
        if re.search(r"(quarter|semi|final|playoff)", match_type, re.I):
            meta["is_playoff"] = True
    
    # Parse from info_html if available
    if info_html:
        info_text = info_html
        
        # Series - from match-summary div
        series_match = re.search(r'<div[^>]*class[^>]*match-summary[^>]*>.*?<h3><strong>\s*([^<]+)</strong>', info_text, re.I | re.S)
        if series_match:
            meta["series"] = norm(series_match.group(1))
        
        # Date - from ms-league-name or match-summary
        if not meta["match_date"]:
            date_match = re.search(r'<h3[^>]*class[^>]*ms-league-name[^>]*>.*?(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})', info_text, re.I | re.S)
            if date_match:
                date_raw = date_match.group(1)
                meta["match_date"] = parse_date_safely(date_raw)
                if not meta["match_date"]:
                    meta["match_date"] = date_raw.strip()
        
        # Ground/Venue - from table with <th>Ground:</th> or <th>Venue:</th>
        ground_match = re.search(r'<th[^>]*>(?:Ground|Venue|Location):</th>\s*<th[^>]*>([^<]+)', info_text, re.I | re.S)
        if ground_match:
            meta["ground"] = norm(ground_match.group(1))
        
        # Toss - from table with <th>Toss:</th>
        toss_match = re.search(r'<th[^>]*>Toss:</th>\s*<th[^>]*>([^<]+(?:<[^>]+>[^<]+</[^>]+>)*[^<]*)', info_text, re.I | re.S)
        if toss_match:
            toss_text = norm(re.sub(r'<[^>]+>', ' ', toss_match.group(1)))  # Remove HTML tags
            meta["toss_winner"] = toss_text
            # Extract team name and decision
            team_match = re.search(r'([A-Za-z0-9\s]+)\s+won\s+the\s+toss', toss_text, re.I)
            toss_winner_name = None
            if team_match:
                toss_winner_name = norm(team_match.group(1))
                meta["toss_winner"] = toss_winner_name
            
            # Determine what the toss winner chose
            toss_winner_decision = None
            if re.search(r'\belected\s+to\s+bat\b|\bbatted\b', toss_text, re.I):
                toss_winner_decision = "batted"
            elif re.search(r'\belected\s+to\s+bowl\b|\bbowled\b|\bfield\b', toss_text, re.I):
                toss_winner_decision = "bowled"
            
            # Make toss_decision contextual to team_name
            if team_name and toss_winner_name and toss_winner_decision:
                team_key = canonical_name(team_name)
                winner_key = canonical_name(toss_winner_name)
                # If our team won the toss, use their decision as-is
                if team_key in winner_key or winner_key in team_key:
                    meta["toss_decision"] = toss_winner_decision
                else:
                    # If opponent won the toss, invert the decision
                    meta["toss_decision"] = "bowled" if toss_winner_decision == "batted" else "batted"
            elif toss_winner_decision:
                # Fallback: if we can't determine who won, just use the decision
                meta["toss_decision"] = toss_winner_decision
        
        # Player of the Match - from table with <th>Player of the Match:</th>
        pom_match = re.search(r'<th[^>]*>Player\s+of\s+the\s+Match:</th>\s*<th[^>]*>.*?<a[^>]*>([^<]+)</a>', info_text, re.I | re.S)
        if pom_match:
            meta["player_of_match"] = title_clean(pom_match.group(1))
        else:
            # Try without link
            pom_match2 = re.search(r'<th[^>]*>Player\s+of\s+the\s+Match:</th>\s*<th[^>]*>([^<]+)', info_text, re.I | re.S)
            if pom_match2:
                pom_text = norm(pom_match2.group(1))
                if pom_text and pom_text.lower() not in ['', 'none', 'n/a']:
                    meta["player_of_match"] = title_clean(pom_text)
        
        # Match Type - from ms-league-name (e.g., "Quarter Final")
        if not meta["match_type"]:
            match_type_match = re.search(r'<h3[^>]*class[^>]*ms-league-name[^>]*>([^<]+)', info_text, re.I | re.S)
            if match_type_match:
                match_type_text = norm(match_type_match.group(1))
                # Remove date part if present
                match_type_text = re.sub(r'\d{1,2}[/-]\d{1,2}[/-]\d{2,4}.*', '', match_type_text).strip()
                if match_type_text:
                    meta["match_type"] = match_type_text
                    if re.search(r"(quarter|semi|final|playoff)", match_type_text, re.I):
                        meta["is_playoff"] = True
    
    return meta

def parse_match_result(full_html: str | None, team_name: str, tables_html: str | None = None, info_html: str | None = None) -> dict:
    """Parse match result (Win/Loss/Draw) and opponent from scorecard HTML."""
    result_info = {
        "match_result": None,  # Win, Loss, Draw, Tie
        "result_margin": None,  # e.g., "15 runs", "5 wickets"
        "opponent_team": None
    }
    
    if not full_html or not team_name:
        return result_info
    
    # Invalid team names to filter out (navigation elements, buttons, etc.)
    INVALID_TEAM_NAMES = {
        "player search", "search", "view", "click", "here", "more", "details",
        "scorecard", "ball by ball", "info", "match", "league", "club", "team",
        "home", "back", "next", "previous", "menu", "navigation", "innings",
        "1st innings", "2nd innings", "first innings", "second innings",
        "last updated", "updated", "last", "chai n chutneys rcc",
        "hpt20l", "hpt20l_series", "series", "houston premier"  # Series/league names
    }
    
    # Look for result text patterns like "Team X won by Y runs/wickets"
    result_patterns = [
        r"([A-Za-z0-9\s]+)\s+won\s+by\s+(\d+)\s+(runs?|wickets?)",
        r"([A-Za-z0-9\s]+)\s+won\s+by\s+(\d+)\s+(run|wicket)",
        r"Match\s+(tied|drawn|draw)",
        r"([A-Za-z0-9\s]+)\s+beat\s+([A-Za-z0-9\s]+)",
    ]
    
    team_key = canonical_name(team_name)
    text = full_html
    
    for pattern in result_patterns:
        matches = re.finditer(pattern, text, re.I)
        for match in matches:
            groups = match.groups()
            if "tied" in match.group(0).lower() or "drawn" in match.group(0).lower() or "draw" in match.group(0).lower():
                result_info["match_result"] = "Draw"
                break
            
            winner = norm(groups[0]) if groups else ""
            winner_key = canonical_name(winner)
            
            if len(groups) >= 3:
                margin_num = groups[1] if len(groups) > 1 else ""
                margin_type = groups[2] if len(groups) > 2 else ""
                result_info["result_margin"] = f"{margin_num} {margin_type}"
            
            if winner_key and team_key:
                if winner_key in team_key or team_key in winner_key:
                    result_info["match_result"] = "Win"
                    # When team wins, don't set opponent from result text (will extract from tables)
                else:
                    result_info["match_result"] = "Loss"
                    # Filter invalid team names and exclude toss/score text
                    if (winner_key not in INVALID_TEAM_NAMES and
                        not re.search(r"won\s+the\s+toss|elected\s+to", winner, re.I) and
                        not re.search(r"\d+\s*[,:]\s*\d+", winner)):
                        result_info["opponent_team"] = title_clean(winner)
                break
    
    # Extract team names from table headers (batting/bowling tables)
    teams_from_tables = set()
    if tables_html:
        try:
            soup = BeautifulSoup(tables_html, "html.parser")
            for tbl in soup.find_all("table"):
                rows = table_rows(tbl)
                if rows:
                    # Get first row and join all cells, handling whitespace better
                    first_row_text = " ".join(rows[0])
                    # Clean up excessive whitespace and newlines
                    first_row_text = re.sub(r'\s+', ' ', first_row_text).strip()
                    header = lower(first_row_text)
                    
                    # Look for "innings" pattern - team name comes before "innings"
                    if "innings" in header:
                        # Split on "innings" and take the part before it
                        parts = header.split("innings", 1)
                        if parts:
                            team_raw = parts[0].strip()
                            # Remove common prefixes/suffixes and clean up
                            team_raw = re.sub(r"^(1st|2nd|first|second)\s+", "", team_raw, flags=re.I).strip()
                            team_raw = re.sub(r"\([^)]*\)", "", team_raw).strip()  # Remove parenthetical content like "(18 overs maximum)"
                            team_raw = re.sub(r":\s*$", "", team_raw).strip()
                            team_raw = re.sub(r'\s+', ' ', team_raw).strip()  # Normalize whitespace
                            
                            if team_raw and len(team_raw) > 2:
                                team_display = title_clean(team_raw)
                                team_key_candidate = canonical_name(team_display)
                                # Validate it's a real team name
                                if (team_key_candidate and 
                                    team_key_candidate not in INVALID_TEAM_NAMES and
                                    len(team_display) > 2 and len(team_display) < 50 and
                                    not re.search(r"\d{4}|\d{1,2}/\d{1,2}", team_display) and
                                    not re.search(r"^\d+\.", team_display)):  # Exclude dates and numbered lists
                                    teams_from_tables.add((team_display, team_key_candidate))
                    
                    # Also check for team names in cells that might not have "innings" keyword
                    # Sometimes the team name is just in the first cell
                    elif len(rows[0]) > 0:
                        first_cell = rows[0][0].strip()
                        if first_cell and len(first_cell) > 2 and len(first_cell) < 50:
                            # Check if it looks like a team name (not a label, not a number, etc.)
                            if (re.match(r'^[A-Za-z][A-Za-z0-9\s]+$', first_cell) and
                                not re.search(r"(bowling|overs|maximum|did not bat)", lower(first_cell), re.I) and
                                not re.search(r"\d{4}|\d{1,2}/\d{1,2}", first_cell)):
                                team_display = title_clean(first_cell)
                                team_key_candidate = canonical_name(team_display)
                                if (team_key_candidate and 
                                    team_key_candidate not in INVALID_TEAM_NAMES and
                                    team_key_candidate != team_key):  # Don't add our own team
                                    teams_from_tables.add((team_display, team_key_candidate))
        except Exception as e:
            pass
    
    # Extract opponent from info_html if available (but only as last resort)
    # Don't extract from info_html if we already have teams from tables
    if info_html and not result_info["opponent_team"] and len(teams_from_tables) == 0:
        # Look for team names in match info page
        info_soup = BeautifulSoup(info_html, "html.parser")
        # Try to find team names in various structures
        for elem in info_soup.find_all(["h2", "h3", "h4", "th", "td"]):
            text_content = norm(elem.get_text())
            if text_content and len(text_content) > 2 and len(text_content) < 50:
                text_key = canonical_name(text_content)
                # Filter out series names, league names, etc.
                if (text_key and text_key != team_key and 
                    text_key not in INVALID_TEAM_NAMES and
                    not re.search(r"series|league|hpt20l", text_key, re.I)):
                    # Check if it looks like a team name (not a label)
                    if not re.search(r"^(date|time|venue|ground|toss|match|series|league|club):", text_content, re.I):
                        teams_from_tables.add((title_clean(text_content), text_key))
    
    # If we didn't find opponent yet, try to extract from team names in the HTML
    # Always prioritize table headers as they're the most reliable source
    if result_info["match_result"] in ("Win", "Loss"):
        # First try teams from table headers (most reliable source)
        # When team wins, opponent is the other team in the tables
        # When team loses, we may have opponent from result text, but table is more reliable
        opponent_from_tables = None
        for team_display, team_key_candidate in teams_from_tables:
            if team_key_candidate != team_key:
                # Additional validation: ensure it doesn't contain score patterns, dates, etc.
                if (not re.search(r"\d+\s*[,:]\s*\d+", team_display) and
                    not re.search(r"\d{4}|\d{1,2}/\d{1,2}", team_display) and
                    "break" not in lower(team_display) and
                    "league" not in lower(team_display)):
                    opponent_from_tables = team_display
                    break
        
        # Use table-based opponent if found, otherwise keep what we have
        if opponent_from_tables:
            result_info["opponent_team"] = opponent_from_tables
        
        # Fallback: Look for team names in headers or table contexts in full_html
        if not result_info["opponent_team"]:
            # Improved regex to avoid matching navigation elements and toss/score text
            # Filter out text that contains common non-team phrases
            EXCLUDE_PATTERNS = [
                r"won\s+the\s+toss",
                r"elected\s+to\s+(bat|bowl)",
                r"\d+\s*[,:]\s*\d+",  # Score patterns like "2, 0" or "2:0"
                r"^\d+\.",  # Numbered lists like "1. Team"
                r"\d+\s*(min|pm|am|hr|hour)",  # Time patterns like "107 Min 3:38 Pm"
                r"(?:1st|2nd|first|second)\s+innings",  # "1st Innings:" etc.
                r":\s*$",  # Ends with colon (like "1St Innings:")
                r"\d{4}",  # Contains year (like "League 09/28/2025")
                r"\d{1,2}/\d{1,2}/\d{2,4}",  # Date patterns
                r"break",  # "Innings Break:"
                r"league\s+\d",  # "League 09/28/2025"
                r"last\s+updated",  # "Last Updated:"
                r"updated\s*:",  # "Updated:"
                r"houston\s+premier",  # League names
            ]
            
            team_pattern = r"(?:<h[1-6][^>]*>|<th[^>]*>|<td[^>]*class[^>]*team[^>]*>)([A-Za-z0-9\s]{2,30})(?:</h[1-6]>|</th>|</td>)"
            teams_found = re.findall(team_pattern, text, re.I)
            for team in teams_found:
                team_clean = canonical_name(team)
                team_stripped = team.strip()
                # Check if it matches exclusion patterns
                should_exclude = False
                for exclude_pat in EXCLUDE_PATTERNS:
                    if re.search(exclude_pat, team_stripped, re.I):
                        should_exclude = True
                        break
                
                # Additional check: exclude series/league names
                is_series_name = re.search(r"series|league|hpt20l", team_clean, re.I)
                
                if (not should_exclude and not is_series_name and 
                    team_clean and team_clean != team_key and 
                    team_clean not in INVALID_TEAM_NAMES and
                    len(team_stripped) > 2 and len(team_stripped) < 40):
                    result_info["opponent_team"] = title_clean(team_stripped)
                    break
    
    return result_info

def parse_ball_by_ball(ball_html: str | None) -> dict:
    """Return mapping of batter name -> {'balls': int, 'dots': int}."""
    if not ball_html:
        return {}
    soup = BeautifulSoup(ball_html, "html.parser")
    counts: dict[str, dict] = {}
    
    # Look for divs or other elements that might contain detailed ball data
    # Check for elements with class/id containing "ball", "detail", "expand", etc.
    detail_elements = soup.find_all(['div', 'span'], class_=re.compile(r'ball|detail|expand|over', re.I))
    if detail_elements:
        # Parse ball-by-ball commentary from these elements
        # Format: "0.1 Bowler to Batsman, X run" or "0.1 Bowler to Batsman WIDE" etc.
        for elem in detail_elements:
            text = elem.get_text(" ", strip=True)
            if not text or len(text) < 10:
                continue
            
            # Parse ball-by-ball entries
            # Pattern: OVER.BALL Bowler to Batsman, RUNS run
            # Examples: "0.1 Dhiraj P to Chirag B, 0 run", "0.1 Ashok Reddy N to Sandeep P WIDE"
            # Find pattern: "X.Y Bowler to Batsman" and extract what follows
            ball_pattern = r'(\d+)\.(\d+)\s+([A-Za-z][A-Za-z\s\.]+?)\s+to\s+([A-Za-z][A-Za-z\s\.]+?)(?:[,\s]+|$)'
            matches = re.finditer(ball_pattern, text, re.IGNORECASE)
            
            for match in matches:
                over_num = match.group(1)
                ball_num = match.group(2)
                bowler = match.group(3).strip()
                batsman = match.group(4).strip()
                
                # Get the text after the match (next 50 chars should contain run info)
                match_end = match.end()
                next_text = text[match_end:match_end+50].lower()
                
                # Check if this is a wide (skip wides)
                if "wide" in next_text or " wd" in next_text or next_text.strip().startswith("wd"):
                    continue  # Skip wides
                
                # Extract runs - look for patterns like ", X run" or "X run" or "Xnb" etc.
                runs = 0
                # Pattern 1: ", X run" or ", X runs"
                run_match = re.search(r',\s*(-?\d+)\s+run', next_text, re.I)
                if run_match:
                    try:
                        runs = int(run_match.group(1))
                    except (ValueError, TypeError):
                        runs = 0
                else:
                    # Pattern 2: "Xnb" or "X nb" (no-ball with runs)
                    nb_match = re.search(r'(\d+)\s*(?:nb|no\s+ball)', next_text, re.I)
                    if nb_match:
                        try:
                            runs = int(nb_match.group(1))
                        except (ValueError, TypeError):
                            runs = 0
                    # Pattern 3: Just "nb" or "no ball" (no-ball with 0 runs) - runs stays 0
                    # Pattern 4: No match found - assume 0 runs (dot ball)
                
                # Clean up batsman name (remove extra spaces, normalize)
                batsman = title_clean(batsman)
                if not batsman or len(batsman) < 2:
                    continue
                
                # Count the ball
                entry = counts.setdefault(batsman, {"balls": 0, "dots": 0})
                entry["balls"] += 1
                if runs == 0:
                    entry["dots"] += 1
    
    # Also check tables for ball-by-ball data (fallback for different formats)
    all_tables = soup.find_all("table")
    for tbl in all_tables:
        headers = [lower(h.get_text(" ", strip=True)) for h in tbl.find_all("th")]
        if not headers:
            continue
        
        # Check if this is the over-by-over format (has "over" in first column and team names)
        is_over_format = len(headers) >= 2 and "over" in headers[0] and any(len(h) > 2 for h in headers[1:3])
        
        if is_over_format:
            # Over-by-over format: headers like ['over', 'royals', 'revenants', ...]
            # This table likely just shows runs per over, not detailed ball-by-ball
            # Skip it as we've already parsed from detail elements above
            continue
        else:
            # Original format: look for batsman/striker and runs columns
            idx_bat = next((i for i, h in enumerate(headers) if any(x in h for x in ["batsman", "striker", "batter", "player"])), None)
            idx_runs = next((i for i, h in enumerate(headers) if any(x in h for x in ["run", "result", "runs", "score", "r"])), None)
            if idx_bat is None or idx_runs is None:
                continue
            
            for tr in tbl.find_all("tr"):
                cells = [norm(td.get_text(" ", strip=True)) for td in tr.find_all("td")]
                if len(cells) <= max(idx_bat, idx_runs):
                    continue
                batter = title_clean(cells[idx_bat])
                if not batter:
                    continue
                run_text = lower(cells[idx_runs])
                if not run_text:
                    continue
                if any(x in run_text for x in ("wide", "wd")):
                    continue  # not a legal ball faced (wides only, no-balls are counted)
                m = re.search(r"(-?\d+)", run_text)
                runs = int(m.group(1)) if m else 0
                entry = counts.setdefault(batter, {"balls": 0, "dots": 0})
                entry["balls"] += 1
                if runs == 0:
                    entry["dots"] += 1
    
    return counts

# Section / header / noise rows
SECTION_PATTERNS = [
    r"^bowling$",
    r"^batting$",
    r"^extras\b",
    r"^total\b",
    r"^did\s+not\s+bat\b",
    r"\binnings\b",
    r"\bleague\b",
    r"\b(houston\s+premier|hpt20l)\b",
    r"\bfall\s+of\s+wickets\b",
    r"\bpartnership\b",
    r"^[or]$",           # single-letter O / R noise rows
    r"^\(.*\)$",         # fully parenthetical lines e.g. "(B 0 Lb 0 ...)"
]

DISMISS_ANY = re.compile(
    r"\b(not out|c&b|c\b|c\s|b\b|b\s|lbw|st\b|st\s|run out|retired hurt|retired)",
    re.I,
)

def is_section_like(text: str) -> bool:
    t = lower(text)
    for pat in SECTION_PATTERNS:
        if re.search(pat, t):
            return True
    return False

def table_rows(html_table):
    rows = []
    for tr in html_table.find_all("tr"):
        cells = [norm(td.get_text(" ", strip=True)) for td in tr.find_all(["td","th"])]
        if any(cells):
            rows.append(cells)
    return rows

def looks_name(s: str) -> bool:
    s2 = s.replace("*","").strip()
    if not s2: return False
    if is_section_like(s2): return False
    if re.fullmatch(r"[\d\s\.\-\(\)\/:]+", s2): return False
    return any(ch.isalpha() for ch in s2)

def is_numish(x: str) -> bool:
    return re.fullmatch(r"\d+(\.\d+)?", x or "") is not None

def simplify_how_out(h: str) -> str:
    x = lower(h)
    if x.startswith("c"): return "catch"
    if x.startswith("b"): return "bowled"
    if x.startswith("not out"): return "not out"
    if "run out" in x: return "run out"
    if "lbw" in x: return "lbw"
    if x.startswith("st"): return "stumped"
    return h.strip()

def split_name_and_dismissal(text: str):
    """Split a batsman cell into (name, dismissal) even if both are in same cell."""
    s = norm(text)
    m = DISMISS_ANY.search(s)
    if m:
        name = s[:m.start()].strip()
        how = s[m.start():].strip()
    else:
        name, how = s, ""
    return title_clean(name), simplify_how_out(how)

def plausible_batting(runs, balls, sr, fours, sixes):
    ok_runs = (pd.isna(runs) or (0 <= runs <= 200))
    ok_balls = (pd.isna(balls) or (0 <= balls <= 120))
    ok_sr = (pd.isna(sr) or (10 <= sr <= 400))
    ok_46 = ((pd.isna(fours) or fours <= 30) and (pd.isna(sixes) or sixes <= 20))
    return ok_runs and ok_balls and ok_sr and ok_46

def plausible_bowling(o, m, dot, r, w, econ):
    checks = []
    checks.append(pd.isna(o) or (0 <= o <= 10))
    checks.append(pd.isna(m) or (0 <= m <= 5))
    checks.append(pd.isna(dot) or (0 <= dot <= 36))
    checks.append(pd.isna(r) or (0 <= r <= 120))
    checks.append(pd.isna(w) or (0 <= w <= 10))
    checks.append(pd.isna(econ) or (0.5 <= econ <= 20))
    return all(checks)

def parse_batting_row(cells, match_id, dot_lookup=None, meta=None, position=None):
    # find first meaningful cell
    first = None
    for i, c in enumerate(cells):
        if c.strip():
            first = c; break
    if first is None: return None
    # reject O / R / (...) rows early
    if is_section_like(first):
        return None

    # find first name-like cell
    name_idx = None
    for i, c in enumerate(cells):
        if looks_name(c):
            name_idx = i; break
    if name_idx is None: return None

    raw_name = cells[name_idx]
    name, how_simpl = split_name_and_dismissal(raw_name)
    if name.lower() in {"extras","total"}: return None

    runs = balls = fours = sixes = sr = np.nan
    joined = " ".join(cells)

    # r(b) support
    mrb = re.search(r'(\d+)\s*[\(\s]\s*(\d+)\s*\)?', joined)
    if mrb:
        runs = float(mrb.group(1)); balls = float(mrb.group(2))

    tail = cells[name_idx+1:]
    ordered_nums = []
    for cell in tail:
        token = norm(cell)
        if not token:
            continue
        if is_numish(token):
            try:
                ordered_nums.append(float(token))
            except ValueError:
                continue
        else:
            combo = re.fullmatch(r"(\d+)\s*\((\d+)\)", token)
            if combo:
                ordered_nums.append(float(combo.group(1)))
                ordered_nums.append(float(combo.group(2)))

    def take_ord(idx):
        return ordered_nums[idx] if idx < len(ordered_nums) else np.nan

    if pd.isna(runs):
        runs = take_ord(0)
    if pd.isna(balls):
        balls = take_ord(1)
    if pd.isna(fours):
        val = take_ord(2)
        if pd.notna(val) and val <= 36:
            fours = val
    if pd.isna(sixes):
        val = take_ord(3)
        if pd.notna(val) and val <= 36:
            sixes = val
    if pd.isna(sr):
        val = take_ord(4)
        if pd.notna(val):
            sr = val

    # integer harvesting fallback
    ints = [int(x) for x in cells if re.fullmatch(r"\d+", x)]
    if np.isnan(runs) and ints:
        runs = float(max(ints))
    if np.isnan(balls) and len(ints) >= 2:
        balls = float(sorted(ints)[-2])
    small = [v for v in ints if v <= 6]
    if np.isnan(fours) and small:
        fours = float(small[0])
    if np.isnan(sixes) and len(small) >= 2:
        sixes = float(small[1])

    # SR fallback
    if np.isnan(sr):
        for x in cells:
            try:
                v = float(x)
                if 20.0 <= v <= 400.0:
                    sr = v; break
            except: pass

    # clamp impossible boundary counts
    if pd.notna(runs):
        if pd.notna(sixes) and sixes * 6 > runs:
            sixes = max(0.0, np.floor(runs / 6.0))
        if runs == 0:
            fours = 0.0 if pd.notna(fours) else fours
            sixes = 0.0 if pd.notna(sixes) else sixes

    if not plausible_batting(runs, balls, sr, fours, sixes):
        return None

    rec = {
        "Name": name,
        "Runs": runs if pd.notna(runs) else np.nan,
        "Balls": balls if pd.notna(balls) else np.nan,
        "4s": fours if pd.notna(fours) else np.nan,
        "6s": sixes if pd.notna(sixes) else np.nan,
        "SR": sr if pd.notna(sr) else np.nan,
        "Dismissal Type": how_simpl,
        "Match_Id": match_id,
        "Batting_Position": position if position is not None else np.nan,
        "match_date": meta.get("match_date") if meta else None,
        "match_type": meta.get("match_type") if meta else None,
        "is_playoff": meta.get("is_playoff") if meta else False,
    }
    if dot_lookup:
        dots = dot_lookup.get(name)
        if not dots and name.lower().endswith("*"):
            dots = dot_lookup.get(title_clean(name.replace("*","")))
        # Try case-insensitive exact match
        if not dots:
            name_lower = name.lower()
            for lookup_name, lookup_data in dot_lookup.items():
                if lookup_name.lower() == name_lower:
                    dots = lookup_data
                    break
        # Try partial name matching (ball-by-ball might have shortened names)
        # e.g., "Sandeep" in ball-by-ball should match "Sandeep Parmar" in batting
        if not dots:
            name_parts = name.split()
            if name_parts:
                first_name = name_parts[0].lower()
                # Try to find a match where the lookup name starts with the first name
                # or the first name starts with the lookup name
                for lookup_name, lookup_data in dot_lookup.items():
                    lookup_lower = lookup_name.lower()
                    lookup_parts = lookup_name.split()
                    # Match if first names match (most common case)
                    if lookup_parts and lookup_parts[0].lower() == first_name:
                        dots = lookup_data
                        break
                    # Or if lookup name is a substring of the full name
                    if first_name.startswith(lookup_lower) or lookup_lower.startswith(first_name):
                        # Make sure it's a reasonable match (at least 3 chars)
                        if len(lookup_lower) >= 3 and len(first_name) >= 3:
                            dots = lookup_data
                            break
        if dots:
            # Get dot ball counts (parse_ball_by_ball always initializes these, so they should exist)
            dot_count = dots.get("dots", 0) or 0
            ball_count = dots.get("balls", 0) or 0
            # Only set fields if we have tracked balls (ball_count > 0)
            if ball_count > 0:
                rec["bat_dot_balls"] = dot_count
                rec["bat_bbp_balls"] = ball_count
                rec["bat_dot_pct"] = round((dot_count / ball_count) * 100, 1)
            # If ball_count is 0, don't set these fields (they'll be NaN in the dataframe)
    rec["_score"] = sum(pd.notna(rec[k]) for k in ("Runs","Balls","4s","6s","SR"))
    return rec

def parse_bowling_row(cells, match_id):
    joined_all = " ".join(cells)
    # hard reject if any dismissal keyword appears anywhere in the row (these are batting rows)
    if DISMISS_ANY.search(joined_all):
        return None

    # find first name-like
    name_idx = None
    for i, c in enumerate(cells):
        if looks_name(c):
            name_idx = i; break
    if name_idx is None: return None
    name = title_clean(cells[name_idx])

    # after name, enforce numeric dominance
    tail = cells[name_idx+1:]
    if not tail:
        return None
    numish_ratio = (sum(1 for x in tail if is_numish(x)) / max(1, len(tail)))
    if numish_ratio < 0.8:
        return None

    nums = [c for c in tail if is_numish(c)]
    if len(nums) < 4:
        return None
    vals = [float(x) for x in nums[:6]]
    while len(vals) < 6: vals.append(np.nan)
    o, m, dot, r, w, econ = vals

    # shift-left fix
    population = [pd.notna(x) for x in [o,m,dot,r,w,econ]]
    if (not population[0]) and all(population[1:5]):
        o, m, dot, r, w, econ = m, dot, r, w, econ, (vals[5] if len(vals)>=6 else np.nan)

    # econ fallback as last numeric
    if (pd.isna(econ) or econ < 0.5) and len(nums) >= 6:
        try: econ = float(nums[5])
        except: pass

    if not plausible_bowling(o, m, dot, r, w, econ):
        return None

    extras_text = " ".join(x for x in tail if not is_numish(x))

    def _extract_extra(text, symbol):
        if not text:
            return 0
        patterns = [
            rf"\b{symbol}\s*(\d+)",
            rf"(\d+)\s*{symbol}",
        ]
        for pat in patterns:
            m = re.search(pat, text, flags=re.I)
            if m:
                try:
                    return int(m.group(1))
                except ValueError:
                    continue
        return 0

    wides = _extract_extra(extras_text, "(?:wd|w)")
    noballs = _extract_extra(extras_text, "nb")

    rec = {
        "bowler": name,
        "o": o,
        "m": m,
        "dot": dot,
        "r": r,
        "w": w,
        "econ": econ,
        "Wd": float(wides),
        "Nb": float(noballs),
        "match_id": match_id,
    }
    rec["_score"] = sum(pd.notna(rec[k]) for k in ("o","m","dot","r","w","econ"))
    if rec["_score"] < 4:
        return None
    return rec

def build_match_results(dfb: pd.DataFrame, dfw: pd.DataFrame, team_name: str) -> list:
    """Generate match results summary for all matches."""
    if dfb.empty:
        return []
    
    # Get unique matches with metadata
    match_data = []
    for match_id in dfb["Match_Id"].dropna().unique():
        match_rows = dfb[dfb["Match_Id"] == match_id]
        if match_rows.empty:
            continue
        
        first_row = match_rows.iloc[0]
        match_data.append({
            "match_id": int(match_id) if pd.notna(match_id) else None,
            "match_date": first_row.get("match_date"),
            "opponent": first_row.get("opponent_team"),
            "result": first_row.get("match_result"),
            "ground": first_row.get("ground"),
            "series": first_row.get("series"),
            "toss_winner": first_row.get("toss_winner"),
            "toss_decision": first_row.get("toss_decision"),
            "player_of_match": first_row.get("player_of_match"),
            "match_type": first_row.get("match_type"),
        })
    
    # Sort by date (most recent first), then by match_id as fallback
    def sort_key(m):
        date = m.get("match_date")
        if date:
            try:
                return datetime.strptime(date, "%Y-%m-%d")
            except:
                pass
        return datetime.min
    
    match_data.sort(key=sort_key, reverse=True)
    
    # Return all matches
    return match_data

def build_team_analytics(dfb: pd.DataFrame, dfw: pd.DataFrame, match_results: list, team_name: str) -> dict:
    """Generate team-level analytics including win rates."""
    analytics = {
        "team_name": team_name,
        "overall_win_pct": 0.0,
        "win_rate_by_ground": {},
        "win_rate_by_toss": {},
        "win_rate_by_match_type": {},
    }
    
    if dfb.empty:
        return analytics
    
    # Calculate overall win percentage
    matches = dfb["Match_Id"].dropna().unique()
    wins = losses = draws = 0
    for match_id in matches:
        match_rows = dfb[dfb["Match_Id"] == match_id]
        if match_rows.empty:
            continue
        result = match_rows.iloc[0].get("match_result")
        if result == "Win":
            wins += 1
        elif result == "Loss":
            losses += 1
        elif result == "Draw":
            draws += 1
    
    total_matches = wins + losses + draws
    if total_matches > 0:
        analytics["overall_win_pct"] = round((wins / total_matches) * 100, 1)
    
    # Win rate by ground
    ground_stats = {}
    for match_id in matches:
        match_rows = dfb[dfb["Match_Id"] == match_id]
        if match_rows.empty:
            continue
        ground = match_rows.iloc[0].get("ground")
        result = match_rows.iloc[0].get("match_result")
        if ground:
            if ground not in ground_stats:
                ground_stats[ground] = {"wins": 0, "losses": 0, "draws": 0}
            if result == "Win":
                ground_stats[ground]["wins"] += 1
            elif result == "Loss":
                ground_stats[ground]["losses"] += 1
            elif result == "Draw":
                ground_stats[ground]["draws"] += 1
    
    for ground, stats in ground_stats.items():
        total = stats["wins"] + stats["losses"] + stats["draws"]
        if total > 0:
            analytics["win_rate_by_ground"][ground] = {
                "win_pct": round((stats["wins"] / total) * 100, 1),
                "wins": stats["wins"],
                "losses": stats["losses"],
                "draws": stats["draws"],
                "total": total
            }
    
    # Win rate by toss decision
    toss_stats = {}
    for match_id in matches:
        match_rows = dfb[dfb["Match_Id"] == match_id]
        if match_rows.empty:
            continue
        toss_decision = match_rows.iloc[0].get("toss_decision")
        result = match_rows.iloc[0].get("match_result")
        if toss_decision:
            if toss_decision not in toss_stats:
                toss_stats[toss_decision] = {"wins": 0, "losses": 0, "draws": 0}
            if result == "Win":
                toss_stats[toss_decision]["wins"] += 1
            elif result == "Loss":
                toss_stats[toss_decision]["losses"] += 1
            elif result == "Draw":
                toss_stats[toss_decision]["draws"] += 1
    
    for toss, stats in toss_stats.items():
        total = stats["wins"] + stats["losses"] + stats["draws"]
        if total > 0:
            analytics["win_rate_by_toss"][toss] = {
                "win_pct": round((stats["wins"] / total) * 100, 1),
                "wins": stats["wins"],
                "losses": stats["losses"],
                "draws": stats["draws"],
                "total": total
            }
    
    # Win rate by match type (League vs Playoff)
    match_type_stats = {"League": {"wins": 0, "losses": 0, "draws": 0}, "Playoff": {"wins": 0, "losses": 0, "draws": 0}}
    for match_id in matches:
        match_rows = dfb[dfb["Match_Id"] == match_id]
        if match_rows.empty:
            continue
        is_playoff = match_rows.iloc[0].get("is_playoff", False)
        result = match_rows.iloc[0].get("match_result")
        match_type = "Playoff" if is_playoff else "League"
        if result == "Win":
            match_type_stats[match_type]["wins"] += 1
        elif result == "Loss":
            match_type_stats[match_type]["losses"] += 1
        elif result == "Draw":
            match_type_stats[match_type]["draws"] += 1
    
    for match_type, stats in match_type_stats.items():
        total = stats["wins"] + stats["losses"] + stats["draws"]
        if total > 0:
            analytics["win_rate_by_match_type"][match_type] = {
                "win_pct": round((stats["wins"] / total) * 100, 1),
                "wins": stats["wins"],
                "losses": stats["losses"],
                "draws": stats["draws"],
                "total": total
            }
    
    return analytics

def extract_series_list(dfb: pd.DataFrame) -> list:
    """Extract unique series names from match data."""
    if dfb.empty or "series" not in dfb.columns:
        return []
    series = dfb["series"].dropna().unique().tolist()
    return sorted([s for s in series if s])

def build_player_assets(dfb: pd.DataFrame, dfw: pd.DataFrame, roster_photos: dict[str, str]):
    assets = Path("team_dashboard/assets")
    assets.mkdir(parents=True, exist_ok=True)
    stats: dict[str, dict] = {}

    if not dfb.empty:
        bat_df = dfb.copy()
        for col in ["Runs","Balls","4s","6s","bat_dot_balls","bat_bbp_balls"]:
            if col in bat_df.columns:
                bat_df[col] = pd.to_numeric(bat_df[col], errors="coerce").fillna(0)
            else:
                bat_df[col] = 0
        bat_df["Dismissal Type"] = bat_df["Dismissal Type"].fillna("")
        bat_df["is_out"] = bat_df["Dismissal Type"].str.lower().apply(
            lambda x: 0 if (not x or "not out" in x) else 1
        )

        grouped = bat_df.groupby("Name", dropna=False).agg({
            "Runs":"sum",
            "Balls":"sum",
            "4s":"sum",
            "6s":"sum",
            "is_out":"sum",
            "bat_dot_balls":"sum",
            "bat_bbp_balls":"sum",
        })

        best_bat = (
            bat_df.sort_values(["Name","Runs","Balls"], ascending=[True, False, True])
                  .groupby("Name", group_keys=False)
                  .head(3)
        )
        best_bat_map: dict[str, list[str]] = {}
        for name, grp in best_bat.groupby("Name"):
            lines = []
            for _, row in grp.iterrows():
                runs = int(row.get("Runs", 0) or 0)
                balls = int(row.get("Balls", 0) or 0)
                lines.append(f"{runs} ({balls}b)")
            best_bat_map[name] = lines

        # Position-based stats
        position_stats = {}
        if "Batting_Position" in bat_df.columns:
            for pos in bat_df["Batting_Position"].dropna().unique():
                if pd.notna(pos) and pos > 0:
                    pos_df = bat_df[bat_df["Batting_Position"] == pos]
                    pos_grouped = pos_df.groupby("Name", dropna=False).agg({
                        "Runs": "sum",
                        "Balls": "sum",
                        "is_out": "sum",
                    })
                    for pname, prow in pos_grouped.iterrows():
                        if pname not in position_stats:
                            position_stats[pname] = {}
                        pruns = float(prow["Runs"])
                        pballs = float(prow["Balls"])
                        pouts = int(prow["is_out"])
                        # Count innings: number of rows (matches) where player batted at this position
                        player_pos_df = pos_df[pos_df["Name"] == pname]
                        innings_count = len(player_pos_df)
                        position_stats[pname][int(pos)] = {
                            "sr": _sr_fallback(pruns, pballs),
                            "avg": _avg_fallback(pruns, pouts),
                            "runs": int(round(pruns)),
                            "balls": int(round(pballs)),
                            "outs": pouts,
                            "innings": innings_count,
                        }
        
        # Ground-based batting stats
        ground_stats = {}
        if "ground" in bat_df.columns:
            for pname in bat_df["Name"].dropna().unique():
                player_grounds = bat_df[bat_df["Name"] == pname]
                for ground in player_grounds["ground"].dropna().unique():
                    ground_df = player_grounds[player_grounds["ground"] == ground]
                    if pname not in ground_stats:
                        ground_stats[pname] = {}
                    gruns = ground_df["Runs"].sum()
                    gballs = ground_df["Balls"].sum()
                    gouts = ground_df["is_out"].sum()
                    ground_stats[pname][ground] = {
                        "runs": int(round(gruns)),
                        "balls": int(round(gballs)),
                        "sr": _sr_fallback(gruns, gballs),
                        "avg": _avg_fallback(gruns, gouts),
                        "innings": len(ground_df),
                    }
        
        # Recent performances (last 5 innings)
        recent_batting = {}
        if "match_date" in bat_df.columns:
            for pname in bat_df["Name"].dropna().unique():
                player_matches = bat_df[bat_df["Name"] == pname].copy()
                player_matches = player_matches.sort_values("match_date", ascending=False).head(5)
                recent_batting[pname] = []
                for _, mrow in player_matches.iterrows():
                    recent_batting[pname].append({
                        "runs": int(mrow.get("Runs", 0) or 0),
                        "balls": int(mrow.get("Balls", 0) or 0),
                        "date": mrow.get("match_date"),
                        "opponent": mrow.get("opponent_team"),
                    })
        
        # Player of Match count and list
        pom_matches = {}
        if "player_of_match" in bat_df.columns:
            for _, row in bat_df.iterrows():
                pom = row.get("player_of_match")
                if pom and title_clean(str(pom)) == title_clean(str(row.get("Name", ""))):
                    match_id = row.get("Match_Id")
                    match_date = row.get("match_date")
                    opponent = row.get("opponent_team")
                    if pom not in pom_matches:
                        pom_matches[pom] = []
                    pom_matches[pom].append({
                        "match_id": int(match_id) if pd.notna(match_id) else None,
                        "date": match_date,
                        "opponent": opponent,
                    })
        
        # Dismissal type statistics
        dismissal_stats = {}
        for pname in bat_df["Name"].dropna().unique():
            player_rows = bat_df[bat_df["Name"] == pname]
            total_innings = len(player_rows)
            if total_innings > 0:
                dismissal_counts = {}
                for _, prow in player_rows.iterrows():
                    dismissal_type = str(prow.get("Dismissal Type", "")).strip().lower()
                    if not dismissal_type:
                        dismissal_type = "not out"
                    # Normalize dismissal type to match simplify_how_out output
                    # Check if already simplified first
                    if dismissal_type in ["catch", "bowled", "not out", "run out", "lbw", "stumped"]:
                        pass  # Already simplified
                    elif dismissal_type.startswith("c"):
                        dismissal_type = "catch"
                    elif dismissal_type.startswith("b"):
                        dismissal_type = "bowled"
                    elif "not out" in dismissal_type:
                        dismissal_type = "not out"
                    elif "run out" in dismissal_type:
                        dismissal_type = "run out"
                    elif "lbw" in dismissal_type:
                        dismissal_type = "lbw"
                    elif dismissal_type.startswith("st"):
                        dismissal_type = "stumped"
                    else:
                        dismissal_type = "other"
                    
                    dismissal_counts[dismissal_type] = dismissal_counts.get(dismissal_type, 0) + 1
                
                # Calculate percentages
                dismissal_stats[pname] = {}
                for dtype, count in dismissal_counts.items():
                    pct = round((count / total_innings) * 100, 1)
                    dismissal_stats[pname][dtype] = {
                        "count": count,
                        "pct": pct
                    }
        
        for name, row in grouped.iterrows():
            entry = stats.setdefault(name, {})
            runs = float(row["Runs"])
            balls = float(row["Balls"])
            entry["runs"] = int(round(runs))
            entry["balls"] = int(round(balls)) if balls else 0
            entry["4s"] = int(round(row["4s"]))
            entry["6s"] = int(round(row["6s"]))
            entry["sr"] = _sr_fallback(runs, balls)
            outs = int(row["is_out"])
            entry["outs"] = outs
            entry["avg"] = _avg_fallback(runs, outs)
            dot_balls = float(row.get("bat_dot_balls", 0))
            tracked = float(row.get("bat_bbp_balls", 0))
            if tracked > 0:
                entry["bat_dot_pct"] = round((dot_balls / tracked) * 100, 1)
                entry["bat_dot_balls"] = int(round(dot_balls))
                entry["bat_tracked_balls"] = int(round(tracked))
                # Also set dot_pct for backward compatibility, but prefer bat_dot_pct
                if "dot_pct" not in entry:
                    entry["dot_pct"] = entry["bat_dot_pct"]
            if name in best_bat_map:
                entry["best_batting"] = best_bat_map[name]
            if name in position_stats:
                entry["position_stats"] = position_stats[name]
            if name in ground_stats:
                entry["ground_stats"] = ground_stats[name]
            if name in recent_batting:
                entry["recent_batting"] = recent_batting[name]
            if name in pom_matches:
                entry["pom_count"] = len(pom_matches[name])
                entry["pom_matches"] = pom_matches[name]
            if name in dismissal_stats:
                entry["dismissal_stats"] = dismissal_stats[name]

    if not dfw.empty:
        bowl_df = dfw.copy()
        for col in ["o","m","dot","r","w","Wd","Nb"]:
            bowl_df[col] = pd.to_numeric(bowl_df[col], errors="coerce").fillna(0)
        bowl_df["balls_single"] = bowl_df["o"].apply(_balls_from_overs_fallback)

        grouped = bowl_df.groupby("bowler", dropna=False).agg({
            "balls_single":"sum",
            "dot":"sum",
            "r":"sum",
            "w":"sum",
            "Wd":"sum",
            "Nb":"sum",
        })

        best_bowl = (
            bowl_df.sort_values(["bowler","w","r","balls_single"], ascending=[True, False, True, False])
                   .groupby("bowler", group_keys=False)
                   .head(3)
        )
        best_bowl_map: dict[str, list[str]] = {}
        for name, grp in best_bowl.groupby("bowler"):
            lines = []
            for _, row in grp.iterrows():
                wickets = int(row.get("w", 0) or 0)
                runs = int(row.get("r", 0) or 0)
                balls = int(row.get("balls_single", 0) or 0)
                overs = _overs_from_balls_fallback(balls)
                lines.append(f"{wickets}/{runs} ({overs} ov)")
            best_bowl_map[name] = lines

        # Ground-based bowling stats
        bowl_ground_stats = {}
        if "ground" in bowl_df.columns:
            for pname in bowl_df["bowler"].dropna().unique():
                player_grounds = bowl_df[bowl_df["bowler"] == pname]
                for ground in player_grounds["ground"].dropna().unique():
                    ground_df = player_grounds[player_grounds["ground"] == ground]
                    if pname not in bowl_ground_stats:
                        bowl_ground_stats[pname] = {}
                    gballs = int(ground_df["balls_single"].sum())
                    govers = _overs_from_balls_fallback(gballs)
                    gruns = int(round(ground_df["r"].sum()))
                    gwickets = int(round(ground_df["w"].sum()))
                    gdot = int(round(ground_df["dot"].sum()))
                    gecon = _eco_fallback(gruns, gballs)
                    innings_count = len(ground_df)
                    bowl_ground_stats[pname][ground] = {
                        "innings": innings_count,
                        "overs": float(govers),
                        "dot_pct": round((gdot / gballs) * 100, 1) if gballs > 0 else 0.0,
                        "wickets": gwickets,
                        "econ": gecon,
                    }
        
        # Recent bowling performances (last 5 spells)
        recent_bowling = {}
        if "match_id" in bowl_df.columns and "match_date" in dfb.columns:
            # Join with batting df to get match dates
            match_dates = dfb[["Match_Id", "match_date"]].drop_duplicates().set_index("Match_Id")["match_date"].to_dict()
            bowl_df_with_date = bowl_df.copy()
            bowl_df_with_date["match_date"] = bowl_df_with_date["match_id"].map(match_dates)
            for pname in bowl_df_with_date["bowler"].dropna().unique():
                player_matches = bowl_df_with_date[bowl_df_with_date["bowler"] == pname].copy()
                player_matches = player_matches.sort_values("match_date", ascending=False, na_position='last').head(5)
                recent_bowling[pname] = []
                for _, mrow in player_matches.iterrows():
                    recent_bowling[pname].append({
                        "wickets": int(mrow.get("w", 0) or 0),
                        "runs": int(mrow.get("r", 0) or 0),
                        "overs": _overs_from_balls_fallback(int(mrow.get("balls_single", 0) or 0)),
                        "date": mrow.get("match_date"),
                        "opponent": mrow.get("opponent_team"),
                    })
        
        for name, row in grouped.iterrows():
            entry = stats.setdefault(name, {})
            balls = int(row["balls_single"])
            entry["wickets"] = int(round(row["w"]))
            entry["overs"] = float(_overs_from_balls_fallback(balls))
            entry["econ"] = _eco_fallback(row["r"], balls)
            if balls > 0:
                bowl_dot = round((row["dot"] / balls) * 100, 1)
                entry["bowl_dot_pct"] = bowl_dot
                # Don't overwrite batting dot_pct with bowling
                if "dot_pct" not in entry:
                    entry["dot_pct"] = bowl_dot
            entry["dot_balls"] = int(round(row["dot"]))
            entry["bowl_total_balls"] = balls
            entry["runs_conceded"] = int(round(row["r"]))
            entry["wides"] = int(round(row["Wd"]))
            entry["noballs"] = int(round(row["Nb"]))
            if name in best_bowl_map:
                entry["best_bowling"] = best_bowl_map[name]
            if name in recent_bowling:
                entry["recent_bowling"] = recent_bowling[name]
            if name in bowl_ground_stats:
                entry["bowl_ground_stats"] = bowl_ground_stats[name]

    stats_sorted = dict(sorted(stats.items()))
    (assets / "player_stats.json").write_text(json.dumps(stats_sorted, indent=2), encoding="utf-8")

    photo_map = {}
    for name, url in roster_photos.items():
        if url and name in stats_sorted:
            photo_map[name] = url
    (assets / "player_photos.json").write_text(json.dumps(photo_map, indent=2), encoding="utf-8")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--file",
        action="append",
        help="Path to matches.json (repeatable; defaults to all exports).",
    )
    args = ap.parse_args()

    root_dir = Path(__file__).resolve().parent
    cfg = load_config()
    team_name_cfg = title_clean(cfg.get("team_name", "")) if cfg.get("team_name") else ""
    team_key = canonical_name(team_name_cfg) if team_name_cfg else ""
    roster_map, roster_photos = load_roster(cfg.get("players_csv"), root_dir)

    if args.file:
        match_files = [Path(p) for p in args.file]
    else:
        match_files = discover_match_files()

    if not match_files:
        raise SystemExit("No matches.json found. Run cricclubs_export.py first.")

    bats, bowls = [], []
    seen_matches = set()
    unknown_batters: set[str] = set()
    unknown_bowlers: set[str] = set()

    for path in match_files:
        try:
            raw = json.loads(path.read_text())
        except Exception as exc:
            print(f"[warn] skipping {path}: {exc}")
            continue
        print(f"[debug] reading {path} — matches: {len(raw)}")
        if not raw:
            continue

        source_tag = path.parent.name or path.stem

        for match in raw:
            match_id = match.get("match_id")
            match_key = (source_tag, match_id)
            if match_key in seen_matches:
                continue
            seen_matches.add(match_key)

            html_tables = match.get("tables_html") or match.get("html", "")
            if not html_tables:
                continue
            full_html = match.get("full_html") or match.get("page_html") or html_tables
            info_html = match.get("info_html")
            match_meta = parse_match_metadata(full_html, info_html, team_name_cfg)
            match_result = parse_match_result(full_html, team_name_cfg, html_tables, info_html)
            match_meta.update(match_result)
            ball_html = match.get("ball_html")
            dots_raw = parse_ball_by_ball(ball_html)
            if ball_html and not dots_raw:
                print(f"[warn] match {match_id}: ball_html present but parse_ball_by_ball returned empty")
            elif not ball_html:
                print(f"[warn] match {match_id}: ball_html missing from match data")
            dot_lookup = {title_clean(k): v for k, v in dots_raw.items()}
            soup = BeautifulSoup(html_tables, "html.parser")

            for tbl in soup.find_all("table"):
                rows = table_rows(tbl)
                if not rows:
                    continue
                kind, owner = detect_table_context(rows)
                if kind not in {"batting", "bowling"}:
                    continue

                if team_key:
                    if owner:
                        if team_key not in owner:
                            continue
                    elif not roster_map:
                        # Without roster we cannot confidently filter ownerless tables.
                        continue

                # Track batting position per innings (reset for each batting table)
                batting_position = 0
                
                for r in rows:
                    if kind == "batting":
                        batting_position += 1  # Increment position for each row (will be adjusted if row is invalid)
                        br = parse_batting_row(r, match_id, dot_lookup, match_meta, position=batting_position)
                        if not br:
                            batting_position -= 1  # Decrement if row was invalid
                            continue
                        normalized = normalize_with_roster(br["Name"], roster_map, unknown_batters)
                        if normalized is None:
                            batting_position -= 1  # Decrement if player not in roster
                            continue
                        br["Name"] = normalized
                        # Add metadata fields to batting record
                        br["series"] = match_meta.get("series")
                        br["ground"] = match_meta.get("ground")
                        br["toss_winner"] = match_meta.get("toss_winner")
                        br["toss_decision"] = match_meta.get("toss_decision")
                        br["player_of_match"] = match_meta.get("player_of_match")
                        br["match_result"] = match_meta.get("match_result")
                        br["opponent_team"] = match_meta.get("opponent_team")
                        bats.append({k: v for k, v in br.items() if k != "_score"})
                    else:
                        wr = parse_bowling_row(r, match_id)
                        if not wr:
                            continue
                        normalized = normalize_with_roster(wr["bowler"], roster_map, unknown_bowlers)
                        if normalized is None:
                            continue
                        wr["bowler"] = normalized
                        # Add metadata fields to bowling record
                        wr["series"] = match_meta.get("series")
                        wr["ground"] = match_meta.get("ground")
                        wr["toss_winner"] = match_meta.get("toss_winner")
                        wr["toss_decision"] = match_meta.get("toss_decision")
                        wr["player_of_match"] = match_meta.get("player_of_match")
                        wr["match_result"] = match_meta.get("match_result")
                        wr["opponent_team"] = match_meta.get("opponent_team")
                        bowls.append({k: v for k, v in wr.items() if k != "_score"})

    if roster_map:
        if unknown_batters:
            print(f"[warn] Batting names missing from roster (dropped): {', '.join(sorted(unknown_batters))}")
        if unknown_bowlers:
            print(f"[warn] Bowling names missing from roster (dropped): {', '.join(sorted(unknown_bowlers))}")

    assets = Path("team_dashboard/assets"); assets.mkdir(parents=True, exist_ok=True)

    # Write batting
    bat_cols = [
        "Name","Runs","Balls","4s","6s","SR","Dismissal Type",
        "Match_Id","Batting_Position","match_date","match_type","is_playoff",
        "series","ground","toss_winner","toss_decision","player_of_match","match_result","opponent_team",
        "bat_dot_balls","bat_bbp_balls","bat_dot_pct"
    ]
    dfb = pd.DataFrame(bats)
    for c in bat_cols:
        if c not in dfb.columns:
            dfb[c] = pd.Series(dtype=object)
    dfb = dfb[bat_cols]
    
    # Check if dot ball data was found (warn if missing)
    if len(dfb) > 0:
        has_dot_data = dfb["bat_bbp_balls"].notna() & (dfb["bat_bbp_balls"] > 0)
        dot_count = has_dot_data.sum()
        if dot_count == 0:
            print(f"[warn] No dot ball data found in any batting records. Check if ball_html is being fetched in export script.")
    
    dfb.to_csv(assets / "_debug_batting_rows.csv", index=False)

    # Write bowling
    bowl_cols = [
        "bowler","o","m","dot","r","w","econ","Wd","Nb","match_id",
        "series","ground","toss_winner","toss_decision","player_of_match","match_result","opponent_team"
    ]
    dfw = pd.DataFrame(bowls)
    for c in bowl_cols:
        if c not in dfw.columns:
            dfw[c] = pd.Series(dtype=object)
    dfw = dfw[bowl_cols]
    dfw.to_csv(assets / "_debug_bowling_rows.csv", index=False)

    # Build match results
    match_results = build_match_results(dfb, dfw, team_name_cfg)
    (assets / "match_results.json").write_text(json.dumps(match_results, indent=2), encoding="utf-8")
    
    # Build team analytics
    team_analytics = build_team_analytics(dfb, dfw, match_results, team_name_cfg)
    (assets / "team_analytics.json").write_text(json.dumps(team_analytics, indent=2), encoding="utf-8")
    
    # Extract series list
    series_list = extract_series_list(dfb)
    (assets / "series_list.json").write_text(json.dumps(series_list, indent=2), encoding="utf-8")

    # Copy players.csv to assets if it exists (for dashboard to load)
    if cfg.get("players_csv"):
        players_csv_path = Path(cfg.get("players_csv"))
        if not players_csv_path.is_absolute():
            players_csv_path = (root_dir / players_csv_path).resolve()
        if players_csv_path.exists():
            import shutil
            shutil.copy2(players_csv_path, assets / "players.csv")
            print(f"[info] copied players.csv to assets/ for dashboard")

    build_player_assets(dfb, dfw, roster_photos)

    print("[ok] wrote CSVs at team_dashboard/assets — please open them to verify.")

if __name__ == "__main__":
    main()


# ======================
# Fallback: rebuild public CSVs from debug rows if needed
# ======================

try:
    ROOT_DIR = Path(__file__).resolve().parent
    _DASH_DIR = ROOT_DIR / "team_dashboard"
    _ASSETS_DIR = _DASH_DIR / "assets"

    _BAT_FILE = _DASH_DIR / "batting_stats.csv"
    _BOWL_FILE = _DASH_DIR / "bowling_stats.csv"

    _DBG_BAT_CANDIDATES = [
        _ASSETS_DIR / "debug_batting_rows.csv",
        _ASSETS_DIR / "_debug_batting_rows.csv",
    ]
    _DBG_BOWL_CANDIDATES = [
        _ASSETS_DIR / "debug_bowling_rows.csv",
        _ASSETS_DIR / "_debug_bowling_rows.csv",
    ]

    def _file_is_effectively_empty(fp: Path) -> bool:
        if not fp.exists():
            return True
        try:
            with fp.open("r", encoding="utf-8") as f:
                reader = csv.reader(f)
                rows = list(reader)
                return len(rows) <= 1
        except Exception:
            return True

    def _find_first_existing(paths):
        for p in paths:
            if p.exists():
                return p
        return None

    def _rebuild_from_debug():
        bat_debug = _find_first_existing(_DBG_BAT_CANDIDATES)
        bowl_debug = _find_first_existing(_DBG_BOWL_CANDIDATES)

        if not bat_debug and not bowl_debug:
            return False  # nothing to do

        # ---- Batting aggregation from debug ----
        bat_tot = {}
        if bat_debug:
            with bat_debug.open("r", encoding="utf-8") as f:
                rdr = csv.DictReader(f)
                for row in rdr:
                    name = (row.get("Name") or row.get("Player") or "").strip()
                    if not name:
                        continue
                    def _i(x, default=0):
                        try: return int(float(x))
                        except: return default

                    runs  = _i(row.get("Runs"))
                    balls = _i(row.get("Balls"))
                    fours = _i(row.get("4s") or row.get("4d"))
                    sixes = _i(row.get("6s") or row.get("6S"))
                    dismissal = lower(
                        row.get("Dismissal Type") or row.get("how out") or row.get("Dismissal") or ""
                    )
                    is_out = 0
                    if dismissal and "not out" not in dismissal:
                        is_out = 1 if (runs > 0 or balls > 0) else 0

                    if name not in bat_tot:
                        bat_tot[name] = {"Runs": 0, "Balls": 0, "4s": 0, "6s": 0, "Outs": 0}
                    bat_tot[name]["Runs"]  += runs
                    bat_tot[name]["Balls"] += balls
                    bat_tot[name]["4s"]    += fours
                    bat_tot[name]["6s"]    += sixes
                    bat_tot[name]["Outs"]  += is_out

            rows_bat = []
            for name, v in bat_tot.items():
                rows_bat.append({
                    "Player": name,
                    "Runs": v["Runs"],
                    "Balls": v["Balls"],
                    "4s": v["4s"],
                    "6s": v["6s"],
                    "Outs": v["Outs"],
                    "Avg": _avg_fallback(v["Runs"], v["Outs"]),
                    "SR": _sr_fallback(v["Runs"], v["Balls"]),
                })
            rows_bat.sort(key=lambda r: (r["Runs"], r["Avg"], r["SR"]), reverse=True)

            _DASH_DIR.mkdir(parents=True, exist_ok=True)
            with (_DASH_DIR / "batting_stats.csv").open("w", encoding="utf-8", newline="") as f:
                w = csv.DictWriter(f, fieldnames=["Player","Runs","Balls","4s","6s","Outs","Avg","SR"])
                w.writeheader()
                for r in rows_bat:
                    w.writerow(r)

        # ---- Bowling aggregation from debug ----
        bowl_tot = {}
        if bowl_debug:
            with bowl_debug.open("r", encoding="utf-8") as f:
                rdr = csv.DictReader(f)
                for row in rdr:
                    name = (row.get("bowler") or row.get("Player") or "").strip()
                    if not name:
                        continue
                    def _i(x, d=0):
                        try: return int(float(x))
                        except: return d
                    overs   = row.get("o") or row.get("Overs")
                    maidens = _i(row.get("m") or row.get("Maidens"))
                    runs    = _i(row.get("r") or row.get("Runs"))
                    wkts    = _i(row.get("w") or row.get("Wkts"))
                    wides   = _i(row.get("Wd") or row.get("Wides"))
                    noballs = _i(row.get("Nb") or row.get("NoBalls"))
                    balls   = _balls_from_overs_fallback(overs)

                    if name not in bowl_tot:
                        bowl_tot[name] = {"Balls": 0, "M": 0, "R": 0, "W": 0, "Wd": 0, "Nb": 0}
                    bowl_tot[name]["Balls"] += balls
                    bowl_tot[name]["M"]     += maidens
                    bowl_tot[name]["R"]     += runs
                    bowl_tot[name]["W"]     += wkts
                    bowl_tot[name]["Wd"]    += wides
                    bowl_tot[name]["Nb"]    += noballs

            rows_bowl = []
            for name, v in bowl_tot.items():
                rows_bowl.append({
                    "Player": name,
                    "Overs": _overs_from_balls_fallback(v["Balls"]),
                    "Maidens": v["M"],
                    "Runs": v["R"],
                    "Wkts": v["W"],
                    "Wd": v["Wd"],
                    "Nb": v["Nb"],
                    "Eco": _eco_fallback(v["R"], v["Balls"]),
                    "Avg (Runs/Wkt)": _avg_fallback(v["R"], v["W"]),
                    "SR (Balls/Wkt)": _avg_fallback(v["Balls"], v["W"]),
                })
            rows_bowl.sort(key=lambda r: (r["Wkts"], -r["Eco"], r["Runs"]), reverse=True)

            with (_DASH_DIR / "bowling_stats.csv").open("w", encoding="utf-8", newline="") as f:
                w = csv.DictWriter(f, fieldnames=["Player","Overs","Maidens","Runs","Wkts","Wd","Nb","Eco","Avg (Runs/Wkt)","SR (Balls/Wkt)"])
                w.writeheader()
                for r in rows_bowl:
                    w.writerow(r)

        return True

    def _fallback_if_needed(force: bool = False):
        if not force:
            need_bat = _file_is_effectively_empty(_BAT_FILE)
            need_bowl = _file_is_effectively_empty(_BOWL_FILE)
            if not (need_bat or need_bowl):
                return
        built = _rebuild_from_debug()
        if built:
            print("🔁 Rebuilt public stats from debug rows.")
        else:
            print("ℹ️ No debug rows found to rebuild from.")
    
    _fallback_if_needed(force=True)

except Exception as _e:
    print(f"Fallback rebuild skipped due to error: {_e}")
