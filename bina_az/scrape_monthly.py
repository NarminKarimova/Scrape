#!/usr/bin/env python3
"""
Monthly Bina.az Scraper
Simple one-click script to scrape new data for the current month
Saves as: bina_sale_202601.csv, bina_rent_202601.csv, etc.
"""

import asyncio
import json
from datetime import datetime
from pathlib import Path
from rent import BinaRentScraper
from sale import BinaScraper
from scraper_utils import get_cloudflare_session

RUN_PERIOD_FILE = Path("data") / ".last_run_period"


def get_run_period(now: datetime | None = None) -> str:
    """Return run period key: YYYYMM-q1 before day 15, otherwise YYYYMM-q2."""
    current = now or datetime.now()
    half = "q1" if current.day <= 16 else "q2"
    return f"{current.strftime('%Y%m')}-{half}"


def cleanup_json_files() -> int:
    """Delete stale JSON checkpoint and backup files to force clean runs."""
    removed = 0
    for json_file in Path("data").rglob("*.json"):
        try:
            json_file.unlink()
            removed += 1
        except OSError:
            continue
    return removed


def cleanup_empty_checkpoints() -> int:
    """Delete zero-item checkpoints that cannot resume any useful work."""
    removed = 0
    for checkpoint_file in Path("data").rglob("checkpoint.json"):
        try:
            checkpoint = json.loads(checkpoint_file.read_text(encoding="utf-8"))
            if checkpoint.get("items_count", 0) == 0 and not checkpoint.get("cursor"):
                checkpoint_file.unlink()
                removed += 1
        except (OSError, json.JSONDecodeError):
            continue
    return removed


def should_start_clean(current_period: str) -> bool:
    """Return True when this run belongs to a new monthly period."""
    if not RUN_PERIOD_FILE.exists():
        return True

    try:
        previous_period = RUN_PERIOD_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return True

    return previous_period != current_period


def save_run_period(current_period: str) -> None:
    """Remember the current period so reruns can resume safely."""
    RUN_PERIOD_FILE.parent.mkdir(parents=True, exist_ok=True)
    RUN_PERIOD_FILE.write_text(current_period, encoding="utf-8")


async def main():
    """Scrape current period data (twice per month)."""
    current_period = get_run_period()
    start_clean = should_start_clean(current_period)
    removed_json_files = cleanup_json_files() if start_clean else cleanup_empty_checkpoints()
    save_run_period(current_period)

    print("\n" + "=" * 80)
    print(f"BINA.AZ MONTHLY SCRAPER - {datetime.now().strftime('%B %Y')}")
    print("=" * 80)
    if removed_json_files:
        print(f"\nRemoved {removed_json_files} JSON file(s) for a clean run")
    print(f"\nFiles will be saved as:")
    print(f"  - bina_sale_{current_period}.csv")
    print(f"  - bina_sale_{current_period}.xlsx")
    print(f"  - bina_sale_{current_period}.parquet")
    print(f"  - bina_rent_{current_period}.csv")
    print(f"  - bina_rent_{current_period}.xlsx")
    print(f"  - bina_rent_{current_period}.parquet")
    print("\n" + "=" * 80)

    # Get Cloudflare Session (Interactive)
    cookies, user_agent = await get_cloudflare_session()
    if not cookies:
        print("⚠️ Warning: Could not get Cloudflare session. Scraper may fail with 403.")

    # Scrape both
    scraped_items = 0
    failed_sections = []

    # Scrape SALE
    print("\n🔄 Scraping SALE properties...")
    try:
        async with BinaScraper(
            cookies=cookies, user_agent=user_agent, resume=True
        ) as scraper:
            items = await scraper.scrape_all()
            if items:
                scraper.save_to_csv(f"bina_sale_{current_period}.csv")
                scraper.save_to_xlsx(f"bina_sale_{current_period}.xlsx")
                scraper.save_to_parquet(f"bina_sale_{current_period}.parquet")
                print(f"✓ Saved: {len(items)} sale properties")
                scraped_items += len(items)
    except Exception as e:
        failed_sections.append("sale")
        print(f"✗ Error scraping sales: {e}")

    # Scrape RENT
    print("\n🔄 Scraping RENT properties...")
    try:
        async with BinaRentScraper(
            cookies=cookies, user_agent=user_agent, resume=True
        ) as scraper:
            items = await scraper.scrape_all()
            if items:
                scraper.save_to_csv(f"bina_rent_{current_period}.csv")
                scraper.save_to_xlsx(f"bina_rent_{current_period}.xlsx")
                scraper.save_to_parquet(f"bina_rent_{current_period}.parquet")
                print(f"✓ Saved: {len(items)} rent properties")
                scraped_items += len(items)
    except Exception as e:
        failed_sections.append("rent")
        print(f"✗ Error scraping rentals: {e}")

    print("\n" + "=" * 80)
    if failed_sections:
        failed_names = ", ".join(failed_sections)
        print(
            f"Scraping INCOMPLETE ({failed_names} failed). "
            f"Successfully scraped items: {scraped_items:,}"
        )
    else:
        print(f"✓ Scraping complete! Total items: {scraped_items:,}")
    print("=" * 80 + "\n")

    if failed_sections:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
