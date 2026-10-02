#!/usr/bin/env python3
"""
Bina.az Rent Property Scraper
Scrapes all rental properties from bina.az using asyncio and aiohttp for optimal performance.
"""

import asyncio
import aiohttp
import json
import csv
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any
from urllib.parse import urlencode
import sys
from pathlib import Path
import time
import re
import pandas as pd

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler("rent_scraper.log", encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger(__name__)

# Import shared utilities
from scraper_utils import extract_category_from_html, get_cloudflare_session

# Try to import openpyxl for Excel support
try:
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill

    XLSX_AVAILABLE = True
except ImportError:
    XLSX_AVAILABLE = False
    logger.warning(
        "openpyxl not installed. XLSX export will not be available. Install with: pip install openpyxl"
    )


class ScrapeIncompleteError(RuntimeError):
    """Raised when pagination stops before the API reports its last page."""


class BinaRentScraper:
    """Asynchronous scraper for bina.az rental properties"""

    BASE_URL = "https://bina.az/graphql"
    OPERATION_NAME = "SearchItems"
    SHA256_HASH = "b781511a943a4d710eefdf811a24dd4ae353e55d836952603ce0b37fde97d073"

    # Pagination settings
    ITEMS_PER_PAGE = 16  # Maximum allowed by API complexity limit
    MAX_CONCURRENT_REQUESTS = 5  # Limit concurrent requests
    RETRY_ATTEMPTS = 3
    RETRY_DELAY = 2  # seconds

    # Data safety settings
    CHECKPOINT_INTERVAL = 50  # Save checkpoint every N pages
    INCREMENTAL_SAVE_INTERVAL = 100  # Save data every N pages

    def __init__(
        self,
        output_dir: str = "data/rent",
        resume: bool = True,
        cookies: Dict = None,
        user_agent: str = None,
    ):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.session: Optional[aiohttp.ClientSession] = None
        self.cookies = cookies or {}
        self.user_agent = user_agent
        self.all_items: List[Dict] = []
        self.seen_ids: set = set()  # Track IDs for deduplication
        self.semaphore = asyncio.Semaphore(self.MAX_CONCURRENT_REQUESTS)
        self.checkpoint_file = self.output_dir / "checkpoint.json"
        self.resume_enabled = resume

        # Performance tracking
        self.start_time: Optional[float] = None
        self.resume_time: Optional[float] = None
        self.page_times: List[float] = []  # Track time per page for ETA
        self.last_progress_log: float = 0
        self.progress_log_interval: int = 10  # Log detailed progress every N pages

    async def __aenter__(self):
        """Async context manager entry"""
        connector = aiohttp.TCPConnector(ssl=False)

        headers = {
            "User-Agent": self.user_agent
            or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Accept-Language": "az,en-US;q=0.9,en;q=0.8,ru;q=0.7",
            "Content-Type": "application/json",
            "Referer": "https://bina.az/kiraye",
            "Origin": "https://bina.az",
        }

        self.session = aiohttp.ClientSession(
            connector=connector,
            headers=headers,
            cookies=self.cookies,
            timeout=aiohttp.ClientTimeout(total=45),
        )
        return self
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit"""
        if self.session:
            await self.session.close()

    def build_url(self, cursor: Optional[str] = None) -> str:
        """Build GraphQL API URL with parameters"""
        variables = {
            "first": self.ITEMS_PER_PAGE,
            "filter": {"leased": True},
            "sort": "BUMPED_AT_DESC",
        }

        if cursor:
            variables["cursor"] = cursor

        params = {
            "operationName": self.OPERATION_NAME,
            "variables": json.dumps(variables, separators=(",", ":")),
            "extensions": json.dumps(
                {"persistedQuery": {"version": 1, "sha256Hash": self.SHA256_HASH}},
                separators=(",", ":"),
            ),
        }

        return f"{self.BASE_URL}?{urlencode(params)}"

    def extract_item_data(self, node: Dict) -> Dict[str, Any]:
        """Extract and flatten item data from node"""
        item = {
            # Basic information
            "id": node.get("id"),
            "area_value": node.get("area", {}).get("value")
            if node.get("area")
            else None,
            "area_units": node.get("area", {}).get("units")
            if node.get("area")
            else None,
            "leased": node.get("isLeased"),
            "floor": node.get("floor"),
            "floors": node.get("floors"),
            "rooms": node.get("rooms"),
            # Location information
            "city_id": node.get("city", {}).get("id") if node.get("city") else None,
            "city_name": node.get("city", {}).get("name") if node.get("city") else None,
            "location_id": node.get("location", {}).get("id")
            if node.get("location")
            else None,
            "location_name": node.get("location", {}).get("name")
            if node.get("location")
            else None,
            "location_full_name": node.get("location", {}).get("fullName")
            if node.get("location")
            else None,
            # Price information
            "price_value": node.get("price", {}).get("total")
            if node.get("price")
            else None,
            "price_currency": node.get("price", {}).get("currency")
            if node.get("price")
            else None,
            # Company/Agent information
            "company_id": node.get("company", {}).get("id")
            if node.get("company")
            else None,
            "company_name": node.get("company", {}).get("name")
            if node.get("company")
            else None,
            "company_target_type": node.get("company", {}).get("targetType")
            if node.get("company")
            else None,
            # Property features
            "has_mortgage": node.get("hasMortgage"),
            "has_bill_of_sale": node.get("hasBillOfSale"),
            "has_repair": node.get("hasRepair"),
            "paid_daily": node.get("isPaidDaily"),
            "is_business": node.get("isBusiness"),
            # Promotion status
            "vipped": node.get("isVipped"),
            "featured": node.get("isFeatured"),
            # Metadata
            "updated_at": node.get("updatedAt"),
            "path": node.get("path"),
            "photos_count": node.get("photosCount"),
            # Photos URLs
            "photos": json.dumps(
                [
                    {
                        "thumbnail": photo.get("thumbnail"),
                        "f460x345": photo.get("f460x345"),
                        "large": photo.get("large"),
                    }
                    for photo in node.get("photos", [])
                ]
            ),
            # Full URL
            "url": f"https://bina.az{node.get('path')}" if node.get("path") else None,
            # Category (will be filled later)
            "category": None,
            # Scraping metadata
            "scraped_at": datetime.now().isoformat(),
        }

        return item

    def validate_item(self, item: Dict) -> bool:
        """Validate that item has required fields"""
        required_fields = ["id", "scraped_at"]
        return all(item.get(field) is not None for field in required_fields)

    def load_checkpoint(self) -> Optional[Dict]:
        """Load checkpoint from file"""
        if not self.resume_enabled or not self.checkpoint_file.exists():
            return None

        try:
            with open(self.checkpoint_file, "r", encoding="utf-8") as f:
                checkpoint = json.load(f)
            cursor_preview = (checkpoint.get("cursor") or "None")[:50]
            logger.info(
                f"Loaded checkpoint: {checkpoint['items_count']} items, cursor: {cursor_preview}..."
            )
            return checkpoint
        except Exception as e:
            logger.warning(f"Failed to load checkpoint: {e}")
            return None

    def save_checkpoint(
        self,
        cursor: Optional[str],
        page_num: int,
        total_count: int,
        backup_file: Optional[Path] = None,
        completed: bool = False,
    ):
        """Save checkpoint to file"""
        try:
            checkpoint = {
                "cursor": cursor,
                "page_num": page_num,
                "items_count": len(self.all_items),
                "total_count": total_count,
                "backup_file": backup_file.name if backup_file else None,
                "completed": completed,
                "timestamp": datetime.now().isoformat(),
            }
            with open(self.checkpoint_file, "w", encoding="utf-8") as f:
                json.dump(checkpoint, f, ensure_ascii=False, indent=2)
            logger.debug(
                f"Checkpoint saved: page {page_num}, {len(self.all_items)} items"
            )
        except Exception as e:
            logger.error(f"Failed to save checkpoint: {e}")

    def save_incremental(self, page_num: int) -> Optional[Path]:
        """Save incremental backup of data"""
        try:
            filename = f"backup_rent_page{page_num}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            filepath = self.output_dir / filename
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(self.all_items, f, ensure_ascii=False, indent=2)
            logger.info(
                f"Incremental backup saved: {filepath} ({len(self.all_items)} items)"
            )
            return filepath
        except Exception as e:
            logger.error(f"Failed to save incremental backup: {e}")
            return None

    def save_recovery_state(
        self,
        cursor: Optional[str],
        page_num: int,
        total_count: int,
        completed: bool = False,
    ) -> None:
        """Save an item snapshot and the matching pagination position."""
        backup_file = self.save_incremental(page_num)
        if backup_file is None:
            logger.error("Recovery snapshot failed; keeping the previous checkpoint")
            return
        self.save_checkpoint(
            cursor,
            page_num,
            total_count,
            backup_file=backup_file,
            completed=completed,
        )

    def _read_recovery_file(self, filepath: Path) -> List[Dict]:
        """Read a supported recovery/export file into item dictionaries."""
        if filepath.suffix == ".json":
            with open(filepath, "r", encoding="utf-8") as f:
                return json.load(f)
        if filepath.suffix == ".parquet":
            return pd.read_parquet(filepath).to_dict(orient="records")
        if filepath.suffix == ".csv":
            return pd.read_csv(filepath).to_dict(orient="records")
        raise ValueError(f"Unsupported recovery file: {filepath}")

    def load_from_checkpoint(self):
        """Load previously scraped data from checkpoint"""
        checkpoint = self.load_checkpoint()
        if not checkpoint:
            return None, 0, 0, False

        expected_count = checkpoint.get("items_count", 0)
        candidates: List[Path] = []
        named_backup = checkpoint.get("backup_file")
        if named_backup:
            candidates.append(self.output_dir / named_backup)

        # Legacy checkpoints did not record the matching snapshot. Export files
        # are included so an interrupted run that already wrote partial output
        # can still resume without discarding its newest pages.
        candidates.extend(self.output_dir.glob("backup_rent_page*.json"))
        candidates.extend(self.output_dir.glob("bina_rent_*.parquet"))
        candidates.extend(self.output_dir.glob("bina_rent_*.csv"))
        existing_candidates = list(
            dict.fromkeys(path for path in candidates if path.exists())
        )
        candidates = sorted(
            existing_candidates,
            key=lambda x: x.stat().st_mtime,
            reverse=True,
        )
        if named_backup:
            named_path = self.output_dir / named_backup
            if named_path in candidates:
                candidates.remove(named_path)
                candidates.insert(0, named_path)

        loaded_from: Optional[Path] = None
        for candidate in candidates:
            try:
                recovered_items = self._read_recovery_file(candidate)
            except Exception as e:
                logger.warning(f"Failed to load recovery file {candidate.name}: {e}")
                continue

            if len(recovered_items) != expected_count:
                continue

            self.all_items = recovered_items
            self.seen_ids = {item["id"] for item in self.all_items if item.get("id")}
            loaded_from = candidate
            logger.info(
                f"Loaded {len(self.all_items)} items from recovery file: {candidate.name}"
            )
            break

        if expected_count and loaded_from is None:
            raise ScrapeIncompleteError(
                f"Checkpoint expects {expected_count} items, but no matching recovery file was found"
            )

        page_num = checkpoint.get("page_num", 0)
        # Repair the off-by-one written by versions that incremented the page
        # number before a failed request. This specifically covers complete
        # 16-item pages; newer checkpoints always store the last successful page.
        if (
            not named_backup
            and expected_count > 0
            and expected_count % self.ITEMS_PER_PAGE == 0
            and page_num == expected_count // self.ITEMS_PER_PAGE + 1
        ):
            page_num -= 1
            logger.warning(f"Repaired legacy checkpoint page number to {page_num}")

        return (
            checkpoint.get("cursor"),
            page_num,
            checkpoint.get("total_count", 0),
            checkpoint.get("completed", False),
        )

    def format_time_detailed(self, seconds: float) -> str:
        """Format seconds into detailed human-readable time"""
        if seconds < 0:
            return "calculating..."
        hours, remainder = divmod(int(seconds), 3600)
        minutes, secs = divmod(remainder, 60)
        if hours > 0:
            return f"{hours}h {minutes}m {secs}s"
        elif minutes > 0:
            return f"{minutes}m {secs}s"
        else:
            return f"{secs}s"

    def calculate_eta(self, current_page: int, total_pages: int) -> tuple[float, float]:
        """Calculate ETA and speed metrics"""
        if not self.page_times or current_page == 0:
            return 0, 0
        recent_times = (
            self.page_times[-20:] if len(self.page_times) > 20 else self.page_times
        )
        avg_time_per_page = sum(recent_times) / len(recent_times)
        pages_remaining = total_pages - current_page
        estimated_seconds = pages_remaining * avg_time_per_page
        return estimated_seconds, avg_time_per_page

    def log_progress(
        self,
        page_num: int,
        total_count: int,
        items_added: int,
        items_skipped: int,
        force: bool = False,
    ):
        """Log detailed progress with performance metrics"""
        current_time = time.time()
        total_pages = (total_count + self.ITEMS_PER_PAGE - 1) // self.ITEMS_PER_PAGE
        progress_pct = (page_num / total_pages * 100) if total_pages > 0 else 0

        logger.info(
            f"Page {page_num}/{total_pages}: +{items_added} items, {items_skipped} skipped | Total: {len(self.all_items)} / {total_count} ({progress_pct:.1f}%)"
        )

        if force or (page_num % self.progress_log_interval == 0 and page_num > 0):
            elapsed = current_time - self.start_time
            eta_seconds, avg_time_per_page = self.calculate_eta(page_num, total_pages)

            pages_per_minute = (page_num / elapsed) * 60 if elapsed > 0 else 0
            items_per_minute = (
                (len(self.all_items) / elapsed) * 60 if elapsed > 0 else 0
            )

            eta_str = (
                (datetime.now() + timedelta(seconds=eta_seconds)).strftime("%H:%M:%S")
                if eta_seconds > 0
                else "calculating..."
            )

            logger.info("=" * 80)
            logger.info(f"PROGRESS REPORT - Page {page_num}/{total_pages}")
            logger.info("-" * 80)
            logger.info(
                f"Progress:        [{progress_pct:5.1f}%] {page_num}/{total_pages} pages"
            )
            logger.info(f"Items scraped:   {len(self.all_items):,} / {total_count:,}")
            logger.info(f"Elapsed time:    {self.format_time_detailed(elapsed)}")
            logger.info(f"Time remaining:  {self.format_time_detailed(eta_seconds)}")
            logger.info(f"ETA:             {eta_str}")
            logger.info(
                f"Speed:           {pages_per_minute:.1f} pages/min | {items_per_minute:.1f} items/min"
            )
            logger.info("=" * 80)

    async def update_session(self, cookies, user_agent):
        """Update aiohttp session with new Cloudflare cookies/UA"""
        if self.session:
            await self.session.close()

        self.cookies = cookies
        self.user_agent = user_agent

        connector = aiohttp.TCPConnector(ssl=False)
        headers = {
            "User-Agent": self.user_agent,
            "Accept": "*/*",
            "Accept-Language": "az,en-US;q=0.9,en;q=0.8,ru;q=0.7",
            "Content-Type": "application/json",
            "Referer": "https://bina.az/kiraye",
            "Origin": "https://bina.az",
        }

        self.session = aiohttp.ClientSession(
            connector=connector,
            headers=headers,
            cookies=self.cookies,
            timeout=aiohttp.ClientTimeout(total=45),
        )
        logger.info("Session updated successfully with new Cloudflare tokens")

    async def fetch_page(self, cursor: Optional[str] = None) -> Optional[Dict]:
        """Fetch a single page of results with retry logic and Cloudflare bypass"""
        async with self.semaphore:
            url = self.build_url(cursor)
            for attempt in range(1, self.RETRY_ATTEMPTS + 1):
                try:
                    if self.session is None or self.session.closed:
                        await self.update_session(self.cookies, self.user_agent)

                    async with self.session.get(url) as response:
                        if response.status == 200:
                            try:
                                return await response.json()
                            except Exception as e:
                                logger.warning(
                                    f"Invalid JSON response (attempt {attempt}/{self.RETRY_ATTEMPTS}): {e}"
                                )
                        elif response.status == 403:
                            logger.warning(
                                f"Cloudflare block detected (403, attempt {attempt}/{self.RETRY_ATTEMPTS}). Launching re-auth..."
                            )
                            try:
                                new_cookies, new_ua = await get_cloudflare_session()
                                if new_cookies:
                                    await self.update_session(new_cookies, new_ua)
                                else:
                                    logger.error("Bypass failed or cancelled.")
                            except Exception as e:
                                logger.error(f"Error during re-auth: {e}")
                        else:
                            logger.warning(
                                f"Page request returned HTTP {response.status} "
                                f"(attempt {attempt}/{self.RETRY_ATTEMPTS})"
                            )
                except Exception as e:
                    logger.warning(
                        f"Error fetching page (attempt {attempt}/{self.RETRY_ATTEMPTS}): {e}"
                    )

                if attempt < self.RETRY_ATTEMPTS:
                    await asyncio.sleep(self.RETRY_DELAY * attempt)

            logger.error(f"Page request failed after {self.RETRY_ATTEMPTS} attempts")
            return None

    async def fetch_item_category(self, item_path: str) -> Optional[str]:
        """Fetch and extract category from item detail page"""
        if not item_path:
            return None

        try:
            detail_url = f"https://bina.az{item_path}"
            async with self.session.get(detail_url) as response:
                if response.status == 200:
                    html = await response.text()
                    return extract_category_from_html(html)
        except Exception as e:
            logger.debug(f"Failed to fetch category for {item_path}: {e}")

        return None

    async def scrape_all(self) -> List[Dict]:
        """Scrape all items with pagination and crash recovery"""
        self.start_time = time.time()
        cursor, page_num, total_count, completed = self.load_from_checkpoint()

        if completed:
            logger.info(
                f"Checkpoint is already complete: {len(self.all_items)} rent properties"
            )
            return self.all_items

        if cursor:
            logger.info(
                f"Resuming from checkpoint: page {page_num}, {len(self.all_items)} items already scraped"
            )
        else:
            logger.info("Starting fresh rent scrape...")
            page_num = 0
            total_count = 0

        consecutive_failures = 0
        max_consecutive_failures = 5

        try:
            while not completed:
                page_start_time = time.time()
                next_page_num = page_num + 1
                data = await self.fetch_page(cursor)

                if not data or "data" not in data or data["data"] is None:
                    consecutive_failures += 1
                    logger.error(
                        "Failed to fetch valid page data "
                        f"(failure {consecutive_failures}/{max_consecutive_failures})"
                    )
                    if consecutive_failures >= max_consecutive_failures:
                        raise ScrapeIncompleteError(
                            f"Rent scrape stopped before page {next_page_num} after "
                            f"{max_consecutive_failures} consecutive failures"
                        )
                    await asyncio.sleep(5 * consecutive_failures)
                    continue

                consecutive_failures = 0
                items_connection = data["data"].get("itemsConnection")
                if not items_connection:
                    raise ScrapeIncompleteError(
                        f"Rent scrape stopped before page {next_page_num}: "
                        "response has no itemsConnection"
                    )

                if next_page_num == 1 or total_count == 0:
                    total_count = items_connection.get("totalCount", 0)
                    logger.info(f"Total items to scrape: {total_count}")

                edges = items_connection.get("edges", [])
                if not edges:
                    page_info = items_connection.get("pageInfo", {})
                    if page_info.get("hasNextPage", False):
                        raise ScrapeIncompleteError(
                            f"Rent scrape received an empty non-final page at {next_page_num}"
                        )
                    page_num = next_page_num
                    cursor = None
                    completed = True
                    break

                page_info = items_connection.get("pageInfo", {})
                has_next_page = page_info.get("hasNextPage", False)
                next_cursor = page_info.get("endCursor") if has_next_page else None
                if has_next_page and not next_cursor:
                    raise ScrapeIncompleteError(
                        f"Rent scrape has no cursor on page {next_page_num}, "
                        "although the API reports another page"
                    )

                items_added = 0
                items_skipped = 0
                for edge in edges:
                    node = edge.get("node")
                    if node:
                        item_data = self.extract_item_data(node)
                        if (
                            not self.validate_item(item_data)
                            or item_data["id"] in self.seen_ids
                        ):
                            items_skipped += 1
                            continue

                        # Fetch category from detail page
                        item_path = node.get("path")
                        if item_path:
                            category = await self.fetch_item_category(item_path)
                            item_data["category"] = category

                        self.all_items.append(item_data)
                        self.seen_ids.add(item_data["id"])
                        items_added += 1

                self.page_times.append(time.time() - page_start_time)
                page_num = next_page_num
                self.log_progress(page_num, total_count, items_added, items_skipped)

                if not has_next_page:
                    cursor = None
                    completed = True
                else:
                    cursor = next_cursor

                # Keep the item snapshot and cursor aligned. A checkpoint with
                # newer pagination than its backup silently loses items on resume.
                if page_num % self.CHECKPOINT_INTERVAL == 0:
                    self.save_recovery_state(cursor, page_num, total_count)

                if completed:
                    break
                await asyncio.sleep(0.5)

        except KeyboardInterrupt:
            logger.warning("Rent scraping interrupted - saving recovery state...")
            self.save_recovery_state(cursor, page_num, total_count)
            raise
        except Exception as e:
            logger.error(f"Error during rent scraping: {e}", exc_info=True)
            self.save_recovery_state(cursor, page_num, total_count)
            raise

        self.save_recovery_state(None, page_num, total_count, completed=True)
        logger.info(
            f"Rent scraping completed at page {page_num}: "
            f"{len(self.all_items)} unique properties"
        )

        return self.all_items

    def save_to_json(self, filename: str = None):
        if filename is None:
            filename = f"bina_rent_{datetime.now().strftime('%Y%m')}.json"
        filepath = self.output_dir / filename
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(self.all_items, f, ensure_ascii=False, indent=2)
        logger.info(f"Data saved to JSON: {filepath}")
        return filepath

    def save_to_csv(self, filename: str = None):
        if not self.all_items:
            return None
        if filename is None:
            filename = f"bina_rent_{datetime.now().strftime('%Y%m')}.csv"
        filepath = self.output_dir / filename
        fieldnames = list(self.all_items[0].keys())
        with open(filepath, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(self.all_items)
        logger.info(f"Data saved to CSV: {filepath}")
        return filepath

    def save_to_parquet(self, filename: str = None):
        """Save data to Parquet file"""
        if not self.all_items:
            logger.warning("No data to save")
            return None

        if filename is None:
            filename = f"bina_rent_{datetime.now().strftime('%Y%m')}.parquet"

        filepath = self.output_dir / filename

        try:
            df = pd.DataFrame(self.all_items)
            df.to_parquet(filepath, index=False, engine="pyarrow")
            logger.info(f"Data saved to Parquet: {filepath}")
            return filepath
        except Exception as e:
            logger.error(f"Failed to save to Parquet: {e}")
            return None

    def save_to_xlsx(self, filename: str = None):
        """Save data to Excel (XLSX) file"""
        if not XLSX_AVAILABLE:
            logger.warning("openpyxl not installed. Cannot save to XLSX format.")
            return None

        if not self.all_items:
            logger.warning("No data to save")
            return None

        if filename is None:
            filename = f"bina_rent_{datetime.now().strftime('%Y%m')}.xlsx"

        filepath = self.output_dir / filename

        # Create workbook and worksheet
        wb = Workbook()
        ws = wb.active
        ws.title = "Rentals"

        # Get headers from first item
        headers = list(self.all_items[0].keys())

        # Style for header row
        header_fill = PatternFill(
            start_color="366092", end_color="366092", fill_type="solid"
        )
        header_font = Font(bold=True, color="FFFFFF")
        header_alignment = Alignment(horizontal="center", vertical="center")

        # Write headers
        for col_num, header in enumerate(headers, 1):
            cell = ws.cell(row=1, column=col_num, value=header)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = header_alignment

        # Write data rows
        for row_num, item in enumerate(self.all_items, 2):
            for col_num, header in enumerate(headers, 1):
                value = item.get(header)
                # Convert boolean to string for better Excel compatibility
                if isinstance(value, bool):
                    value = "Yes" if value else "No"
                ws.cell(row=row_num, column=col_num, value=value)

        # Auto-adjust column widths
        for column in ws.columns:
            max_length = 0
            column_letter = column[0].column_letter
            for cell in column:
                try:
                    if cell.value:
                        max_length = max(max_length, len(str(cell.value)))
                except:
                    pass
            adjusted_width = min(max_length + 2, 50)  # Max width of 50
            ws.column_dimensions[column_letter].width = adjusted_width

        # Save workbook
        wb.save(filepath)
        logger.info(f"Data saved to XLSX: {filepath}")
        return filepath


async def main():
    logger.info("=" * 80)
    logger.info("Bina.az Rent Property Scraper")
    logger.info("=" * 80)

    now = datetime.now()
    half = "q1" if now.day <= 16 else "q2"
    current_period = f"{now.strftime('%Y%m')}-{half}"

    async with BinaRentScraper() as scraper:
        items = await scraper.scrape_all()
        if items:
            scraper.save_to_json(f"bina_rent_{current_period}.json")
            scraper.save_to_csv(f"bina_rent_{current_period}.csv")
            scraper.save_to_xlsx(f"bina_rent_{current_period}.xlsx")
            scraper.save_to_parquet(f"bina_rent_{current_period}.parquet")
            logger.info(f"Scraping completed. Total items: {len(items)}")
        else:
            logger.error("No items scraped!")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        sys.exit(1)
