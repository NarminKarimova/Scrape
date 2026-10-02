# BirMarket Price Tracker

A clean, BirMarket-only scraper for collecting product catalog snapshots from [birmarket.az](https://birmarket.az/). The project discovers catalog categories from the live site and reads product data from the catalog API used by BirMarket.

## What it collects

- Product ID, name, brand, and category
- Current and original prices
- Calculated discount percentage
- Product and seller ratings
- Product URL and image URL
- Snapshot timestamp

BirMarket is a general marketplace, so the catalog includes electronics, appliances, home products, groceries, beauty products, clothing, and other categories—not only supermarket goods.

## Setup

Install [uv](https://docs.astral.sh/uv/), then run:

```powershell
uv sync
```

## Usage

Run a small one-page scrape of the food and drinks category:

```powershell
uv run birmarket scrape --max-pages 1
```

The root-level convenience script runs the same scrape command:

```powershell
uv run python birmarket_scraper.py --max-pages 1
```

Scrape one or more categories by ID or URL:

```powershell
uv run birmarket scrape --category 2 --category https://birmarket.az/categories/2492-iri-baglamada-qida-mehsullari
```

Discover and scrape every category shown on BirMarket's categories page:

```powershell
uv run birmarket scrape --all
```

List the currently discovered categories without scraping products:

```powershell
uv run birmarket categories
```

Snapshots are written to `data/snapshots/` in CSV, Excel, and Parquet formats. Use `--format` to select only the formats you need:

```powershell
uv run birmarket scrape --max-pages 1 --format csv --format parquet
```

If your network uses a TLS-inspecting proxy and certificate verification fails, you can explicitly use `--insecure`. Do not use it on an untrusted network.

## Notes

- Be considerate of BirMarket's infrastructure. The scraper uses a short delay between requests and retries temporary failures.
- Site and API structures may change. Run the test suite and a one-page scrape after updating the code.
- Review BirMarket's terms and applicable rules before large-scale or repeated collection.

## Tests

```powershell
uv run pytest
```
