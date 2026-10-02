#!/usr/bin/env python3
"""
Turbo.az Scraper - Scrapes listings and their details in one go
Saves everything to CSV organized by month
"""

import requests
from bs4 import BeautifulSoup
import pandas as pd
import time
import re
from datetime import datetime, timedelta
from pathlib import Path
from brands_list import TURBO_AZ_BRANDS
import urllib3
import sys
import logging
import random
import warnings

from playwright.sync_api import sync_playwright

import multiprocessing
from multiprocessing import Process

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler("logs/scraper.log", encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger(__name__)
# Suppress specific bs4 warnings

warnings.filterwarnings("ignore", category=UserWarning, module="bs4")


class CloudflareBlockedError(RuntimeError):
    """Raised when Turbo.az returns a Cloudflare interstitial or HTTP 403."""


def safe_print(lock, msg):
    """Thread-safe/Process-safe print"""
    if lock:
        with lock:
            print(msg)
    else:
        print(msg)


def _coerce_price_to_numeric(series: pd.Series) -> pd.Series:
    """Convert values like '36 700 ₼' into numeric form for Parquet."""
    if pd.api.types.is_numeric_dtype(series):
        return pd.to_numeric(series, errors="coerce")

    cleaned = (
        series.astype("string")
        .str.replace("\xa0", "", regex=False)
        .str.replace(r"[^\d]", "", regex=True)
    )
    cleaned = cleaned.replace("", pd.NA)
    return pd.to_numeric(cleaned, errors="coerce")


BASE_COLUMNS = [
    "url",
    "title",
    "brand",
    "model",
    "price",
    "year",
    "engine",
    "mileage",
    "location",
    "datetime",
    "date",
    "time",
    "scraped_at",
]

EXPECTED_DETAIL_COLUMNS = [
    "detail_city",
    "detail_brand",
    "detail_model",
    "detail_year",
    "detail_body_type",
    "detail_color",
    "detail_engine",
    "detail_mileage",
    "detail_transmission",
    "detail_drive_type",
    "detail_new_used",
    "detail_seats",
    "detail_owner_count",
    "detail_condition",
    "detail_target_market",
    "detail_Qəzalı",
    "detail_images_count",
]


def ensure_output_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Keep monthly exports schema-stable even if a run misses every detail page."""
    df = df.copy()
    for col in BASE_COLUMNS + EXPECTED_DETAIL_COLUMNS:
        if col not in df.columns:
            df[col] = pd.NA

    known = [col for col in BASE_COLUMNS + EXPECTED_DETAIL_COLUMNS if col in df.columns]
    extras = [col for col in df.columns if col not in known]
    return df[known + extras]


def apply_authoritative_details(listing: dict, details: dict) -> None:
    """Copy labeled detail-page values into base columns used by analytics."""
    if details.get("detail_year"):
        listing["year"] = details["detail_year"]
    if details.get("detail_engine"):
        listing["engine"] = details["detail_engine"]
    if details.get("detail_mileage"):
        listing["mileage"] = details["detail_mileage"]


def safe_to_parquet(df: pd.DataFrame, parquet_path: Path) -> bool:
    """Write parquet defensively when columns contain mixed Python types."""
    df = df.copy()
    numeric_columns = {
        "year",
        "detail_year",
        "detail_owner_count",
        "detail_seats",
        "detail_images_count",
    }

    # Coerce numeric-looking columns so Arrow sees stable scalar types.
    for col in numeric_columns.intersection(df.columns):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    if "price" in df.columns:
        df["price"] = _coerce_price_to_numeric(df["price"])

    # Keep remaining object columns as nullable strings instead of mixed Python
    # objects; mixed values are the common cause of pyarrow conversion failures.
    object_cols = df.select_dtypes(include=["object"]).columns
    for col in object_cols:
        df[col] = df[col].astype("string")

    try:
        df.to_parquet(parquet_path, index=False)
        return True
    except Exception as e:
        logger.warning(
            f"Parquet write failed for {parquet_path}. Retrying with string coercion: {e}"
        )

    try:
        object_cols = df.select_dtypes(include=["object"]).columns
        for col in object_cols:
            # Keep nulls as nulls; coerce only real values to string for Arrow safety.
            df[col] = df[col].where(df[col].isna(), df[col].astype(str))
        df.to_parquet(parquet_path, index=False)
        return True
    except Exception as e:
        logger.error(f"Fallback parquet write failed for {parquet_path}: {e}")
        return False


def launch_auth_browser(playwright_instance, worker_id=None, lock=None):
    """
    Launch a visible browser using existing Playwright instance to solve Cloudflare.
    Returns (cookies_dict, user_agent)
    """
    prefix = f"[Worker {worker_id}]" if worker_id is not None else "[Main]"

    safe_print(lock, f"\n{prefix} CLOUDFLARE BYPASS NEEDED - Opening browser...")

    cookies = {}
    user_agent = ""

    try:
        # Launch headed browser using provided instance
        browser = playwright_instance.chromium.launch(
            headless=False, args=["--disable-blink-features=AutomationControlled"]
        )

        context = browser.new_context(viewport={"width": 1280, "height": 800})

        page = context.new_page()

        # Go to specific page
        page.goto("https://turbo.az", wait_until="domcontentloaded")

        # Wait for title to NOT indicate challenge
        max_wait = 180  # Give user 3 minutes max
        start_time = time.time()

        print("Waiting for page load/captcha solution...")
        while time.time() - start_time < max_wait:
            try:
                if page.is_closed():
                    print("\\nBrowser closed by user.")
                    break

                title = page.title()

                # Check for success indicators
                if ("turbo.az" in page.url) and (
                    "Just a moment" not in title and "Cloudflare" not in title
                ):
                    # Double check we are on the site
                    try:
                        if (
                            page.locator(".products-i").count() > 0
                            or page.locator("header").count() > 0
                        ):
                            safe_print(
                                lock,
                                f"{prefix} ✓ Cloudflare passed successfully! (Title: {title})",
                            )
                            # Give it a moment to fully settle cookies
                            time.sleep(2)
                            break
                    except Exception as e:
                        logger.warning(f"Error occurred while checking page content: {e}")
            except Exception as e:
                logger.error(f"Unexpected error occurred: {e}")

            # safe_print(lock, f"{prefix} Waiting for bypass... ({int(max_wait - (time.time() - start_time))}s remaining)")
            time.sleep(1)

        # Get cookies and UA
        cookies_list = context.cookies()
        cookies = {c["name"]: c["value"] for c in cookies_list}
        user_agent = page.evaluate("navigator.userAgent")

        browser.close()

    except Exception as e:
        logger.error(f"Error getting session: {e}")

    return cookies, user_agent


def fetch_brands_with_browser() -> list:
    """Fetch the current brand list through a real browser session."""
    browser = None
    try:
        logger.info("Initializing browser-based dynamic brand discovery...")
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=False,
                args=["--disable-blink-features=AutomationControlled"],
            )
            context = browser.new_context(viewport={"width": 1280, "height": 800})
            page = context.new_page()
            page.goto(
                "https://turbo.az/autos",
                wait_until="domcontentloaded",
                timeout=60000,
            )

            if "Just a moment" in page.title() or "Cloudflare" in page.title():
                print("Cloudflare check detected. Complete it in the opened browser.")

            dropdown = page.locator(
                'select#q_make, select[name="q[make][]"]'
            ).first
            dropdown.wait_for(state="attached", timeout=180000)
            raw_brands = dropdown.locator("option").evaluate_all(
                """options => options.map(option => ({
                    id: option.value,
                    name: option.textContent.trim()
                }))"""
            )

            brands = [
                {"id": str(brand["id"]), "name": brand["name"]}
                for brand in raw_brands
                if brand.get("id")
                and brand.get("id") != "all"
                and brand.get("name")
            ]
            if not brands:
                raise RuntimeError("Brand dropdown contained no usable options")

            brands.sort(key=lambda brand: brand["name"])
            logger.info(f"Dynamically discovered {len(brands)} brands via browser.")
            return brands
    except Exception as e:
        logger.error(f"Browser-based dynamic brand discovery failed: {e}")
        logger.warning("Falling back to static brand list.")
        return TURBO_AZ_BRANDS
    finally:
        if browser is not None:
            try:
                browser.close()
            except Exception:
                pass


class TurboAzScraper:
    """Simple scraper for turbo.az that gets listings and details at once"""

    # Mapping Azerbaijani detail labels to English column names
    DETAIL_LABEL_MAP = {
        "Şəhər": "detail_city",
        "Marka": "detail_brand",
        "Model": "detail_model",
        "Buraxılış ili": "detail_year",
        "Ban növü": "detail_body_type",
        "Rəng": "detail_color",
        "Mühərrik": "detail_engine",
        "Yürüş": "detail_mileage",
        "Sürətlər qutusu": "detail_transmission",
        "Ötürücü": "detail_drive_type",
        "Yeni": "detail_new_used",
        "Yerlərin sayı": "detail_seats",
        "Vəziyyəti": "detail_condition",
        "Hansı bazar üçün yığılıb": "detail_target_market",
        "Sahiblər": "detail_owner_count",
    }

    def __init__(
        self,
        playwright_instance,
        cookies=None,
        user_agent=None,
        lock=None,
        worker_id=None,
    ):
        self.base_url = "https://turbo.az"
        self.cookies = cookies or {}
        self.lock = lock
        self.worker_id = worker_id
        self.user_agent = (
            user_agent
            or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )

        # Use provided Playwright instance
        self.p = playwright_instance
        self.browser = self.p.chromium.launch(headless=True)
        self.context = self.browser.new_context(user_agent=self.user_agent)

        # Add cookies to context
        if self.cookies:
            pw_cookies = []
            for name, value in self.cookies.items():
                pw_cookies.append(
                    {"name": name, "value": value, "domain": "turbo.az", "path": "/"}
                )
            self.context.add_cookies(pw_cookies)

        self.page = self.context.new_page()

    def update_session(self, cookies, user_agent):
        """Update browser context with new cookies/UA"""
        self.cookies = cookies
        self.user_agent = user_agent

        # Close old page/context
        try:
            self.page.close()
            self.context.close()
        except Exception as e:
            logger.error(f"Error occurred while closing page/context: {e}")

        # Create new context
        self.context = self.browser.new_context(user_agent=self.user_agent)

        if self.cookies:
            pw_cookies = []
            for name, value in self.cookies.items():
                pw_cookies.append(
                    {"name": name, "value": value, "domain": "turbo.az", "path": "/"}
                )
            self.context.add_cookies(pw_cookies)

        self.page = self.context.new_page()
        logger.info("Session updated successfully")

    def close(self):
        """Close Playwright objects while the owning Playwright instance is alive."""
        try:
            if getattr(self, "page", None) and not self.page.is_closed():
                self.page.close()
        except Exception as e:
            logger.debug(f"Error occurred while closing page: {e}")

        try:
            if getattr(self, "context", None):
                self.context.close()
        except Exception as e:
            logger.debug(f"Error occurred while closing context: {e}")

        try:
            # Only close browser, don't stop playwright as it's shared.
            if getattr(self, "browser", None):
                self.browser.close()
        except Exception as e:
            logger.error(f"Error occurred while closing browser: {e}")
        finally:
            self.page = None
            self.context = None
            self.browser = None

    def __del__(self):
        browser = getattr(self, "browser", None)
        if browser is None:
            return
        try:
            self.close()
        except Exception:
            # Interpreter/process shutdown can invalidate Playwright internals.
            pass

    def _fetch(self, url):
        """Fetch content using Playwright"""
        try:
            response = self.page.goto(url, wait_until="domcontentloaded", timeout=30000)
            if response and response.status == 403:
                # Signal 403 to caller via exception or custom return
                # For now returning content, will be caught by title check
                pass
            return self.page.content()
        except Exception as e:
            logger.error(f"Fetch error {url}: {e}")
            raise

    def _fetch_detail(self, url):
        """Fetch detail pages with requests first; Playwright is the fallback."""
        headers = {"User-Agent": self.user_agent}
        try:
            response = requests.get(
                url,
                headers=headers,
                cookies=self.cookies,
                timeout=20,
                verify=False,
            )
            if response.status_code == 200 and "product-properties" in response.text:
                return response.text
            logger.warning(
                f"Requests detail fetch returned status {response.status_code} "
                f"or no properties for {url}; falling back to Playwright."
            )
        except requests.RequestException as e:
            logger.warning(f"Requests detail fetch failed for {url}: {e}")

        # A Playwright navigation can reach ``domcontentloaded`` before Turbo.az
        # has rendered the specification block.  Wait for that block explicitly;
        # otherwise the caller parses an incomplete/interstitial page and records
        # an empty details dictionary.
        response = self.page.goto(
            url, wait_until="domcontentloaded", timeout=30000
        )
        status = response.status if response else None
        title = self.page.title()
        if status == 403 or any(
            marker in title for marker in ("Just a moment", "Cloudflare", "Access denied")
        ):
            raise CloudflareBlockedError(
                f"Cloudflare blocked detail page {url} (status={status}, title={title!r})"
            )

        self.page.wait_for_selector(
            ".product-properties__i", state="attached", timeout=15000
        )
        return self.page.content()

    def scrape_listing_details(self, url: str, max_retries=3) -> dict:
        """Get detailed info from a listing"""
        details = {}

        for attempt in range(max_retries):
            try:
                time.sleep(random.uniform(0.5, 2.0))  # Random delay between requests

                content = self._fetch_detail(url)
                soup = BeautifulSoup(content, "html.parser")

                # Extract specifications
                spec_items = soup.find_all("div", class_="product-properties__i")
                if not spec_items:
                    logger.warning(
                        f"No detail properties found for {url} "
                        f"(attempt {attempt + 1}/{max_retries})"
                    )
                    if attempt < max_retries - 1:
                        time.sleep(2**attempt)
                        continue

                for item in spec_items:
                    label = item.find(class_="product-properties__i-name")
                    value = item.find(class_="product-properties__i-value")
                    if label and value:
                        key = label.get_text(strip=True)
                        val = value.get_text(strip=True)

                        # Map Azerbaijani labels to English column names
                        if key in self.DETAIL_LABEL_MAP:
                            details[self.DETAIL_LABEL_MAP[key]] = val
                        else:
                            # For unmapped keys, use English naming convention
                            details[f"detail_{key}"] = val

                # Image count
                gallery = soup.find("div", class_="gallery-list") or soup.find(
                    "div", class_="gallery"
                )
                if gallery:
                    images = gallery.find_all("img")
                    details["detail_images_count"] = len(images)

                # Success - break retry loop
                break

            except CloudflareBlockedError as e:
                logger.warning(str(e))
                if attempt >= max_retries - 1:
                    break

                new_cookies, new_ua = launch_auth_browser(
                    self.p, self.worker_id, self.lock
                )
                if not new_cookies:
                    logger.error(f"Could not refresh session for detail page {url}")
                    break
                self.update_session(new_cookies, new_ua)
                continue
            except requests.exceptions.Timeout:
                logger.warning(
                    f"Timeout on detail page (attempt {attempt + 1}/{max_retries}): {url}"
                )
                if attempt < max_retries - 1:
                    time.sleep(2**attempt)
            except Exception as e:
                logger.warning(
                    f"Error scraping details from {url} "
                    f"(attempt {attempt + 1}/{max_retries}): {e}"
                )
                if attempt < max_retries - 1:
                    time.sleep(2**attempt)
                    continue
                break

        return details

    def fetch_brands_dynamically(self) -> list:
        """Fetch the brand list through this scraper's browser session."""
        brands = []
        try:
            logger.info("Fetching brand list dynamically...")
            content = self._fetch(f"{self.base_url}/autos")
            soup = BeautifulSoup(content, "html.parser")
            dropdown = soup.find("select", {"id": "q_make"}) or soup.find(
                "select", {"name": "q[make][]"}
            )

            if dropdown:
                options = dropdown.find_all("option")
                for opt in options:
                    val = opt.get("value")
                    name = opt.get_text(strip=True)
                    if val and name and val != "all":
                        brands.append({"id": val, "name": name})

                if brands:
                    brands.sort(key=lambda x: x["name"])
                    logger.info(
                        f"Successfully fetched {len(brands)} brands dynamically."
                    )
                    return brands

            logger.warning(
                "Dynamic fetch failed or returned no brands. Falling back to static list."
            )
        except Exception as e:
            logger.error(
                f"Error fetching brands dynamically: {e}. Falling back to static list."
            )

        return TURBO_AZ_BRANDS

    def scrape_by_brand(self, brands=None, output_csv=None, worker_id=0):
        """Scrape all listings by brand with details"""
        if brands is None:
            brands = TURBO_AZ_BRANDS

        all_listings = []
        seen_urls = set()

        if output_csv and output_csv.exists():
            try:
                # Load existing data to avoid overwriting it
                existing_df = pd.read_csv(output_csv)
                all_listings = existing_df.to_dict("records")
                for item in all_listings:
                    if "url" in item:
                        seen_urls.add(item["url"])
                safe_print(
                    self.lock,
                    f"[Worker {worker_id}] Loaded {len(all_listings)} existing listings from {output_csv}",
                )
            except Exception as e:
                logger.error(f"Failed to load existing CSV: {e}")

        for i, brand in enumerate(brands):
            brand_name = brand.get("name", "Unknown")
            brand_id = str(brand.get("id"))
            safe_print(
                self.lock,
                f"[Worker {worker_id}] Processing {brand_name} ({i + 1}/{len(brands)})",
            )

            url = f"https://turbo.az/autos?q%5Bmake%5D%5B%5D={brand_id}"
            page = 1
            consecutive_failures = 0
            brand_ads_count = 0

            while True:
                page_url = f"{url}&page={page}" if page > 1 else url

                try:
                    time.sleep(
                        random.uniform(1.5, 3.0)
                    )  # Reduced delay for faster pagination

                    content = self._fetch(page_url)

                    # Use response.text instead of content to avoid "REPLACEMENT CHARACTER" warnings
                    soup = BeautifulSoup(content, "html.parser")

                    # Check for specific "No results" message which appears even with VIP ads
                    full_text = soup.get_text()
                    if "Təəssüf ki, axtarışınız əsasında heç nə tapılmadı" in full_text:
                        safe_print(
                            self.lock,
                            f"[Worker {worker_id}] No results found for {brand_name} on page {page} (found empty message). Stopping.",
                        )
                        break

                    # Check for Cloudflare Block
                    page_title = soup.title.string.strip() if soup.title else ""
                    if (
                        "Just a moment" in page_title
                        or "Cloudflare" in page_title
                        or "Access denied" in page_title
                    ):
                        logger.warning(
                            f"Cloudflare block detected at {brand_name} page {page}. Launching re-auth..."
                        )

                        # Get new session using existing playwright instance
                        new_cookies, new_ua = launch_auth_browser(
                            self.p, worker_id, self.lock
                        )
                        if new_cookies:
                            self.update_session(new_cookies, new_ua)
                            # Decrease failure count as this was a block, not a network error
                            consecutive_failures = 0
                            continue  # Retry the same page
                        else:
                            logger.error("Bypass failed or cancelled. Stopping.")
                            break

                    listings = self._parse_listings(soup, brand_name=brand_name)

                    if not listings:
                        if page == 1:
                            logger.warning(
                                f"No listings found for {brand_name} on page 1."
                            )

                        logger.debug(
                            f"No more listings for {brand_name} at page {page}"
                        )
                        break

                    # Count new listings to detect infinite loops (e.g. site redirecting last page to first)
                    new_listings_on_page = 0

                    # Get details for each listing
                    for listing in listings:
                        listing_url = listing.get("url")

                        # Skip if already seen
                        if listing_url in seen_urls or listing_url == "N/A":
                            continue

                        seen_urls.add(listing_url)
                        new_listings_on_page += 1

                        # Get details
                        if listing_url.startswith("http"):
                            details = self.scrape_listing_details(listing_url)
                            listing.update(details)
                            apply_authoritative_details(listing, details)

                        all_listings.append(listing)
                        brand_ads_count += 1
                        if brand_ads_count % 20 == 0:
                            safe_print(
                                self.lock,
                                f"[Worker {worker_id}]   > {brand_name} pg {page}: {brand_ads_count} ads collected",
                            )

                    if new_listings_on_page == 0:
                        safe_print(
                            self.lock,
                            f"[Worker {worker_id}] No new ads on page {page} for {brand_name}. Stopping.",
                        )
                        break

                    # Optional: small delay to avoid overwhelming browser
                    # time.sleep(random.uniform(1.0, 2.0))
                    page += 1

                except Exception as e:
                    logger.error(f"Error scraping {brand_name} page {page}: {e}")
                    time.sleep(10)
                    consecutive_failures += 1
                    if consecutive_failures >= 5:
                        break

            # Save progress after each brand
            try:
                # Update CSV incrementally (Parquet is written only after final merge)
                if output_csv and all_listings:
                    df_progress = ensure_output_columns(pd.DataFrame(all_listings))
                    df_progress.to_csv(output_csv, index=False, encoding="utf-8")

                # Record as completed brand
                log_path = Path("logs/completed_brands.txt")
                if self.lock:
                    with self.lock:
                        with open(log_path, "a", encoding="utf-8") as f:
                            f.write(f"{brand_id}\n")
                else:
                    with open(log_path, "a", encoding="utf-8") as f:
                        f.write(f"{brand_id}\n")

            except Exception as e:
                logger.error(f"Failed to save progress for {brand_name}: {e}")

        return all_listings

    def _parse_listings(self, soup: BeautifulSoup, brand_name: str = None) -> list:
        """Parse listings from HTML. brand_name should be the turbo.az filter name
        (e.g. 'Land Rover', 'Lynk & Co') so multi-word brands are stored correctly."""
        listings = []
        products = soup.find_all("div", class_="products-i")

        for product in products:
            try:
                listing = {}

                # URL and title
                title_link = product.find("a", class_="products-i__link")
                if title_link:
                    href = title_link.get("href", "")
                    listing["url"] = self.base_url + href if href else "N/A"
                else:
                    listing["url"] = "N/A"

                # Title
                name_elem = product.find("div", class_="products-i__name")
                listing["title"] = name_elem.text.strip() if name_elem else "N/A"

                # Use the known filter brand name — avoids multi-word truncation
                # (e.g. 'Land Rover' instead of just 'Land')
                if brand_name:
                    listing["brand"] = brand_name
                    # Model = everything after the brand name in the title
                    title_lower = listing["title"].lower()
                    brand_lower = brand_name.lower()
                    if title_lower.startswith(brand_lower):
                        listing["model"] = listing["title"][len(brand_name) :].strip()
                    else:
                        parts = listing["title"].split()
                        listing["model"] = (
                            " ".join(parts[1:]) if len(parts) > 1 else "N/A"
                        )
                else:
                    parts = listing["title"].split()
                    listing["brand"] = parts[0] if len(parts) > 0 else "N/A"
                    listing["model"] = " ".join(parts[1:]) if len(parts) > 1 else "N/A"

                # Price
                price_elem = product.find("div", class_="products-i__price")
                listing["price"] = price_elem.text.strip() if price_elem else "N/A"

                # Year, engine, mileage from attributes
                attrs_elem = product.find("div", class_="products-i__attributes")
                if attrs_elem:
                    attrs_text = attrs_elem.text.strip()
                    parts = [p.strip() for p in attrs_text.split(",")]
                    listing["year"] = parts[0] if len(parts) > 0 else "N/A"
                    listing["engine"] = "N/A"
                    listing["mileage"] = "N/A"

                # Location and date
                dt_elem = product.find("div", class_="products-i__datetime")
                if dt_elem:
                    dt_text = dt_elem.text.strip()
                    if "," in dt_text:
                        loc, date_part = dt_text.split(",", 1)
                        listing["location"] = loc.strip()
                        listing["datetime"] = date_part.strip()
                        listing["date"], listing["time"] = self._parse_date(
                            date_part.strip()
                        )
                    else:
                        listing["location"] = "N/A"
                        listing["datetime"] = "N/A"
                        listing["date"] = "N/A"
                        listing["time"] = "N/A"

                listing["scraped_at"] = datetime.now().isoformat()
                listings.append(listing)

            except Exception:
                continue

        return listings

    def _parse_date(self, date_str: str) -> tuple:
        """Parse Azerbaijani date to ISO and extract time"""
        today = datetime.now().date()
        time_match = re.search(r"(\d{2}):(\d{2})", date_str)
        time_str = time_match.group(0) if time_match else "N/A"

        if "bugün" in date_str.lower():
            target_date = today
        elif "dünən" in date_str.lower():
            target_date = today - timedelta(days=1)
        else:
            match = re.search(r"(\d+)\s*gün", date_str.lower())
            days_ago = int(match.group(1)) if match else 0
            target_date = today - timedelta(days=days_ago)

        return target_date.isoformat(), time_str


def worker_task(chunk, chunk_id, period_str, test_mode, lock):
    """Worker process function"""
    try:
        # Each worker needs its own Playwright instance
        with sync_playwright() as p:
            scraper = None
            # Each worker manages its own Cloudflare session
            # We try to get a session first
            try:
                cookies, user_agent = launch_auth_browser(p, chunk_id, lock)

                # Initialize scraper
                scraper = TurboAzScraper(
                    p,
                    cookies=cookies,
                    user_agent=user_agent,
                    lock=lock,
                    worker_id=chunk_id,
                )

                # Setup output file for this worker
                worker_dir = Path(f"data/{period_str}")
                worker_dir.mkdir(parents=True, exist_ok=True)
                test_suffix = "_test" if test_mode else ""
                csv_file = (
                    worker_dir
                    / f"turbo_az_{period_str}_part{chunk_id}{test_suffix}.csv"
                )

                safe_print(
                    lock,
                    f"[Worker {chunk_id}] STARTED. Processing {len(chunk)} brands. Output: {csv_file}",
                )

                scraper.scrape_by_brand(
                    brands=chunk, output_csv=csv_file, worker_id=chunk_id
                )
                safe_print(lock, f"[Worker {chunk_id}] FINISHED!")
            finally:
                if scraper is not None:
                    scraper.close()

    except Exception as e:
        logger.error(f"Worker {chunk_id} crashed: {e}")
        safe_print(lock, f"[Worker {chunk_id}] CRASHED: {e}")


def main(run_label=None, month_str=None):
    """Main entry point"""
    test_mode = "--test" in sys.argv

    # Create monthly folder and logs folder
    month_str = month_str or datetime.now().strftime("%Y-%m")
    period_str = f"{month_str}-{run_label}" if run_label else month_str
    data_dir = Path(f"data/{period_str}")
    data_dir.mkdir(parents=True, exist_ok=True)
    Path("logs").mkdir(exist_ok=True)

    # Discover the live brand list in a real browser so Cloudflare can validate it.
    brands = fetch_brands_with_browser()

    completed_file = Path("logs/completed_brands.txt")

    # ── MODE: --missing ──────────────────────────────────────────────────────
    # Fetches live counts from turbo.az and re-scrapes only brands with big gaps.
    if "--missing" in sys.argv:
        print("\nMISSING MODE: Checking live counts vs existing CSV...\n")

        final_csv = data_dir / f"turbo_az_{period_str}.csv"
        local_counts = {}
        if final_csv.exists():
            try:
                df_existing = pd.read_csv(final_csv)
                if "brand" in df_existing.columns:
                    local_counts = df_existing["brand"].value_counts().to_dict()
                print(f"Loaded {len(df_existing):,} existing rows from {final_csv}")
            except Exception as e:
                logger.error(f"Could not load existing CSV: {e}")
        else:
            print(f"No existing CSV at {final_csv}. All brands will be scraped.")

        import re as _re

        def _fetch_live_count(brand_id, ua):
            url = f"https://turbo.az/autos?q%5Bmake%5D%5B%5D={brand_id}"
            try:
                r = requests.get(
                    url, headers={"User-Agent": ua}, timeout=15, verify=False
                )
                s = BeautifulSoup(r.text, "html.parser")
                text = s.get_text(" ", strip=True)
                m = _re.search(r"(\d[\d\s]*)\s*elan", text)
                if m:
                    return int(m.group(1).replace(" ", "").replace("\xa0", ""))
            except Exception:
                pass
            return None

        ua = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )
        missing_brands = []
        print(f"{'Brand':<30} {'Live':>8}  {'In CSV':>8}  {'Missing':>8}")
        print("-" * 62)
        for b in brands:
            live = _fetch_live_count(b["id"], ua)
            time.sleep(0.3)
            local = local_counts.get(b["name"], 0)
            if live is None:
                continue
            gap = live - local
            # Re-scrape if: completely missing, or >5% gap with at least 10 ads missing
            needs_rescrape = (local == 0 and live > 0) or (gap > max(10, live * 0.05))
            if needs_rescrape:
                missing_brands.append(b)
                marker = "  <-- WILL RESCRAPE"
            else:
                marker = ""
            print(f"{b['name']:<30} {live:>8,}  {local:>8,}  {gap:>8,}{marker}")

        print("-" * 62)
        print(f"\nFound {len(missing_brands)} brands to re-scrape.")

        if not missing_brands:
            print("Nothing to do!")
            return

        brands = missing_brands
        completed_file.write_text("", encoding="utf-8")

    # ── MODE: --resume ────────────────────────────────────────────────────────
    # Skips already-finished brands from an interrupted run (crash recovery).
    elif "--resume" in sys.argv:
        processed_ids = set()
        if completed_file.exists():
            with open(completed_file, "r", encoding="utf-8") as f:
                processed_ids = set(line.strip() for line in f if line.strip())
        if processed_ids:
            original_count = len(brands)
            brands = [b for b in brands if str(b.get("id")) not in processed_ids]
            print(
                f"RESUME MODE: Skipping {len(processed_ids)} already finished brands."
            )
            print(f"Remaining: {len(brands)} (out of {original_count})")
        else:
            print(
                f"RESUME MODE: No checkpoint found. Starting fresh with {len(brands)} brands."
            )

    # ── MODE: normal full run ─────────────────────────────────────────────────
    # Always clears the checkpoint so previous runs never block a fresh scrape.
    else:
        completed_file.write_text("", encoding="utf-8")
        print(f"Starting fresh scrape of all {len(brands)} brands.")

    print(f"\n{'=' * 80}")
    print(f"TURBO.AZ SCRAPER - {period_str} (MULTIPROCESSING MODE)".center(80))
    print(f"{'=' * 80}\n")

    if test_mode:
        print("TEST MODE: Scraping first 4 brands only\n")
        brands = brands[:4]
    elif "--missing" in sys.argv:
        print(f"MISSING MODE: Re-scraping {len(brands)} brands with gaps\n")
    else:
        print(f"FULL MODE: Scraping all {len(brands)} brands\n")

    if not brands:
        print("No brands to process. Exiting.")
        return

    # Check for number of CPUs
    num_workers = min(4, multiprocessing.cpu_count())  # Max 4 workers to avoid overload
    print(f"Launching {num_workers} worker processes...")

    # Use multiprocessing primitives directly to avoid Manager/asyncio issues
    lock = multiprocessing.Lock()

    # Split brands into chunks
    chunk_size = len(brands) // num_workers + 1
    chunks = [brands[i : i + chunk_size] for i in range(0, len(brands), chunk_size)]

    processes = []
    for i, chunk in enumerate(chunks):
        if not chunk:
            continue
        p = Process(target=worker_task, args=(chunk, i, period_str, test_mode, lock))
        p.start()
        processes.append(p)

    # Wait for all
    for p in processes:
        p.join()

    print(f"\n{'=' * 80}")
    print("All workers finished. Merging files...")

    # Merge CSVs
    test_suffix = "_test" if test_mode else ""
    final_csv_file = data_dir / f"turbo_az_{period_str}{test_suffix}.csv"

    all_dfs = []
    # In --missing mode: load the existing merged CSV first so old data is preserved
    if "--missing" in sys.argv and final_csv_file.exists():
        try:
            all_dfs.append(pd.read_csv(final_csv_file))
        except Exception as e:
            logger.error(f"Could not load existing merged CSV: {e}")

    # Find all part files
    part_files = list(data_dir.glob(f"turbo_az_{period_str}_part*{test_suffix}.csv"))
    print(f"Found {len(part_files)} part files to merge.")

    for part_file in sorted(part_files):
        try:
            df = pd.read_csv(part_file)
            all_dfs.append(df)
            # print(f"Loaded {len(df)} rows from {part_file.name}")
        except Exception as e:
            logger.error(f"Error reading {part_file}: {e}")

    if all_dfs:
        final_df = pd.concat(all_dfs, ignore_index=True)
        # Deduplicate based on URL to remove any overlaps between workers or sessions
        if "url" in final_df.columns:
            start_len = len(final_df)
            # Keep the last instance found (usually the most recent scrape)
            final_df.drop_duplicates(subset=["url"], keep="last", inplace=True)
            print(f"Deduplicated {start_len - len(final_df)} listings.")

        final_df = ensure_output_columns(final_df)
        final_df.to_csv(final_csv_file, index=False, encoding="utf-8")
        # Also save as parquet
        final_parquet_file = final_csv_file.with_suffix(".parquet")
        safe_to_parquet(final_df, final_parquet_file)

        print("\nCOMPLETE!")
        print(f"   Listings: {len(final_df):,}")
        print(f"   CSV:  {final_csv_file}")
        print(f"   Parquet: {final_parquet_file}")

        # Clean up part (checkpoint) files after successful merge
        for part_file in part_files:
            try:
                part_file.unlink()
                parquet_part = part_file.with_suffix(".parquet")
                if parquet_part.exists():
                    parquet_part.unlink()
            except Exception as e:
                logger.warning(f"Could not remove checkpoint {part_file}: {e}")
        print(f"   Cleaned up {len(part_files)} checkpoint file(s).")
    else:
        print("No data collected.")


