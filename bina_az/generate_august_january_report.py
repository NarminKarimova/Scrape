#!/usr/bin/env python3
"""Generate a self-contained January vs August Bina.az price-per-m² report.

The source Parquet/CSV/Excel files are read-only. By default, this script compares
the January 2026 snapshots with the latest August 2026 (q2) snapshots for both
sale and rent listings and writes ``august_january_price_report.html`` beside
this script.
"""

from __future__ import annotations

import argparse
import html
import json
import math
import statistics
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Iterable

try:
    import pyarrow.parquet as parquet
except ImportError as exc:  # pragma: no cover - gives a useful CLI error
    raise SystemExit(
        "pyarrow is required. Run this script with the project's virtual "
        "environment (for example: .venv\\Scripts\\python.exe)."
    ) from exc

try:
    from plotly.offline import get_plotlyjs
except ImportError as exc:  # pragma: no cover - gives a useful CLI error
    raise SystemExit(
        "plotly is required. Run this script with the project's virtual "
        "environment (for example: .venv\\Scripts\\python.exe)."
    ) from exc


SCRIPT_DIR = Path(__file__).resolve().parent

# Manually transcribed from the external screenshot supplied for comparison.
# Its methodology is unknown, so these values are presented as a separate source.
EXTERNAL_COMPARISON = [
    {"group": "Largest decrease", "external_name": "Sahil", "location_full_name": "Sahil m.", "november_2025": 4170, "august_2026": 2576, "change": -38.2, "match_note": "Assumed metro; our data also contains Sahil q."},
    {"group": "Largest decrease", "external_name": "Nardaran", "location_full_name": "Nardaran q.", "november_2025": 3000, "august_2026": 1900, "change": -36.7, "match_note": ""},
    {"group": "Largest decrease", "external_name": "Elmlər Akademiyası", "location_full_name": "Elmlər Akademiyası m.", "november_2025": 3625, "august_2026": 2395, "change": -33.9, "match_note": ""},
    {"group": "Largest decrease", "external_name": "Mərdəkan", "location_full_name": "Mərdəkan q.", "november_2025": 1554, "august_2026": 1028, "change": -33.8, "match_note": ""},
    {"group": "Largest decrease", "external_name": "Gənclik", "location_full_name": "Gənclik m.", "november_2025": 3333, "august_2026": 2357, "change": -29.3, "match_note": ""},
    {"group": "Largest decrease", "external_name": "8 Noyabr", "location_full_name": "8 Noyabr m.", "november_2025": 2543, "august_2026": 1836, "change": -27.8, "match_note": ""},
    {"group": "Largest decrease", "external_name": "Azadlıq Prospekti", "location_full_name": "Azadlıq Prospekti m.", "november_2025": 2159, "august_2026": 1630, "change": -24.5, "match_note": ""},
    {"group": "Largest decrease", "external_name": "Bayıl", "location_full_name": "Bayıl q.", "november_2025": 4208, "august_2026": 3202, "change": -23.9, "match_note": ""},
    {"group": "Largest decrease", "external_name": "Keşlə", "location_full_name": "Keşlə q.", "november_2025": 1340, "august_2026": 1022, "change": -23.7, "match_note": ""},
    {"group": "Largest decrease", "external_name": "Binəqədi", "location_full_name": "Binəqədi r.", "november_2025": 1029, "august_2026": 789, "change": -23.3, "match_note": "Region match selected by user; our data also contains Binəqədi q."},
    {"group": "Largest increase", "external_name": "Yasamal", "location_full_name": "Yasamal r.", "november_2025": 1975, "august_2026": 3509, "change": 77.7, "match_note": "Assumed region; our data also contains Yasamal q."},
    {"group": "Largest increase", "external_name": "Nərimanov", "location_full_name": "Nərimanov r.", "november_2025": 2192, "august_2026": 3843, "change": 75.3, "match_note": ""},
    {"group": "Largest increase", "external_name": "28 May", "location_full_name": "28 May m.", "november_2025": 2361, "august_2026": 3979, "change": 68.5, "match_note": "Assumed metro: closer August value and 2,572 listings; 28 May q. has only 2"},
    {"group": "Largest increase", "external_name": "Qala", "location_full_name": "Qala q.", "november_2025": 497, "august_2026": 818, "change": 64.6, "match_note": ""},
    {"group": "Largest increase", "external_name": "Lökbatan", "location_full_name": "Lökbatan q.", "november_2025": 794, "august_2026": 1296, "change": 63.2, "match_note": ""},
    {"group": "Largest increase", "external_name": "Nizami", "location_full_name": "Nizami m.", "november_2025": 2500, "august_2026": 3976, "change": 59.0, "match_note": "Assumed metro; our data also contains Nizami r."},
    {"group": "Largest increase", "external_name": "Pirşağı", "location_full_name": "Pirşağı q.", "november_2025": 913, "august_2026": 1390, "change": 52.2, "match_note": ""},
    {"group": "Largest increase", "external_name": "Sulutəpə", "location_full_name": "Sulutəpə q.", "november_2025": 731, "august_2026": 1111, "change": 52.0, "match_note": ""},
    {"group": "Largest increase", "external_name": "Xəzər", "location_full_name": "Xəzər r.", "november_2025": 1357, "august_2026": 2034, "change": 49.9, "match_note": ""},
    {"group": "Largest increase", "external_name": "Şıxov", "location_full_name": "Şıxov q.", "november_2025": 1359, "august_2026": 2000, "change": 47.2, "match_note": ""},
]


