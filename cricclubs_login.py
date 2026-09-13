#!/usr/bin/env python3
"""One-time interactive setup: save a real CricClubs browser session to disk.

cricclubs_export.py normally launches a brand-new, anonymous browser context
for every page it fetches, so it has to clear CricClubs' Cloudflare check
from scratch every single time. Run this script once with a visible browser,
let the page load normally (log in too, if you want an authenticated
session), and the session is saved to the profile directory that
cricclubs_export.py automatically reuses on every future run.

Usage:
    python3 cricclubs_login.py
"""
import random

from playwright.sync_api import sync_playwright

from cricclubs_export import DESKTOP_UAS, PROFILE_DIR


def main():
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        context = pw.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            headless=False,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ],
            user_agent=random.choice(DESKTOP_UAS),
            viewport={"width": 1366, "height": 900},
            locale="en-US",
            timezone_id="America/Chicago",
            ignore_https_errors=True,
        )
        page = context.new_page()
        page.goto("https://cricclubs.com/", wait_until="domcontentloaded", timeout=60000)
        print("A browser window has opened.")
        print("1. Wait for the security check to clear and the real CricClubs page to load.")
        print("2. Optionally log in to your CricClubs account for an authenticated session.")
        input("Press Enter here once the site has loaded normally... ")
        context.close()
    print(f"[ok] Session saved to {PROFILE_DIR}/ - cricclubs_export.py will reuse it automatically.")


if __name__ == "__main__":
    main()
