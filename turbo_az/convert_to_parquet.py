#!/usr/bin/env python3
"""
One-time script: Convert existing CSVs to Parquet, drop duplicates from 2026-03,
and remove checkpoint (part) files.
"""

import pandas as pd
from pathlib import Path
import sys

DATA_DIR = Path("data")


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


def _normalize_numeric_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Ensure numeric columns are clean before Parquet serialization."""
    df = df.copy()
    if "year" in df.columns:
        df["year"] = pd.to_numeric(df["year"], errors="coerce")
    if "price" in df.columns:
        df["price"] = _coerce_price_to_numeric(df["price"])
    return df


def convert_csv_to_parquet(csv_path: Path):
    """Read a CSV, save as parquet next to it."""
    print(f"  Converting {csv_path.name} ...")
    df = pd.read_csv(csv_path, low_memory=False)
    df = _normalize_numeric_columns(df)
    parquet_path = csv_path.with_suffix(".parquet")
    df.to_parquet(parquet_path, index=False)
    print(f"    -> {parquet_path.name}  ({len(df):,} rows)")
    return df, parquet_path


def main():
    # ── 1. Convert all main CSVs to parquet ──────────────────────────────────
    print("=" * 60)
    print("STEP 1: Converting existing CSVs to Parquet")
    print("=" * 60)

    for month_dir in sorted(DATA_DIR.iterdir()):
        if not month_dir.is_dir():
            continue
        print(f"\n[{month_dir.name}]")
        for csv_file in sorted(month_dir.glob("turbo_az_*.csv")):
            # Skip part/checkpoint files
            if "_part" in csv_file.stem:
                continue
            convert_csv_to_parquet(csv_file)

    # ── 2. Drop duplicates from 2026-03 ─────────────────────────────────────
    print(f"\n{'=' * 60}")
    print("STEP 2: Dropping duplicates from 2026-03")
    print("=" * 60)

    march_csv = DATA_DIR / "2026-03" / "turbo_az_2026-03.csv"
    if march_csv.exists():
        df = pd.read_csv(march_csv)
        before = len(df)
        if "url" in df.columns:
            df.drop_duplicates(subset=["url"], keep="last", inplace=True)
        else:
            df.drop_duplicates(inplace=True)
        after = len(df)
        print(f"  Before: {before:,}  After: {after:,}  Removed: {before - after:,}")

        df.to_csv(march_csv, index=False, encoding="utf-8")
        parquet_df = _normalize_numeric_columns(df)
        parquet_df.to_parquet(march_csv.with_suffix(".parquet"), index=False)
        print("  Saved deduplicated CSV + Parquet")
    else:
        print(f"  {march_csv} not found, skipping.")

    # ── 3. Remove checkpoint (part) files from 2026-03 ──────────────────────
    print(f"\n{'=' * 60}")
    print("STEP 3: Removing checkpoint (part) files from 2026-03")
    print("=" * 60)

    march_dir = DATA_DIR / "2026-03"
    removed = 0
    for f in sorted(march_dir.glob("*_part*")):
        print(f"  Deleting {f.name}")
        f.unlink()
        removed += 1
    for f in sorted(march_dir.glob("*_test*")):
        print(f"  Deleting {f.name}")
        f.unlink()
        removed += 1
    print(f"  Removed {removed} file(s).")

    print(f"\n{'=' * 60}")
    print("DONE!")
    print("=" * 60)


if __name__ == "__main__":
    runs = 2
    if "--runs" in sys.argv:
        try:
            idx = sys.argv.index("--runs")
            runs = max(1, int(sys.argv[idx + 1]))
        except (ValueError, IndexError):
            print("Invalid --runs value. Falling back to 2 runs.")
            runs = 2

    print(f"Configured to run {runs} pass(es).")
    for run_idx in range(1, runs + 1):
        print(f"\n{'#' * 60}")
        print(f"RUN {run_idx}/{runs}".center(60))
        print(f"{'#' * 60}")
        main()