@dataclass
class LocationPrices:
    name: str
    full_name: str
    kind: str
    prices_per_sqm: list[float] = field(default_factory=list)


@dataclass
class LoadResult:
    locations: dict[str, LocationPrices]
    valid_prices_per_sqm: list[float]
    source_rows: int
    valid_rows: int
    missing_location_rows: int
    invalid_price_rows: int
    invalid_area_rows: int
    unsupported_area_unit_rows: int
    duplicate_rows: int
    non_azn_rows: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create an interactive August-vs-January AZN/m² HTML report."
    )
    parser.add_argument("--year", type=int, default=2026, help="Comparison year")
    parser.add_argument(
        "--august-half",
        choices=("q1", "q2"),
        default="q2",
        help="August snapshot half (default: q2, the latest snapshot)",
    )
    parser.add_argument(
        "--market",
        choices=("both", "sale", "rent"),
        default="sale",
        help="Market(s) to include (default: sale)",
    )
    parser.add_argument(
        "--minimum-listings",
        type=int,
        default=20,
        help="Initial minimum listing count required in each month (default: 20)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=SCRIPT_DIR / "august_january_price_report.html",
        help="Output HTML path",
    )
    return parser.parse_args()


def location_kind(full_name: str) -> str:
    normalized = full_name.casefold().strip()
    if normalized.endswith(" r."):
        return "Region"
    if normalized.endswith(" m."):
        return "Metro"
    if normalized.endswith(" q."):
        return "Settlement"
    return "Other"


def area_in_square_metres(area: object, units: object) -> float | None:
    """Convert supported Bina.az area values to square metres."""
    try:
        numeric_area = float(area)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(numeric_area) or numeric_area <= 0:
        return None

    normalized_units = str(units).strip().casefold() if units is not None else ""
    if normalized_units in {"m²", "m2", "m^2"}:
        return numeric_area
    if normalized_units == "sot":
        return numeric_area * 100
    return None


def load_snapshot(path: Path) -> LoadResult:
    """Read only the report columns from a Parquet snapshot."""
    if not path.is_file():
        raise FileNotFoundError(f"Input snapshot not found: {path}")

    grouped: dict[str, LocationPrices] = {}
    values: defaultdict[str, list[float]] = defaultdict(list)
    seen_ids: set[int | str] = set()
    source_rows = valid_rows = missing_location = invalid_price = 0
    invalid_area = unsupported_area_unit = duplicates = non_azn = 0

    parquet_file = parquet.ParquetFile(path)
    required = {
        "id",
        "location_name",
        "location_full_name",
        "price_value",
        "price_currency",
        "area_value",
        "area_units",
    }
    available = set(parquet_file.schema_arrow.names)
    missing_columns = sorted(required - available)
    if missing_columns:
        raise ValueError(f"{path.name} is missing columns: {', '.join(missing_columns)}")

    for batch in parquet_file.iter_batches(columns=sorted(required), batch_size=16_384):
        data = batch.to_pydict()
        for listing_id, name, full_name, price, currency, area, area_units in zip(
            data["id"],
            data["location_name"],
            data["location_full_name"],
            data["price_value"],
            data["price_currency"],
            data["area_value"],
            data["area_units"],
        ):
            source_rows += 1
            if listing_id in seen_ids:
                duplicates += 1
                continue
            seen_ids.add(listing_id)

            if currency and str(currency).strip().upper() != "AZN":
                non_azn += 1
                continue
            if price is None or not math.isfinite(float(price)) or float(price) <= 0:
                invalid_price += 1
                continue
            if area is None:
                invalid_area += 1
                continue
            try:
                numeric_area = float(area)
            except (TypeError, ValueError):
                invalid_area += 1
                continue
            if not math.isfinite(numeric_area) or numeric_area <= 0:
                invalid_area += 1
                continue
            square_metres = area_in_square_metres(numeric_area, area_units)
            if square_metres is None:
                unsupported_area_unit += 1
                continue
            if (
                not name
                or not str(name).strip()
                or not full_name
                or not str(full_name).strip()
            ):
                missing_location += 1
                continue

            clean_name = str(name).strip()
            clean_full_name = str(full_name).strip()
            # The suffix in location_full_name differentiates region, metro,
            # and settlement records that otherwise share location_name.
            key = clean_full_name.casefold()
            if key not in grouped:
                grouped[key] = LocationPrices(
                    name=clean_name,
                    full_name=clean_full_name,
                    kind=location_kind(clean_full_name),
                )
            price_per_sqm = float(price) / square_metres
            values[key].append(price_per_sqm)
            valid_rows += 1

    for key, item in grouped.items():
        item.prices_per_sqm = values[key]

    all_valid_prices_per_sqm = [
        price for location in grouped.values() for price in location.prices_per_sqm
    ]
    return LoadResult(
        locations=grouped,
        valid_prices_per_sqm=all_valid_prices_per_sqm,
        source_rows=source_rows,
        valid_rows=valid_rows,
        missing_location_rows=missing_location,
        invalid_price_rows=invalid_price,
        invalid_area_rows=invalid_area,
        unsupported_area_unit_rows=unsupported_area_unit,
        duplicate_rows=duplicates,
        non_azn_rows=non_azn,
    )


