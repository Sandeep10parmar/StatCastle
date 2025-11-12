# quick_fetch_one.py
# Robust scorecard fetcher for CricClubs (handles lazy loading & mild bot protection)
# Usage:
#   source .venv/bin/activate
#   pip install playwright
#   playwright install chromium
#   python quick_fetch_one.py
#
# If you still see timeouts, try HEADFUL mode:
#   HEADLESS=0 python quick_fetch_one.py
#
from playwright.sync_api import sync_playwright, TimeoutError as PTimeout
from pathlib import Path
import json, os, random, re, time
import requests
import yaml
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
import asyncio

# Configuration will be loaded from config.yaml

DESKTOP_UAS = [
    # Recent desktop Chrome UAs (rotate to avoid trivial blocks)
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
]

HEADLESS = os.environ.get("HEADLESS", "1") != "0"
# Performance settings
MAX_LEAGUE_WORKERS = int(os.environ.get("MAX_LEAGUE_WORKERS", "3"))  # Parallel leagues
MAX_MATCH_WORKERS = int(os.environ.get("MAX_MATCH_WORKERS", "4"))  # Parallel matches per league
MATCH_DELAY = float(os.environ.get("MATCH_DELAY", "0.3"))  # Reduced from 0.8s
FORCE_REFRESH = os.environ.get("FORCE_REFRESH", "0") != "0"
print_lock = Lock()  # Thread-safe printing

def new_context(pw, base_path: str = None, league_id: int = None, club_id: int = None):
    ua = random.choice(DESKTOP_UAS)
    browser = pw.chromium.launch(headless=HEADLESS, args=[
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage",
    ])
    headers = {
        "Accept-Language": "en-US,en;q=0.9",
        "Upgrade-Insecure-Requests": "1",
        "Cache-Control": "max-age=0",
    }
    # set a referer that looks like site navigation if we have the info
    if base_path and league_id and club_id:
        headers["Referer"] = f"{base_path}/viewLeague.do?league={league_id}&clubId={club_id}"
    context = browser.new_context(
        user_agent=ua,
        viewport={"width": 1366, "height": 2500},
        locale="en-US",
        timezone_id="America/Chicago",
        java_script_enabled=True,
        ignore_https_errors=True,
        extra_http_headers=headers,
    )
    # Light stealth: remove webdriver flag
    context.add_init_script("""
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    """)
    # Speed up: block images/fonts/analytics
    def _route(route):
        url = route.request.url
        if any(x in url for x in [".png",".jpg",".jpeg",".gif",".webp",".svg",".woff",".woff2",".ttf","googletag","google-analytics","doubleclick"]):
            return route.abort()
        return route.continue_()
    context.route("**/*", _route)
    return browser, context

SEL_CANDIDATES = [
    "table.batsman", "table.bowler",
    "table:has(th:has-text('Batsman'))",
    "table:has(th:has-text('Bowler'))",
    "table:has(th:has-text('R')):has(th:has-text('B')):has(th:has-text('SR'))",
    "table:has(th:has-text('O')):has(th:has-text('R')):has(th:has-text('W'))",
    "#scoreCard", "#scorecard", ".scorecard", "#score-details"
]

COMMON_HTTP_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

def extract_tables_html(page):
    # stitch candidate tables' outerHTML (up to 60 to be safe)
    loc = page.locator("table")
    n = loc.count()
    parts = []
    for i in range(min(n, 60)):
        try:
            parts.append(loc.nth(i).evaluate("el => el.outerHTML"))
        except Exception:
            pass
    if parts:
        return "\\n".join(parts)
    # fallback: entire body
    try:
        return page.evaluate("() => document.body.innerHTML")
    except Exception:
        return ""