if __name__ == "__main__":
    # On Windows, calling freeze_support is necessary for multiprocessing
    multiprocessing.freeze_support()

    now = datetime.now()
    run_label = "q2" if now.day > 15 else "q1"
    month_str = now.strftime("%Y-%m")

    # Optional override: --month YYYY-MM
    if "--month" in sys.argv:
        try:
            idx = sys.argv.index("--month")
            candidate = sys.argv[idx + 1].strip()
            if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", candidate):
                raise ValueError
            month_str = candidate
        except (IndexError, ValueError):
            print("Invalid or missing --month value. Expected YYYY-MM, for example 2026-07.")
            sys.exit(2)

    # Optional override: --run-label q1|q2
    if "--run-label" in sys.argv:
        try:
            idx = sys.argv.index("--run-label")
            candidate = sys.argv[idx + 1].lower().strip()
            if candidate in {"q1", "q2"}:
                run_label = candidate
            else:
                print("Invalid --run-label value. Using automatic q1/q2.")
        except IndexError:
            print("Missing --run-label value. Using automatic q1/q2.")

    print(f"Selected period: {month_str}-{run_label}")
    print(f"\n{'#' * 80}")
    print(f"RUN ({run_label})".center(80))
    print(f"{'#' * 80}\n")
    main(run_label=run_label, month_str=month_str)