def percentage_change(january: float, august: float) -> float | None:
    """Return the change from January, using January as the baseline."""
    if january == 0:
        return None
    return ((august - january) / january) * 100


def summarize_pair(january: LoadResult, august: LoadResult) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for key in sorted(january.locations.keys() & august.locations.keys()):
        jan = january.locations[key]
        aug = august.locations[key]
        jan_average = statistics.fmean(jan.prices_per_sqm)
        aug_average = statistics.fmean(aug.prices_per_sqm)
        jan_median = statistics.median(jan.prices_per_sqm)
        aug_median = statistics.median(aug.prices_per_sqm)
        rows.append(
            {
                "location_name": jan.name,
                "location_full_name": jan.full_name,
                "kind": jan.kind,
                "jan_count": len(jan.prices_per_sqm),
                "aug_count": len(aug.prices_per_sqm),
                "jan_average": round(jan_average, 2),
                "aug_average": round(aug_average, 2),
                "average_difference": round(aug_average - jan_average, 2),
                "average_change": round(percentage_change(jan_average, aug_average) or 0, 2),
                "jan_median": round(jan_median, 2),
                "aug_median": round(aug_median, 2),
                "median_difference": round(aug_median - jan_median, 2),
                "median_change": round(percentage_change(jan_median, aug_median) or 0, 2),
            }
        )
    return rows


def snapshot_summary(result: LoadResult) -> dict[str, int | float]:
    return {
        "source_rows": result.source_rows,
        "valid_rows": result.valid_rows,
        "missing_location_rows": result.missing_location_rows,
        "invalid_price_rows": result.invalid_price_rows,
        "invalid_area_rows": result.invalid_area_rows,
        "unsupported_area_unit_rows": result.unsupported_area_unit_rows,
        "duplicate_rows": result.duplicate_rows,
        "non_azn_rows": result.non_azn_rows,
        "average": round(statistics.fmean(result.valid_prices_per_sqm), 2),
        "median": round(statistics.median(result.valid_prices_per_sqm), 2),
    }


def input_paths(year: int, august_half: str, market: str) -> dict[str, tuple[Path, Path]]:
    result: dict[str, tuple[Path, Path]] = {}
    if market in {"both", "sale"}:
        result["sale"] = (
            SCRIPT_DIR / "data" / f"bina_sale_{year}01.parquet",
            SCRIPT_DIR / "data" / f"bina_sale_{year}08-{august_half}.parquet",
        )
    if market in {"both", "rent"}:
        result["rent"] = (
            SCRIPT_DIR / "data" / "rent" / f"bina_rent_{year}01.parquet",
            SCRIPT_DIR / "data" / "rent" / f"bina_rent_{year}08-{august_half}.parquet",
        )
    return result