def fetch_scorecard_rendered(url: str, context=None, base_path: str = None, league_id: int = None, club_id: int = None, attempts: int = 3):
    """Fetch scorecard, optionally reusing a browser context."""
    last_err = None
    use_external_context = context is not None
    
    for attempt in range(1, attempts+1):
        if not use_external_context:
            try:
                pw = sync_playwright().start()
                browser, context = new_context(pw, base_path, league_id, club_id)
            except Exception as e:
                # If browser launch fails, it might be a path issue
                if "Executable doesn't exist" in str(e) or "asyncio" in str(e).lower():
                    with print_lock:
                        print(f"    !! Playwright error: {e}")
                        print(f"    !! This might be a browser installation issue. Try: playwright install chromium")
                    last_err = e
                    if attempt < attempts:
                        time.sleep(2.0 * attempt)
                        continue
                    raise
                raise
        else:
            browser = None  # External context manages browser
        
        page = context.new_page()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
            for y in (800, 1600, 2400):
                page.mouse.wheel(0, y)
                page.wait_for_timeout(300)
            found = False
            for sel in SEL_CANDIDATES:
                try:
                    page.wait_for_selector(sel, state="visible", timeout=6000)
                    found = True
                    break
                except PTimeout:
                    continue
            if not found:
                try:
                    page.wait_for_load_state("networkidle", timeout=8000)
                except PTimeout:
                    pass
            tables = extract_tables_html(page)
            full_html = page.content()
            page.close()
            if tables and re.search(r"<table", tables, flags=re.I):
                if not use_external_context:
                    context.close()
                    browser.close()
                    pw.stop()
                return tables, full_html
            else:
                raise RuntimeError("no tables captured")
        except Exception as e:
            last_err = e
            try:
                page.close()
                if not use_external_context:
                    context.close()
                    browser.close()
                    pw.stop()
            except Exception:
                pass
            if not use_external_context:
                time.sleep(1.0 + attempt * 0.5)
            continue
        if not use_external_context:
            break
    raise RuntimeError(f"failed after {attempts} attempts: {last_err}")

def fetch_ball_by_ball(match_id: int, base_path: str, club_id: int, context=None, league_id: int = None, attempts: int = 3) -> str:
    """Fetch ball-by-ball data using Playwright to avoid 403 errors."""
    url = f"{base_path}/ballbyball.do?clubId={club_id}&matchId={match_id}"
    last_err = None
    use_external_context = context is not None
    
    for attempt in range(1, attempts+1):
        if not use_external_context:
            try:
                pw = sync_playwright().start()
                browser, context = new_context(pw, base_path, league_id, club_id)
            except Exception as e:
                if "Executable doesn't exist" in str(e) or "asyncio" in str(e).lower():
                    with print_lock:
                        print(f"    !! Playwright error: {e}")
                    last_err = e
                    if attempt < attempts:
                        time.sleep(2.0 * attempt)
                        continue
                    raise
                raise
        else:
            browser = None
        
        page = context.new_page()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            # Wait a bit longer for dynamic content to load
            page.wait_for_timeout(2000)
            # Try to wait for a table to appear (ball-by-ball should have tables)
            try:
                page.wait_for_selector("table", state="visible", timeout=5000)
            except PTimeout:
                pass  # Continue even if no table found immediately
            # Scroll to ensure content loads
            for y in (800, 1600):
                page.mouse.wheel(0, y)
                page.wait_for_timeout(500)
            ball_html = page.content()
            page.close()
            # Verify we got some content
            if ball_html and len(ball_html) > 1000:
                table_count = len(re.findall(r"<table", ball_html, flags=re.I))
                if not use_external_context:
                    context.close()
                    browser.close()
                    pw.stop()
                with print_lock:
                    print(f"  -> ball-by-ball: {len(ball_html)} chars, {table_count} tables")
                return ball_html
            else:
                raise RuntimeError(f"ball-by-ball page too short or empty ({len(ball_html) if ball_html else 0} chars)")
        except Exception as e:
            last_err = e
            try:
                page.close()
                if not use_external_context:
                    context.close()
                    browser.close()
                    pw.stop()
            except Exception:
                pass
            if not use_external_context:
                time.sleep(1.0 + attempt * 0.5)
            continue
        if not use_external_context:
            break
    with print_lock:
        print(f"[warn] ball-by-ball fetch failed for {match_id}: {last_err}")
    return ""

