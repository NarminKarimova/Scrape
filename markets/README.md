# Azerbaijan Supermarket Price Tracker & Inflation Metric

A production-ready tool to scrape products from multiple Azerbaijan supermarkets and track price changes over time to analyze inflation.

## Supported Stores
- **Birmarket.az** - via Umico API
- **Bazarstore.az** - via server-rendered category pages
- **Arazmarket.az** - via HTML scraping

## Features
- **High Performance**: Uses APIs and efficient scraping for fast data retrieval.
- **Enriched Data**: Captures brand, category, ratings, seller info, and "New" status.
- **Inflation Analysis**: Tracks both "Actual Price" (with discounts) and "Base Price" (standard price) to distinguish between sales and real inflation.
- **Multi-Format Export**: Saves unique snapshots in both CSV and Excel formats.
- **Dynamic Discovery**: Can automatically find and scrape all store categories.

## Setup

1. Install dependencies using `uv`:
   ```bash
   uv sync
   ```

## Usage

### Scrape Products

Scrape from a specific store:
```bash
# Scrape Bazarstore (default)
uv run main.py scrape --source bazarstore

# Scrape Birmarket
uv run main.py scrape --source birmarket

# Scrape Araz Market
uv run main.py scrape --source arazmarket

# Scrape all stores
uv run main.py scrape --source all --all
```

Run a quick Bazarstore test (1 page only):
```bash
uv run main.py scrape --source bazarstore --test
```

Scrape **all Bazarstore** categories dynamically:
```bash
uv run main.py scrape --source bazarstore --all
```

Run a quick Araz Market test (1 page only):
```bash
uv run main.py scrape --source arazmarket --test
```

Scrape **all Araz Market** categories dynamically:
```bash
uv run main.py scrape --source arazmarket --all
```

### Generate Inflation Report
Compare the latest month's prices with the previous month:
```bash
uv run main.py report
```

## Data Structure
The tool saves data to `price_history.csv` (master history) and unique timestamped files:
- `id`: Unique product ID.
- `name`: Product name.
- `brand`: Brand name.
- `category`: Category name.
- `price`: Current retail price.
- `base_price`: Original price (before discount).
- `discount_percent`: Calculated discount.
- `rating`: User rating (0-5).
- `is_new`: Boolean flag for new arrivals.
- `timestamp`: Date and time of scrape.

## Files
- `main.py`: CLI entry point with `argparse`.
- `scraper.py`: Birmarket API client with connection pooling and logging.
- `bazarstore_scraper.py`: Bazarstore category-page scraper.
- `arazmarket_scraper.py`: Araz Market HTML scraper.
- `report.py`: Data analysis engine using `pandas`.
- `price_history_*.csv`: Cumulative history files per store for reporting.

