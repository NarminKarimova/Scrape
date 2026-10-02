#!/usr/bin/env python3
"""
Shared utilities for Bina.az scrapers
"""

import html as html_module
import re
import logging
import time
import asyncio
from typing import Optional, Dict, Tuple


VALID_PROPERTY_CATEGORIES = frozenset(
    {
        "Yeni tikili",
        "Köhnə tikili",
        "Həyət evi/Bağ evi",
        "Torpaq",
        "Obyekt",
        "Ofis",
        "Qaraj",
    }
)

_CATEGORY_BY_CASEFOLD = {
    category.casefold(): category for category in VALID_PROPERTY_CATEGORIES
}


def _normalise_category(value: str) -> Optional[str]:
    """Return the canonical detailed category, or None for unknown values."""
    value = html_module.unescape(re.sub(r"<[^>]+>", " ", value))
    value = " ".join(value.split())
    return _CATEGORY_BY_CASEFOLD.get(value.casefold())


def extract_category_from_html(html: str) -> Optional[str]:
    """Extract a detailed category from one Bina.az listing page.

    Only listing-specific fields are considered. Generic SEO metadata such as
    ``"category": "Real Estate"`` is intentionally ignored.
    """
    if not html:
        return None

    # Current Bina.az markup (September 2026). The listing category is one of
    # the values rendered in the main sizes/details section.
    current_detail_pattern = re.compile(
        r"<span\b(?=[^>]*\bdata-cy=[\"']sizes-section__desc[\"'])[^>]*>"
        r"(.*?)</span>",
        re.IGNORECASE | re.DOTALL,
    )
    for match in current_detail_pattern.finditer(html):
        category = _normalise_category(match.group(1))
        if category:
            return category

    # Current embedded item data. Anchor the match to a Category object so it
    # cannot capture the generic JSON-LD value "Real Estate".
    category_object_pattern = re.compile(
        r'"category"\s*:\s*\{([^{}]{0,1000})\}',
        re.IGNORECASE | re.DOTALL,
    )
    for match in category_object_pattern.finditer(html):
        body = match.group(1)
        if not re.search(
            r'"__typename"\s*:\s*"Category"', body, re.IGNORECASE
        ):
            continue
        name_match = re.search(
            r'"name"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"', body
        )
        if name_match:
            category = _normalise_category(name_match.group(1))
            if category:
                return category

    # Legacy Bina.az markup retained for older/saved pages.
    legacy_match = re.search(
        r"<label\b[^>]*class=[\"'][^\"']*product-properties__i-name[^\"']*"
        r"[\"'][^>]*>\s*Kateqoriya\s*</label>\s*"
        r"<span\b[^>]*class=[\"'][^\"']*product-properties__i-value[^\"']*"
        r"[\"'][^>]*>(.*?)</span>",
        html,
        re.IGNORECASE | re.DOTALL,
    )
    if legacy_match:
        category = _normalise_category(legacy_match.group(1))
        if category:
            return category

    # The page title is listing-specific and provides a conservative fallback
    # if Bina.az changes the surrounding element names again.
    title_match = re.search(
        r"<title\b[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL
    )
    if title_match:
        title = html_module.unescape(
            re.sub(r"<[^>]+>", " ", title_match.group(1))
        ).casefold()
        for category in sorted(VALID_PROPERTY_CATEGORIES, key=len, reverse=True):
            if category.casefold() in title:
                return category

    return None


async def get_cloudflare_session() -> Tuple[Dict, str]:
    """
    Launch a visible browser to solve Cloudflare challenge and extract cookies.
    Returns (cookies_dict, user_agent)
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        logging.error("Playwright not installed. Cannot bypass Cloudflare.")
        return {}, ""

    print("\\n" + "!" * 80)
    print("CLOUDFLARE BYPASS NEEDED")
    print("Launching browser... Please solve the CAPTCHA if prompted.")
    print("The browser will close automatically once the site loads.")
    print("!" * 80 + "\\n")

    cookies = {}
    user_agent = ""

    async with async_playwright() as p:
        # Launch headed browser
        browser = await p.chromium.launch(
            headless=False,
            args=['--disable-blink-features=AutomationControlled']
        )
        
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 800}
        )
        
        page = await context.new_page()
        
        try:
            # Go to specific page
            await page.goto('https://bina.az/alqi-satqi', wait_until='domcontentloaded')
            
            # Wait for title to NOT indicate challenge
            max_wait = 180  # Give user 3 minutes max
            start_time = time.time()
            
            print("Waiting for page load/captcha solution...")
            while time.time() - start_time < max_wait:
                try:
                    if page.is_closed():
                        print("\nBrowser file closed by user.")
                        break
                        
                    title = await page.title()
                    url = page.url
                    
                    # Check for success indicators
                    if ("alqi-satqi" in url or "bina.az" in url) and ("Just a moment" not in title and "Cloudflare" not in title):
                         # Double check we are on the site
                        try:
                            if await page.locator(".items-list").count() > 0 or await page.locator("header").count() > 0:
                                print(f"\\n✓ Cloudflare passed successfully! (Title: {title})")
                                # Give it a moment to fully settle cookies
                                await asyncio.sleep(2)
                                break
                        except:
                            pass
                except Exception:
                    # Ignore errors during navigation/reloading (like execution context destroyed)
                    pass
                
                print(f"Waiting for bypass... ({int(max_wait - (time.time() - start_time))}s remaining)   ", end='\\r')
                await asyncio.sleep(1)
            
            # Get cookies and UA
            cookies_list = await context.cookies()
            cookies = {c['name']: c['value'] for c in cookies_list}
            user_agent = await page.evaluate("navigator.userAgent")
            
        except Exception as e:
            logging.error(f"Error getting session: {e}")
        finally:
            print("\\nClosing browser helper...")
            await browser.close()
            
    return cookies, user_agent