def discover_match_ids(base_path: str, club_id: int, league_id: int, team_id: int, attempts: int = 3) -> list[int]:
    """Discover match IDs from teamResults.do page."""
    url = f"{base_path}/teamResults.do?teamId={team_id}&league={league_id}&clubId={club_id}"
    last_err = None
    for attempt in range(1, attempts+1):
        try:
            with sync_playwright() as pw:
                browser, context = new_context(pw, base_path, league_id, club_id)
                page = context.new_page()
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=30000)
                    # Wait for content to load
                    page.wait_for_timeout(2000)
                    # Scroll to ensure all content loads
                    for y in (800, 1600, 2400):
                        page.mouse.wheel(0, y)
                        page.wait_for_timeout(500)
                    html = page.content()
                    page.close()
                    context.close()
                    browser.close()
                    
                    # Extract match IDs from links matching viewScorecard.do?matchId=XXXX
                    # Pattern: viewScorecard.do?clubId=XXXX&matchId=YYYY or viewScorecard.do?matchId=YYYY
                    match_ids = set()
                    # Try regex pattern to find all matchId parameters
                    patterns = [
                        r'viewScorecard\.do\?[^"\'>]*matchId=(\d+)',
                        r'matchId=(\d+)',
                    ]
                    for pattern in patterns:
                        matches = re.findall(pattern, html, re.IGNORECASE)
                        for match_id_str in matches:
                            try:
                                match_ids.add(int(match_id_str))
                            except ValueError:
                                continue
                    
                    if match_ids:
                        match_ids_list = sorted(list(match_ids), reverse=True)  # Most recent first
                        print(f"  -> discovered {len(match_ids_list)} match IDs: {match_ids_list}")
                        return match_ids_list
                    else:
                        raise RuntimeError("no match IDs found in teamResults page")
                except Exception as e:
                    last_err = e
                    try:
                        page.close()
                        context.close()
                        browser.close()
                    except Exception:
                        pass
                    time.sleep(1.0 + attempt * 0.5)
                    continue
        except Exception as e:
            if "Executable doesn't exist" in str(e) or "asyncio" in str(e).lower():
                with print_lock:
                    print(f"    !! Playwright error: {e}")
                last_err = e
                if attempt < attempts:
                    time.sleep(2.0 * attempt)
                    continue
                raise
            raise
    print(f"[warn] match discovery failed: {last_err}")
    return []

def fetch_match_info(match_id: int, base_path: str, club_id: int, context=None, league_id: int = None, attempts: int = 3) -> str:
    """Fetch match info page (info.do) for additional metadata like series, ground, toss, PoM."""
    url = f"{base_path}/info.do?matchId={match_id}&clubId={club_id}"
    last_err = None
    use_external_context = context is not None
    
    for attempt in range(1, attempts+1):
        if not use_external_context:
            try:
                pw = sync_playwright().start()
                browser, context = new_context(pw, base_path, league_id, club_id)
            except Exception as e:
                if "Executable doesn't exist" in str(e) or "asyncio" in str(e).lower():
                    with print_lock:
                        print(f"    !! Playwright error: {e}")
                    last_err = e
                    if attempt < attempts:
                        time.sleep(2.0 * attempt)
                        continue
                    raise
                raise
        else:
            browser = None
        
        page = context.new_page()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(1000)  # Allow page to render
            info_html = page.content()
            page.close()
            if not use_external_context:
                context.close()
                browser.close()
                pw.stop()
            return info_html
        except Exception as e:
            last_err = e
            try:
                page.close()
                if not use_external_context:
                    context.close()
                    browser.close()
                    pw.stop()
            except Exception:
                pass
            if not use_external_context:
                time.sleep(1.0 + attempt * 0.5)
            continue
        if not use_external_context:
            break
    with print_lock:
        print(f"[warn] match info fetch failed for {match_id}: {last_err}")
    return ""

