#!/usr/bin/env python3
"""
Backfill turbo.az detail columns by visiting listing URLs.

Default target:
  data/2026-05-q1/turbo_az_2026-05-q1.csv
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import pandas as pd
import requests
import urllib3
from bs4 import BeautifulSoup

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scraper import (  # noqa: E402
    EXPECTED_DETAIL_COLUMNS,
    TurboAzScraper,
    apply_authoritative_details,
    ensure_output_columns,
    safe_to_parquet,
)

DEFAULT_CSV = ROOT / "data" / "2026-05-q1" / "turbo_az_2026-05-q1.csv"


def fetch_details(session: requests.Session, url: str, timeout: int) -> dict:
    response = session.get(url, timeout=timeout, verify=False)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    details = {}

    for item in soup.find_all("div", class_="product-properties__i"):
        label = item.find(class_="product-properties__i-name")
        value = item.find(class_="product-properties__i-value")
        if not label or not value:
            continue

        key = label.get_text(strip=True)
        val = value.get_text(strip=True)
        detail_key = TurboAzScraper.DETAIL_LABEL_MAP.get(key, f"detail_{key}")
        details[detail_key] = val

    gallery = soup.find("div", class_="gallery-list") or soup.find("div", class_="gallery")
    if gallery:
        details["detail_images_count"] = len(gallery.find_all("img"))

    return details


def needs_backfill(row: pd.Series) -> bool:
    for col in EXPECTED_DETAIL_COLUMNS:
        if col in row and pd.notna(row[col]) and str(row[col]).strip():
            return False
    return True


def save_outputs(df: pd.DataFrame, csv_path: Path) -> None:
    df = ensure_output_columns(df)
    df.to_csv(csv_path, index=False, encoding="utf-8")
    parquet_df = df.copy()
    for col in ["year", "engine", "mileage", *EXPECTED_DETAIL_COLUMNS]:
        if col in parquet_df.columns and col != "detail_images_count":
            parquet_df[col] = parquet_df[col].where(
                parquet_df[col].isna(), parquet_df[col].astype(str)
            )
    safe_to_parquet(parquet_df, csv_path.with_suffix(".parquet"))


def prepare_mutable_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for col in ["year", "engine", "mileage", *EXPECTED_DETAIL_COLUMNS]:
        if col in df.columns and col != "detail_images_count":
            df[col] = df[col].astype("object")
    return df


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--sleep", type=float, default=0.25)
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--checkpoint-every", type=int, default=100)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    csv_path = args.csv
    if not csv_path.is_absolute():
        csv_path = ROOT / csv_path

    df = pd.read_csv(csv_path, low_memory=False)
    df = ensure_output_columns(df)
    df = prepare_mutable_columns(df)

    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            )
        }
    )

    end = len(df) if args.limit is None else min(len(df), args.start + args.limit)
    changed = 0
    failed = 0

    for idx in range(args.start, end):
        row = df.iloc[idx]
        url = row.get("url")
        if not isinstance(url, str) or not url.startswith("http"):
            continue
        if not args.overwrite and not needs_backfill(row):
            continue

        try:
            details = fetch_details(session, url, args.timeout)
            if not details:
                failed += 1
                print(f"[{idx + 1}/{len(df)}] no details: {url}")
                continue

            listing = df.loc[idx].to_dict()
            listing.update(details)
            apply_authoritative_details(listing, details)
            for key, value in listing.items():
                if key in df.columns:
                    df.at[idx, key] = value

            changed += 1
            if changed % 25 == 0:
                print(f"updated {changed:,}; last row {idx + 1:,}/{len(df):,}")
        except Exception as exc:
            failed += 1
            print(f"[{idx + 1}/{len(df)}] failed {url}: {exc}")

        if args.sleep:
            time.sleep(args.sleep)

        if changed and changed % args.checkpoint_every == 0:
            save_outputs(df, csv_path)
            print(f"checkpoint saved after {changed:,} updates")

    save_outputs(df, csv_path)
    print(f"done. updated={changed:,} failed={failed:,} file={csv_path}")


if __name__ == "__main__":
    main()