def html_document(payload: dict[str, object]) -> str:
    safe_json = (
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
    )
    title = html.escape(str(payload["title"]))
    generated = html.escape(str(payload["generated_at"]))
    plotly_js = get_plotlyjs()
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
:root {{ --ink:#172033; --muted:#657087; --line:#dfe5ef; --paper:#fff;
  --bg:#f4f7fb; --blue:#2563eb; --green:#16845b; --red:#c43d4d; --soft:#edf3ff; }}
* {{ box-sizing:border-box; }}
body {{ margin:0; color:var(--ink); background:var(--bg); font:14px/1.45 Inter,Segoe UI,Arial,sans-serif; }}
.wrap {{ max-width:1500px; margin:auto; padding:28px; }}
header {{ background:linear-gradient(125deg,#16233c,#2456a6); color:#fff; border-radius:18px; padding:28px 32px; box-shadow:0 12px 30px #1e3a6a24; }}
h1 {{ margin:0 0 7px; font-size:clamp(25px,4vw,40px); line-height:1.12; }}
header p {{ margin:4px 0; color:#dbe8ff; }}
.cards {{ display:grid; grid-template-columns:repeat(5,minmax(150px,1fr)); gap:12px; margin:18px 0; }}
.card,.panel {{ background:var(--paper); border:1px solid var(--line); border-radius:14px; box-shadow:0 5px 18px #20365d0b; }}
.card {{ padding:15px 17px; }} .card span {{ display:block; color:var(--muted); font-size:12px; margin-bottom:5px; }}
.card strong {{ font-size:22px; letter-spacing:-.3px; }}
.panel {{ padding:18px; margin-top:16px; }}
.controls {{ display:grid; grid-template-columns:1fr 1fr 1fr 1.6fr 150px; gap:12px; align-items:end; }}
label {{ display:block; color:var(--muted); font-size:12px; font-weight:600; }}
select,input,button {{ width:100%; min-height:39px; margin-top:5px; padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px; background:#fff; color:var(--ink); font:inherit; }}
button {{ width:auto; cursor:pointer; color:#fff; background:var(--blue); border-color:var(--blue); padding-inline:16px; font-weight:600; }}
.panel-head {{ display:flex; gap:12px; justify-content:space-between; align-items:center; flex-wrap:wrap; margin-bottom:12px; }}
h2 {{ margin:0; font-size:19px; }} .meta {{ color:var(--muted); font-size:12px; }}
.chart {{ display:grid; grid-template-columns:1fr 1fr; gap:20px; }}
.chart h3 {{ margin:0 0 10px; font-size:14px; }}
.bar-row {{ display:grid; grid-template-columns:minmax(95px,1fr) 3fr 72px; gap:8px; align-items:center; margin:7px 0; font-size:12px; }}
.bar-name {{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }}
.bar-track {{ height:12px; background:#edf1f6; border-radius:20px; overflow:hidden; }}
.bar {{ height:100%; border-radius:20px; }} .up {{ background:var(--green); }} .down {{ background:var(--red); }}
.positive {{ color:var(--green); }} .negative {{ color:var(--red); }}
.table-wrap {{ overflow:auto; max-height:68vh; border:1px solid var(--line); border-radius:10px; }}
table {{ width:100%; border-collapse:collapse; white-space:nowrap; }}
th {{ position:sticky; top:0; z-index:1; background:#edf3fa; color:#3b475d; text-align:left; cursor:pointer; user-select:none; }}
th,td {{ padding:10px 12px; border-bottom:1px solid #e8edf4; }}
tbody tr:hover {{ background:#f7faff; }} td.num,th.num {{ text-align:right; font-variant-numeric:tabular-nums; }}
.badge {{ display:inline-block; padding:2px 7px; border-radius:20px; background:var(--soft); color:#31568e; font-size:11px; }}
.note {{ color:var(--muted); margin:12px 2px 0; font-size:12px; }}
.comparison summary {{ display:flex; justify-content:space-between; gap:12px; align-items:center; cursor:pointer; font-size:19px; font-weight:700; list-style:none; }}
.comparison summary::-webkit-details-marker {{ display:none; }}
.comparison summary::after {{ content:'Open comparison'; color:var(--blue); font-size:12px; font-weight:600; }}
.comparison[open] summary::after {{ content:'Close comparison'; }}
.comparison-content {{ margin-top:16px; }}
.comparison .table-wrap {{ max-height:none; }}
.comparison-charts {{ display:grid; grid-template-columns:1fr; gap:18px; margin-top:20px; }}
.comparison-chart {{ border:1px solid var(--line); border-radius:10px; padding:14px; overflow:hidden; }}
.comparison-chart h3 {{ margin:0 0 10px; }}
.line-chart {{ width:100%; min-height:450px; }}
.source-warning {{ padding:11px 13px; border-left:4px solid #d99a22; border-radius:7px; background:#fff8e8; color:#6d531d; }}
.match-note {{ display:block; margin-top:3px; color:#936b14; font-size:10px; }}
.badge.increase {{ background:#ffedf0; color:var(--red); }}
.badge.decrease {{ background:#e9f8f1; color:var(--green); }}
.empty {{ color:var(--muted); padding:22px; text-align:center; }}
footer {{ color:var(--muted); font-size:12px; padding:20px 4px 5px; }}
@media (max-width:900px) {{ .cards {{ grid-template-columns:repeat(2,1fr); }} .controls {{ grid-template-columns:1fr 1fr; }} .chart {{ grid-template-columns:1fr; }} }}
@media (max-width:520px) {{ .wrap {{ padding:12px; }} header {{ padding:22px; }} .cards,.controls {{ grid-template-columns:1fr; }} }}
</style>
</head>
<body>
<main class="wrap">
  <header>
    <h1>{title}</h1>
    <p>Location-level asking-price-per-m² comparison, with January as the percentage-change baseline.</p>
    <p>Generated {generated} · Prices in AZN/m² · August snapshot: {html.escape(str(payload["august_label"]))}</p>
  </header>

  <section class="cards" id="cards"></section>

  <section class="panel controls">
    <label>Market<select id="market"></select></label>
    <label>Location view<select id="view"><option value="all">All locations</option><option value="region">Regions only</option></select></label>
    <label>Price-per-m² statistic<select id="metric"><option value="average">Average AZN/m²</option><option value="median">Median AZN/m²</option></select></label>
    <label>Search location<input id="search" type="search" placeholder="Search name or full name…"></label>
    <label>Min. listings/month<input id="minimum" type="number" min="1" step="1" value="{int(payload["minimum_listings"])}"></label>
  </section>

  <section class="panel">
    <div class="panel-head"><h2>Largest price changes</h2><span class="meta" id="chart-meta"></span></div>
    <div class="chart"><div><h3 class="positive">Largest increases</h3><div id="risers"></div></div><div><h3 class="negative">Largest decreases</h3><div id="fallers"></div></div></div>
  </section>

  <details class="panel comparison" id="external-panel" open>
    <summary>Compare with external website results</summary>
    <div class="comparison-content">
      <p class="source-warning"><strong>External source:</strong> values manually transcribed from the screenshot supplied by the user. It compares November 2025 with August 2026; our report compares January 2026 with August 2026. The external calculation method and property mix are unknown, so differences do not by themselves indicate an error.</p>
      <div class="panel-head"><h2>Side-by-side comparison</h2><span class="meta" id="external-meta"></span></div>
      <div class="table-wrap">
        <table><thead><tr>
          <th>External category</th><th>External area</th><th>Matched full location</th>
          <th class="num">External Nov 2025</th><th class="num">External Aug 2026</th><th class="num">External change</th>
          <th class="num" id="external-our-jan-head">Our Jan 2026 average</th><th class="num" id="external-our-aug-head">Our Aug 2026 average</th>
          <th class="num">Our change</th><th class="num">August difference</th>
        </tr></thead><tbody id="external-rows"></tbody></table>
      </div>
      <div class="comparison-charts">
        <div class="comparison-chart"><h3>External “largest decreases” compared with our data</h3><div id="external-decrease-chart" class="line-chart"></div></div>
        <div class="comparison-chart"><h3>External “largest increases” compared with our data</h3><div id="external-increase-chart" class="line-chart"></div></div>
      </div>
      <p class="note">August difference is our August AZN/m² minus the external August AZN/m². Our columns follow the selected average/median statistic above. “Assumed” matches identify external names that can refer to more than one location type in our data.</p>
    </div>
  </details>

  <section class="panel">
    <div class="panel-head"><div><h2>Location comparison</h2><span class="meta" id="table-meta"></span></div><button id="download">Download filtered CSV</button></div>
    <div class="table-wrap">
      <table><thead><tr>
        <th data-key="location_name">Location name</th>
        <th data-key="location_full_name">Full location name</th><th data-key="kind">Type</th>
        <th class="num" data-key="jan_count">January listings</th><th class="num" data-key="aug_count">August listings</th>
        <th class="num" data-key="jan_price" id="jan-price-head">January average (AZN/m²)</th>
        <th class="num" data-key="aug_price" id="aug-price-head">August average (AZN/m²)</th>
        <th class="num" data-key="difference">Difference (AZN/m²)</th><th class="num" data-key="change">Change vs January ↓</th>
      </tr></thead><tbody id="rows"></tbody></table>
    </div>
    <p class="note">Every available valid listing for each qualifying location is used; the minimum-listings field is only an eligibility threshold and does not cap or sample the listings. Its default is 20, so a location must have at least 20 valid listings in both months. Each listing is first converted to AZN/m² as <code>price_value / area in m²</code>. Areas recorded in <code>sot</code> are converted using <code>1 sot = 100 m²</code>. Average is the arithmetic mean of these listing-level AZN/m² values; median is also available because extremes can strongly affect an average. Percentage change is <code>((August statistic − January statistic) / January statistic) × 100</code>, using January as the baseline. Calculations use unrounded values and the displayed result is rounded to two decimal places. Only exact <code>location_full_name</code> values present in both snapshots are compared. The January, August, and all-listing-change cards use all valid listings in the selected market; location filters affect the table, charts, range, and compared-location count.</p>
  </section>

  <section class="panel"><div class="panel-head"><h2>Method and data quality</h2></div><div id="quality"></div></section>
  <footer>This report describes advertised listing prices per m², not completed transactions. Changes can reflect both market movement and changes in the mix of listed property types.</footer>
</main>
<script>{plotly_js}</script>
<script id="report-data" type="application/json">{safe_json}</script>
<script>
const report = JSON.parse(document.getElementById('report-data').textContent);
const $ = id => document.getElementById(id);
const state = {{ sort:'change', direction:-1 }};
const money = value => new Intl.NumberFormat('en-US', {{maximumFractionDigits:0}}).format(value) + ' AZN/m²';
const count = value => new Intl.NumberFormat('en-US').format(value);
const pct = value => (value > 0 ? '+' : '') + value.toFixed(2) + '%';
const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}}[c]));

for (const key of Object.keys(report.markets)) {{
  const option = document.createElement('option'); option.value=key;
  option.textContent = key === 'sale' ? 'Sale' : 'Rent'; $('market').appendChild(option);
}}

function selectedRows() {{
  const market = report.markets[$('market').value];
  const min = Math.max(1, Number($('minimum').value) || 1);
  const term = $('search').value.trim().toLocaleLowerCase();
  const metric = $('metric').value;
  return market.rows.filter(r => r.jan_count >= min && r.aug_count >= min)
    .filter(r => $('view').value !== 'region' || r.kind === 'Region')
    .filter(r => !term || r.location_name.toLocaleLowerCase().includes(term) || r.location_full_name.toLocaleLowerCase().includes(term))
    .map(r => ({{...r, jan_price:r['jan_'+metric], aug_price:r['aug_'+metric], difference:r[metric+'_difference'], change:r[metric+'_change']}}));
}}

function renderCards(rows) {{
  const market = report.markets[$('market').value], metric = $('metric').value;
  const jan = market.january, aug = market.august;
  const totalChange = market['overall_'+metric+'_change'];
  const riser = [...rows].sort((a,b)=>b.change-a.change)[0];
  const faller = [...rows].sort((a,b)=>a.change-b.change)[0];
  const cards = [
    ['Locations compared', count(rows.length)],
    ['January overall '+metric, money(jan[metric])],
    ['August overall '+metric, money(aug[metric])],
    ['All-listing change', pct(totalChange)],
    ['Range in view', rows.length ? pct(faller.change)+' to '+pct(riser.change) : '—']
  ];
  $('cards').innerHTML = cards.map(([label,value]) => `<div class="card"><span>${{escapeHtml(label)}}</span><strong>${{escapeHtml(value)}}</strong></div>`).join('');
}}

function barRows(rows, direction) {{
  const sorted=[...rows].sort((a,b)=>direction*(b.change-a.change)).slice(0,8);
  if (!sorted.length) return '<div class="empty">No matching locations</div>';
  const max=Math.max(...sorted.map(r=>Math.abs(r.change)),1);
  return sorted.map(r=>`<div class="bar-row" title="${{escapeHtml(r.location_full_name)}}">
    <span class="bar-name">${{escapeHtml(r.location_full_name)}}</span><span class="bar-track"><span class="bar ${{r.change>=0?'up':'down'}}" style="display:block;width:${{Math.max(2,Math.abs(r.change)/max*100)}}%"></span></span>
    <strong class="${{r.change>=0?'positive':'negative'}}">${{pct(r.change)}}</strong></div>`).join('');
}}

function comparisonLineChart(elementId, items, sale, metric, chartLabel) {{
  const joined=items.map(item=>({{item,ours:sale.rows.find(r=>r.location_full_name===item.location_full_name)}})).filter(row=>row.ours);
  if (!joined.length) {{ $(elementId).innerHTML='<div class="empty">No matching chart data</div>'; return; }}
  const names=joined.map(row=>row.item.external_name);
  const traces=[
    {{name:'External Nov 2025',y:joined.map(row=>row.item.november_2025),line:{{color:'#6b7280',dash:'dash'}}}},
    {{name:'External Aug 2026',y:joined.map(row=>row.item.august_2026),line:{{color:'#059669'}},changes:joined.map(row=>row.item.change),changeLabel:'External Nov→Aug change'}},
    {{name:'Our Jan 2026 '+metric,y:joined.map(row=>row.ours['jan_'+metric]),line:{{color:'#93aee8',dash:'dash'}}}},
    {{name:'Our Aug 2026 '+metric,y:joined.map(row=>row.ours['aug_'+metric]),line:{{color:'#2563eb'}},changes:joined.map(row=>row.ours[metric+'_change']),changeLabel:'Our Jan→Aug change'}}
  ].map(trace=>({{
    ...trace,x:names,type:'scatter',mode:'lines+markers',
    marker:{{size:8,line:{{color:'#fff',width:1}}}},
    customdata:trace.changes,
    hovertemplate:'<b>%{{x}}</b><br>'+trace.name+': %{{y:,.0f}} AZN/m²'+(trace.changes?'<br>'+trace.changeLabel+': %{{customdata:+.2f}}%':'')+'<extra></extra>'
  }}));
  Plotly.react(elementId,traces,{{
    title:{{text:chartLabel,font:{{size:14}},x:0}},
    autosize:true,height:450,margin:{{l:65,r:25,t:70,b:115}},
    paper_bgcolor:'#fff',plot_bgcolor:'#fff',hovermode:'x unified',
    legend:{{orientation:'h',x:0,y:1.16,font:{{size:11}}}},
    xaxis:{{type:'category',tickangle:-35,automargin:true,gridcolor:'#eef1f5'}},
    yaxis:{{title:'AZN/m²',rangemode:'tozero',tickformat:',.0f',gridcolor:'#e5eaf1',zerolinecolor:'#9aa5b5'}},
    font:{{family:'Inter, Segoe UI, Arial, sans-serif',color:'#172033'}}
  }},{{responsive:true,displaylogo:false,scrollZoom:false}});
}}

function renderExternalComparison() {{
  const external=report.external_comparison || [], sale=report.markets.sale;
  if (!external.length || !sale) {{ $('external-panel').hidden=true; return; }}
  const metric=$('metric').value, byFullName=new Map(sale.rows.map(r=>[r.location_full_name,r]));
  $('external-our-jan-head').textContent='Our Jan 2026 '+metric+' (AZN/m²)';
  $('external-our-aug-head').textContent='Our Aug 2026 '+metric+' (AZN/m²)';
  $('external-meta').textContent=`${{count(external.length)}} external areas · our ${{metric}} AZN/m² shown`;
  $('external-rows').innerHTML=external.map(item=>{{
    const ours=byFullName.get(item.location_full_name);
    const groupClass=item.change>=0?'increase':'decrease';
    const matchNote=item.match_note ? `<span class="match-note">${{escapeHtml(item.match_note)}}</span>` : '';
    if (!ours) return `<tr><td><span class="badge ${{groupClass}}">${{escapeHtml(item.group)}}</span></td><td>${{escapeHtml(item.external_name)}}</td><td>${{escapeHtml(item.location_full_name)}}${{matchNote}}</td><td colspan="7" class="empty">No matching row in our Sale data</td></tr>`;
    const ourJan=ours['jan_'+metric], ourAug=ours['aug_'+metric], ourChange=ours[metric+'_change'];
    const augustDifference=ourAug-item.august_2026;
    return `<tr>
      <td><span class="badge ${{groupClass}}">${{escapeHtml(item.group)}}</span></td>
      <td>${{escapeHtml(item.external_name)}}</td><td>${{escapeHtml(item.location_full_name)}}${{matchNote}}</td>
      <td class="num">${{money(item.november_2025)}}</td><td class="num">${{money(item.august_2026)}}</td>
      <td class="num"><strong class="${{item.change>=0?'positive':'negative'}}">${{pct(item.change)}}</strong></td>
      <td class="num">${{money(ourJan)}}</td><td class="num">${{money(ourAug)}}</td>
      <td class="num"><strong class="${{ourChange>=0?'positive':'negative'}}">${{pct(ourChange)}}</strong></td>
      <td class="num ${{augustDifference>=0?'positive':'negative'}}">${{augustDifference>=0?'+':''}}${{money(augustDifference)}}</td>
    </tr>`;
  }}).join('');
  if ($('external-panel').open) {{
    comparisonLineChart('external-decrease-chart',external.filter(item=>item.group==='Largest decrease'),sale,metric,'External largest decreases compared with our data');
    comparisonLineChart('external-increase-chart',external.filter(item=>item.group==='Largest increase'),sale,metric,'External largest increases compared with our data');
  }}
}}

function render() {{
  let rows=selectedRows();
  rows.sort((a,b) => {{ const av=a[state.sort], bv=b[state.sort]; return (typeof av==='string' ? av.localeCompare(bv) : av-bv)*state.direction; }});
  renderCards(rows);
  $('risers').innerHTML=barRows(rows,1); $('fallers').innerHTML=barRows(rows,-1);
  const label=$('metric').value; $('jan-price-head').textContent='January '+label+' (AZN/m²)'; $('aug-price-head').textContent='August '+label+' (AZN/m²)';
  $('chart-meta').textContent=`Top changes among ${{count(rows.length)}} matching locations`;
  $('table-meta').textContent=`${{count(rows.length)}} locations shown · click a column heading to sort`;
  $('rows').innerHTML = rows.length ? rows.map(r=>`<tr><td>${{escapeHtml(r.location_name)}}</td><td>${{escapeHtml(r.location_full_name)}}</td><td><span class="badge">${{escapeHtml(r.kind)}}</span></td>
    <td class="num">${{count(r.jan_count)}}</td><td class="num">${{count(r.aug_count)}}</td><td class="num">${{money(r.jan_price)}}</td>
    <td class="num">${{money(r.aug_price)}}</td><td class="num ${{r.difference>=0?'positive':'negative'}}">${{r.difference>=0?'+':''}}${{money(r.difference)}}</td>
    <td class="num"><strong class="${{r.change>=0?'positive':'negative'}}">${{pct(r.change)}}</strong></td></tr>`).join('') : '<tr><td colspan="9" class="empty">No locations match the current filters.</td></tr>';
  renderExternalComparison();
  renderQuality();
}}

function renderQuality() {{
  const market=report.markets[$('market').value], j=market.january, a=market.august;
  $('quality').innerHTML=`<p><strong>Sources:</strong> <code>${{escapeHtml(market.january_file)}}</code> and <code>${{escapeHtml(market.august_file)}}</code></p>
  <p>January: ${{count(j.source_rows)}} source rows; ${{count(j.valid_rows)}} valid located AZN/m² listings; ${{count(j.missing_location_rows)}} missing locations; ${{count(j.invalid_area_rows)}} missing/invalid areas; ${{count(j.unsupported_area_unit_rows)}} unsupported area units.
  August: ${{count(a.source_rows)}} source rows; ${{count(a.valid_rows)}} valid located AZN/m² listings; ${{count(a.missing_location_rows)}} missing locations; ${{count(a.invalid_area_rows)}} missing/invalid areas; ${{count(a.unsupported_area_unit_rows)}} unsupported area units.</p>
  <p>Rows are deduplicated by <code>id</code>. Invalid/non-positive prices, non-AZN prices, missing locations, and unusable areas are excluded. <code>m²</code> is used directly and <code>sot</code> is converted to m². Exact <code>location_full_name</code> values are matched across months; suffixes identify Region (<code>r.</code>), Metro (<code>m.</code>), and Settlement (<code>q.</code>).</p>`;
}}

document.querySelectorAll('select,input').forEach(el=>el.addEventListener('input',render));
document.querySelectorAll('th[data-key]').forEach(th=>th.addEventListener('click',()=>{{ const key=th.dataset.key; if(state.sort===key)state.direction*=-1; else{{state.sort=key;state.direction=['location_name','location_full_name','kind'].includes(key)?1:-1;}} render(); }}));
$('external-panel').addEventListener('toggle',()=>{{ if ($('external-panel').open) renderExternalComparison(); }});
$('download').addEventListener('click',()=>{{
  const rows=selectedRows(), metric=$('metric').value;
  const columns=['location_name','location_full_name','kind','jan_count','aug_count','jan_price','aug_price','difference','change'];
  const headers=['location_name','location_full_name','kind','january_listings','august_listings','january_'+metric+'_azn_per_m2','august_'+metric+'_azn_per_m2','difference_azn_per_m2','change_percent'];
  const csv=[headers.join(','),...rows.map(r=>columns.map(k=>'"'+String(r[k]).replaceAll('"','""')+'"').join(','))].join('\\r\\n');
  const blob=new Blob(['\ufeff'+csv],{{type:'text/csv;charset=utf-8'}}), link=document.createElement('a');
  link.href=URL.createObjectURL(blob); link.download=`${{$('market').value}}_january_august_${{metric}}_comparison.csv`; link.click(); URL.revokeObjectURL(link.href);
}});
render();
</script>
</body>
</html>"""


def build_report(args: argparse.Namespace) -> Path:
    if args.minimum_listings < 1:
        raise ValueError("--minimum-listings must be at least 1")

    markets: dict[str, object] = {}
    for market_name, (january_path, august_path) in input_paths(
        args.year, args.august_half, args.market
    ).items():
        print(f"Reading {market_name}: {january_path.name} and {august_path.name}")
        january = load_snapshot(january_path)
        august = load_snapshot(august_path)
        january_summary = snapshot_summary(january)
        august_summary = snapshot_summary(august)
        markets[market_name] = {
            "january_file": str(january_path.relative_to(SCRIPT_DIR)),
            "august_file": str(august_path.relative_to(SCRIPT_DIR)),
            "january": january_summary,
            "august": august_summary,
            "overall_average_change": round(
                percentage_change(
                    statistics.fmean(january.valid_prices_per_sqm),
                    statistics.fmean(august.valid_prices_per_sqm),
                )
                or 0,
                2,
            ),
            "overall_median_change": round(
                percentage_change(
                    statistics.median(january.valid_prices_per_sqm),
                    statistics.median(august.valid_prices_per_sqm),
                )
                or 0,
                2,
            ),
            "rows": summarize_pair(january, august),
        }

    payload: dict[str, object] = {
        "title": (
            f"Bina.az {'Sale' if args.market == 'sale' else args.market.title()} "
            f"January vs August {args.year} Price per m²"
        ),
        "generated_at": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M %Z"),
        "august_label": f"{args.year}-08 {args.august_half.upper()}",
        "minimum_listings": args.minimum_listings,
        "external_comparison": EXTERNAL_COMPARISON if "sale" in markets else [],
        "markets": markets,
    }
    output = args.output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html_document(payload), encoding="utf-8")
    return output


def main() -> None:
    args = parse_args()
    try:
        output = build_report(args)
    except (FileNotFoundError, ValueError, OSError) as exc:
        raise SystemExit(f"Report generation failed: {exc}") from exc
    print(f"Report created: {output}")


if __name__ == "__main__":
    main()