def load_config():
    """Load configuration from config.yaml."""
    config_path = Path("config.yaml")
    if not config_path.exists():
        raise FileNotFoundError(f"config.yaml not found at {config_path.absolute()}")
    with open(config_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)
    return config

def get_output_dir_name(base_path: str, league_id: int) -> str:
    """Generate output directory name from base_path and league_id."""
    # Extract league name from base_path (e.g., "HoustonPremierT20League" from URL)
    league_name = base_path.split("/")[-1] if "/" in base_path else base_path
    return f"{league_name}_{league_id}"

def load_existing_matches(output_file: Path) -> dict[int, dict]:
    """Load existing matches.json and return a dict of match_id -> match_data."""
    if not output_file.exists():
        return {}
    try:
        existing = json.loads(output_file.read_text(encoding="utf-8"))
        return {match["match_id"]: match for match in existing}
    except Exception as e:
        with print_lock:
            print(f"  [warn] Could not load existing matches: {e}")
        return {}

def fetch_single_match(match_id: int, base_path: str, club_id: int, league_id: int, context=None):
    """Fetch all data for a single match, optionally reusing browser context."""
    url = f"{base_path}/viewScorecard.do?clubId={club_id}&matchId={match_id}"
    with print_lock:
        print(f"  [fetch] {match_id} … {url}")
    try:
        tables_html, full_html = fetch_scorecard_rendered(url, context, base_path, league_id, club_id, attempts=3)
        with print_lock:
            print(f"    -> scorecard: {len(tables_html)} chars, tables={len(re.findall(r'<table', tables_html, flags=re.I))}")
        ball_html = fetch_ball_by_ball(match_id, base_path, club_id, context, league_id)
        if not ball_html:
            with print_lock:
                print(f"    -> [warn] no ball-by-ball data for match {match_id}")
        info_html = fetch_match_info(match_id, base_path, club_id, context, league_id)
        time.sleep(MATCH_DELAY)  # Small delay between matches
        return {
            "match_id": match_id,
            "html": tables_html,
            "tables_html": tables_html,
            "full_html": full_html,
            "ball_html": ball_html,
            "info_html": info_html,
            "fetched_at": time.time(),
        }
    except Exception as e:
        with print_lock:
            print(f"    !! failed: {e}")
        return None

