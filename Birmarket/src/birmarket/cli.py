from __future__ import annotations

import argparse
import logging
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from .client import DEFAULT_CATEGORY, BirMarketClient, category_id

logger = logging.getLogger(__name__)


def save_snapshot(
    products: list[dict[str, object]],
    output_dir: Path,
    formats: list[str],
) -> list[Path]:
    if not products:
        raise RuntimeError("BirMarket returned no products; no snapshot was written")

    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    base = output_dir / f"birmarket_{stamp}"
    frame = pd.DataFrame(products)
    paths: list[Path] = []

    for file_format in dict.fromkeys(formats):
        path = base.with_suffix(f".{file_format}")
        if file_format == "csv":
            frame.to_csv(path, index=False)
        elif file_format == "xlsx":
            frame.to_excel(path, index=False)
        elif file_format == "parquet":
            frame.to_parquet(path, index=False)
        else:
            raise ValueError(f"Unsupported format: {file_format}")
        paths.append(path)
    return paths


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="birmarket",
        description="Collect product catalog snapshots from BirMarket.az",
    )
    parser.add_argument("--verbose", action="store_true", help="Enable detailed logging")
    subparsers = parser.add_subparsers(dest="command", required=True)

    categories = subparsers.add_parser("categories", help="List discovered categories")
    categories.add_argument("--insecure", action="store_true", help="Disable TLS verification")

    scrape = subparsers.add_parser("scrape", help="Scrape product snapshots")
    scrape.add_argument(
        "--category",
        action="append",
        default=[],
        help="Category ID or BirMarket category URL; may be repeated",
    )
    scrape.add_argument("--all", action="store_true", help="Discover and scrape all categories")
    scrape.add_argument("--max-pages", type=int, help="Maximum pages per category")
    scrape.add_argument("--per-page", type=int, default=24, help="Products per API page")
    scrape.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data/snapshots"),
        help="Snapshot output directory",
    )
    scrape.add_argument(
        "--format",
        action="append",
        choices=("csv", "xlsx", "parquet"),
        dest="formats",
        help="Output format; may be repeated (default: all three)",
    )
    scrape.add_argument("--insecure", action="store_true", help="Disable TLS verification")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    try:
        with BirMarketClient(verify=not args.insecure) as client:
            if args.command == "categories":
                discovered = client.discover_categories()
                for category in discovered:
                    print(f"{category.id}\t{category.name}\t{category.url}")
                return 0 if discovered else 1

            if args.all and args.category:
                parser.error("Use either --all or --category, not both")
            if args.max_pages is not None and args.max_pages < 1:
                parser.error("--max-pages must be at least 1")
            if args.per_page < 1:
                parser.error("--per-page must be at least 1")

            if args.all:
                category_ids = [category.id for category in client.discover_categories()]
                if not category_ids:
                    raise RuntimeError("No categories were discovered")
            elif args.category:
                category_ids = [category_id(value) for value in args.category]
            else:
                category_ids = [DEFAULT_CATEGORY]

            logger.info("Scraping %s category/categories", len(category_ids))
            products = client.scrape_categories(
                category_ids,
                max_pages=args.max_pages,
                per_page=args.per_page,
            )
            paths = save_snapshot(
                products,
                args.output_dir,
                args.formats or ["csv", "xlsx", "parquet"],
            )
            logger.info("Collected %s unique products", len(products))
            for path in paths:
                print(path)
            return 0
    except Exception as exc:
        logger.error("%s", exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
