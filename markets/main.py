import argparse
import pandas as pd
import os
import logging
from datetime import datetime
from bazarstore_scraper import (
    scrape_all_products as scrape_bazarstore,
    discover_collections,
    COLLECTIONS as BAZARSTORE_COLLECTIONS
)
from arazmarket_scraper import (
    scrape_all_products as scrape_arazmarket,
    discover_categories as discover_araz_categories,
    CATEGORIES as ARAZ_CATEGORIES
)
from neptun_scraper import (
    scrape_all_products as scrape_neptun,
    discover_categories as discover_neptun_categories,
    CATEGORIES as NEPTUN_CATEGORIES
)
from report import generate_report

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def get_parquet_stamp(run_time: datetime) -> str:
    """Builds a semi-monthly stamp for parquet snapshots."""
    half = "q1" if run_time.day <= 15 else "q2"
    return f"{run_time.strftime('%Y%m')}-{half}"

def save_products(products, source, month_stamp):
    """Saves products to CSV and Excel files for a specific source."""
    if not products:
        logger.warning(f"No products collected for {source}, skipping save.")
        return

    df = pd.DataFrame(products)
    
    # Ensure data directories exist
    os.makedirs("data/snapshots", exist_ok=True)
    os.makedirs("data/parquet", exist_ok=True)
    
    unique_csv = f"data/snapshots/{source}_{month_stamp}.csv"
    unique_xlsx = f"data/snapshots/{source}_{month_stamp}.xlsx"
    parquet_stamp = get_parquet_stamp(datetime.now())
    unique_parquet = f"data/parquet/{source}_{parquet_stamp}.parquet"
    
    # Save files
    df.to_csv(unique_csv, index=False)
    df.to_excel(unique_xlsx, index=False)
    df.to_parquet(unique_parquet, index=False)
    
    logger.info(f"Successfully saved {len(products)} products for {source}.")
    logger.info(f"  - Monthly snapshot (CSV): {unique_csv}")
    logger.info(f"  - Monthly snapshot (Excel): {unique_xlsx}")
    logger.info(f"  - Bi-monthly snapshot (Parquet): {unique_parquet}")

def run_scrape(args):
    """Handles the scrape command."""
    max_pages = None
    
    if args.test:
        logger.info("Running in TEST mode (1 page only)...")
        max_pages = 1
    
    source_arg = args.source
    month_stamp = datetime.now().strftime("%Y%m")
    total_count = 0
    
    # Define sources to process
    sources_to_scrape = []
    if source_arg == 'all':
        sources_to_scrape = ['bazarstore', 'arazmarket', 'neptun']
    else:
        sources_to_scrape = [source_arg]
    
    for source in sources_to_scrape:
        source_products = []
        
        # if source in ['birmarket', 'all']:
        #     logger.info("=== Scraping Birmarket.az ===")
        #     urls = ["https://birmarket.az/categories/4497-dukan"]
            
        #     if args.all:
        #         logger.info("Fetching category URLs dynamically...")
        #         urls = get_category_urls()
        #         if not urls:
        #             logger.warning("Could not fetch categories. Falling back to default.")
        #             urls = ["/categories/4497-dukan"]
            
        #     logger.info(f"Starting scrape of {len(urls)} Birmarket categories...")
        #     birmarket_products = scrape_birmarket(urls, max_pages=max_pages)
            
            # # Add source identifier
            # for p in birmarket_products:
            #     p['source'] = 'birmarket'
            
            # products.extend(birmarket_products)
            # logger.info(f"Birmarket: collected {len(birmarket_products)} products")
        
        if source == 'bazarstore':
            logger.info("=== Scraping Bazarstore.az ===")
            
            # Dynamically discover collections if --all is specified
            if args.all:
                logger.info("Discovering collections dynamically...")
                collections = discover_collections()
                logger.info(f"Found {len(collections)} collections to scrape")
            else:
                # Default: first 3 collections from hardcoded list
                collections = BAZARSTORE_COLLECTIONS[:3]
            
            logger.info(f"Starting scrape of {len(collections)} Bazarstore collections...")
            source_products = scrape_bazarstore(collections, max_pages=max_pages)
            logger.info(f"Bazarstore: collected {len(source_products)} products")
        
        elif source == 'arazmarket':
            logger.info("=== Scraping Arazmarket.az ===")
            
            # Dynamically discover categories if --all is specified
            if args.all:
                logger.info("Discovering categories dynamically...")
                categories = discover_araz_categories()
                logger.info(f"Found {len(categories)} categories to scrape")
            else:
                # Default: first 3 categories from hardcoded list
                categories = ARAZ_CATEGORIES[:3]
            
            logger.info(f"Starting scrape of {len(categories)} Arazmarket categories...")
            source_products = scrape_arazmarket(categories, max_pages=max_pages)
            logger.info(f"Arazmarket: collected {len(source_products)} products")
        
        elif source == 'neptun':
            logger.info("=== Scraping Neptun.az ===")
            
            # Dynamically discover categories if --all is specified
            if args.all:
                logger.info("Discovering categories dynamically...")
                categories = discover_neptun_categories()
                logger.info(f"Found {len(categories)} categories to scrape")
            else:
                # Default: first 3 categories from hardcoded list
                categories = NEPTUN_CATEGORIES[0][:3] if NEPTUN_CATEGORIES and isinstance(NEPTUN_CATEGORIES[0], list) else NEPTUN_CATEGORIES[:3]
            
            logger.info(f"Starting scrape of {len(categories)} Neptun categories...")
            source_products = scrape_neptun(categories, max_pages=max_pages)
            logger.info(f"Neptun: collected {len(source_products)} products")
        
        if source_products:
            save_products(source_products, source, month_stamp)
            total_count += len(source_products)
        else:
            logger.error(f"No products collected for {source}.")

    if total_count == 0:
        logger.error("No products were collected from any source.")

def main():
    parser = argparse.ArgumentParser(description="Azerbaijan Supermarket Price Scraper & Inflation Tracker")
    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # Scrape command
    scrape_parser = subparsers.add_parser("scrape", help="Scrape products from the website")
    scrape_parser.add_argument("--source", choices=['birmarket', 'bazarstore', 'arazmarket', 'neptun', 'all'], 
                               default='bazarstore', help="Which store to scrape (default: bazarstore)")
    scrape_parser.add_argument("--test", action="store_true", help="Run a test scrape (1 page only)")
    scrape_parser.add_argument("--all", action="store_true", help="Scrape all categories/collections")

    # Report command
    report_parser = subparsers.add_parser("report", help="Generate inflation report")
    report_parser.add_argument("--file", help="Path to history file (or a snapshot file for comparison)")

    args = parser.parse_args()

    if args.command == "scrape":
        run_scrape(args)
    elif args.command == "report":
        generate_report(args.file)
    else:
        parser.print_help()

if __name__ == "__main__":
    main()