def process_league(league_idx: int, league: dict):
    """Process a single league: discover matches, fetch data, save results."""
    base_path = league.get("base_path")
    club_id = league.get("club_id")
    league_id = league.get("league_id")
    team_id = league.get("team_id")
    explicit_match_ids = league.get("match_ids")
    
    if not all([base_path, club_id, league_id, team_id]):
        with print_lock:
            print(f"[error] League {league_idx}: missing required fields (base_path, club_id, league_id, team_id)")
        return None
    
    with print_lock:
        print(f"\n[league {league_idx}] {base_path} (league_id={league_id}, team_id={team_id})")
    
    # Generate output directory first (needed for loading existing matches)
    out_dir_name = get_output_dir_name(base_path, league_id)
    out_dir = Path("cricclubs_export_out") / out_dir_name
    out_dir.mkdir(parents=True, exist_ok=True)
    output_file = out_dir / "matches.json"
    
    # Load existing matches for incremental updates
    existing_matches = {}
    if not FORCE_REFRESH:
        existing_matches = load_existing_matches(output_file)
        if existing_matches:
            with print_lock:
                print(f"  -> loaded {len(existing_matches)} existing matches from {output_file}")
    
    # Determine match IDs: use explicit if provided, otherwise discover
    if explicit_match_ids:
        match_ids = explicit_match_ids
        with print_lock:
            print(f"  -> using {len(match_ids)} explicit match IDs from config")
    else:
        with print_lock:
            print(f"  -> discovering match IDs from teamResults...")
        match_ids = discover_match_ids(base_path, club_id, league_id, team_id)
        if not match_ids:
            with print_lock:
                print(f"  !! no matches discovered, skipping league")
            return None
        with print_lock:
            print(f"  -> discovered {len(match_ids)} total match IDs")
    
    # Filter to only new match IDs
    existing_ids = set(existing_matches.keys())
    new_match_ids = [mid for mid in match_ids if mid not in existing_ids]
    
    # Log discovery results
    if not FORCE_REFRESH:
        if not new_match_ids:
            with print_lock:
                print(f"  -> all {len(match_ids)} discovered matches already exist (no new matches)")
                if existing_matches:
                    print(f"  -> keeping existing {len(existing_matches)} matches")
            return len(existing_matches)
        else:
            with print_lock:
                print(f"  -> {len(new_match_ids)} new match(es) found, {len(existing_ids)} already exist")
    else:
        with print_lock:
            print(f"  -> force refresh enabled, re-fetching all {len(match_ids)} matches")
        new_match_ids = match_ids
        existing_matches = {}  # Clear existing for full refresh
    
    # Fetch only new matches
    records = list(existing_matches.values())  # Start with existing
    with ThreadPoolExecutor(max_workers=MAX_MATCH_WORKERS) as executor:
        futures = {executor.submit(fetch_single_match, mid, base_path, club_id, league_id, None): mid 
                  for mid in new_match_ids}
        
        for future in as_completed(futures):
            result = future.result()
            if result:
                records.append(result)
    
    # Sort by match_id to maintain consistent order
    records.sort(key=lambda x: x["match_id"], reverse=True)
    
    # Save merged results
    output_file.write_text(json.dumps(records, indent=2), encoding="utf-8")
    with print_lock:
        if FORCE_REFRESH:
            print(f"  [ok] saved {len(records)} matches (force refresh) to {output_file}")
        else:
            print(f"  [ok] saved {len(records)} matches ({len(new_match_ids)} new, {len(existing_ids)} existing) to {output_file}")
    
    return len(records)

def main():
    # Ensure we're not in an asyncio event loop (Playwright sync API doesn't work with asyncio)
    try:
        loop = asyncio.get_running_loop()
        print("[error] Cannot run Playwright sync API inside an asyncio event loop.")
        print("[error] Please run this script outside of an asyncio context.")
        return
    except RuntimeError:
        # No running loop, we're good
        pass
    
    # Load configuration
    config = load_config()
    leagues = config.get("leagues", [])
    
    if not leagues:
        print("[error] No leagues found in config.yaml")
        return
    
    print(f"[info] Processing {len(leagues)} league(s) with {MAX_LEAGUE_WORKERS} parallel workers")
    print(f"[info] Each league processes matches with {MAX_MATCH_WORKERS} parallel workers")
    print(f"[info] Match delay: {MATCH_DELAY}s (set MATCH_DELAY env var to adjust)")
    if FORCE_REFRESH:
        print(f"[info] FORCE_REFRESH enabled - will re-fetch all matches")
    else:
        print(f"[info] Incremental mode - will only fetch new matches (set FORCE_REFRESH=1 to force full refresh)")
    
    start_time = time.time()
    
    # Process leagues in parallel
    results = []
    with ThreadPoolExecutor(max_workers=MAX_LEAGUE_WORKERS) as executor:
        futures = {executor.submit(process_league, idx+1, league): idx+1 
                  for idx, league in enumerate(leagues)}
        
        for future in as_completed(futures):
            league_idx = futures[future]
            try:
                match_count = future.result()
                if match_count:
                    results.append((league_idx, match_count))
            except Exception as e:
                with print_lock:
                    print(f"[error] League {league_idx} failed: {e}")
    
    elapsed = time.time() - start_time
    total_matches = sum(count for _, count in results)
    
    print(f"\n[ok] completed processing {len(results)} league(s) in {elapsed:.1f}s")
    print(f"[ok] Total matches fetched: {total_matches}")
    if len(leagues) > 1:
        print(f"[ok] Average time per league: {elapsed/len(leagues):.1f}s")

if __name__ == "__main__":
    main()
