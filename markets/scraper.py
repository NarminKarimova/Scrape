import httpx
from bs4 import BeautifulSoup
import pandas as pd
import os
from datetime import datetime
import time
import re
import logging
from typing import List, Dict, Tuple, Optional

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Constants
BASE_URL = "https://birmarket.az"
API_URL = "https://mp-catalog.umico.az/api/v1/products"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
DEFAULT_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json"
}

def get_category_urls() -> List[str]:
    """
    Fetches all category URLs dynamically from the birmarket.az/categories page.
    
    Returns:
        List[str]: A list of relative category URLs.
    """
    url = f"{BASE_URL}/categories"
    
    try:
        with httpx.Client(headers=DEFAULT_HEADERS, follow_redirects=True, timeout=30.0, verify=False) as client:
            response = client.get(url)
            response.raise_for_status()

            soup = BeautifulSoup(response.text, 'html.parser')
            category_links = []
            for a in soup.find_all('a', href=True):
                href = a['href']
                # Match /categories/123-name but exclude the base /categories
                if re.match(r'^/categories/\d+-[a-z0-9-]+$', href):
                    category_links.append(href)
            
            unique_links = sorted(list(set(category_links)))
            logger.info(f"Found {len(unique_links)} dynamic categories.")
            return unique_links
    except Exception as e:
        logger.error(f"Error fetching category URLs: {e}")
        return []

def get_products_from_page(
    client: httpx.Client, 
    category_id: str, 
    page: int = 1, 
    per_page: int = 24, 
    retries: int = 3
) -> Tuple[Optional[List[Dict]], int]:
    """
    Fetches products from the Umico API for a specific page.
    
    Args:
        client: The httpx Client session.
        category_id: The ID of the category to fetch.
        page: The page number.
        per_page: Items per page.
        retries: Number of retry attempts.
        
    Returns:
        Tuple[Optional[List[Dict]], int]: A list of product dictionaries and the total item count.
    """
    params = {
        "category_id": category_id,
        "page": page,
        "per_page": per_page,
        "sort": "global_popular_score"
    }
    
    for attempt in range(retries):
        try:
            response = client.get(API_URL, params=params)
            response.raise_for_status()

            data = response.json()
            products_data = data.get('products', [])
            total_items = data.get('meta', {}).get('total', 0)
            
            products = []
            for p in products_data:
                offer = p.get('default_offer', {})
                retail_price = offer.get('retail_price', 0)
                old_price = offer.get('old_price', 0)
                
                # Base price is the non-discounted price
                base_price = old_price if old_price > retail_price else retail_price
                discount = 0
                if base_price > retail_price:
                    discount = round(((base_price - retail_price) / base_price) * 100, 2)

                # Extract labels
                labels = [l.get('text') for l in p.get('product_labels', [])]
                is_new = "Yenilik" in labels

                products.append({
                    'id': str(p.get('id')),
                    'name': p.get('name'),
                    'brand': p.get('brand', 'No Brand'),
                    'category': p.get('category', {}).get('name', 'Unknown'),
                    'category_id': p.get('category', {}).get('id'),
                    'price': retail_price,
                    'base_price': base_price,
                    'discount_percent': discount,
                    'rating': p.get('ratings', {}).get('rating_value', 0),
                    'rating_count': p.get('ratings', {}).get('session_count', 0),
                    'seller_rating': offer.get('seller', {}).get('rating', 0),
                    'is_new': is_new,
                    'currency': 'AZN',
                    'url': f"{BASE_URL}/product/{p.get('id')}-{p.get('slugged_name')}",
                    'image': p.get('main_img', {}).get('small'),
                    'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                })
            
            return products, total_items

        except httpx.HTTPStatusError as e:
            logger.warning(f"Attempt {attempt+1}: HTTP error {e.response.status_code} for page {page}")
        except Exception as e:
            logger.warning(f"Attempt {attempt+1}: Error fetching page {page}: {e}")
        
        if attempt < retries - 1:
            time.sleep(2 ** attempt) # Exponential backoff
            
    return None, 0

def scrape_category(client: httpx.Client, base_url: str, max_pages: Optional[int] = None) -> List[Dict]:
    """
    Scrapes all products from a specific category URL.
    """
    match = re.search(r'/categories/(\d+)', base_url)
    if not match:
        logger.error(f"Could not extract category ID from {base_url}")
        return []
    
    category_id = match.group(1)
    all_products = []
    seen_ids = set()
    per_page = 24
    
    # Get first page
    products, total_items = get_products_from_page(client, category_id, page=1, per_page=per_page)
    if not products:
        return []
    
    all_products.extend(products)
    for p in products:
        seen_ids.add(p['id'])
    
    total_pages = (total_items + per_page - 1) // per_page
    if max_pages:
        total_pages = min(total_pages, max_pages)
    
    logger.info(f"Category {category_id}: Found {total_items} items. Scraping {total_pages} pages.")
    
    for page in range(2, total_pages + 1):
        if page % 5 == 0:
            logger.info(f"  Progress: {page}/{total_pages} pages...")
            
        products, _ = get_products_from_page(client, category_id, page=page, per_page=per_page)
        if products:
            for p in products:
                if p['id'] not in seen_ids:
                    all_products.append(p)
                    seen_ids.add(p['id'])
        time.sleep(0.1)
    
    return all_products

def scrape_all_products(urls: List[str], max_pages: Optional[int] = None) -> List[Dict]:
    """
    Scrapes products from a list of category URLs.
    """
    total_collected = []
    with httpx.Client(headers=DEFAULT_HEADERS, follow_redirects=True, timeout=60.0, verify=False) as client:
        for url in urls:
            full_url = url if url.startswith('http') else f"{BASE_URL}{url}"
            logger.info(f"Scraping category: {full_url}")
            products = scrape_category(client, full_url, max_pages=max_pages)
            total_collected.extend(products)
            logger.info(f"Collected {len(products)} products from this category.")
            
    return total_collected

if __name__ == "__main__":
    # Test run
    test_urls = ["/categories/4497-dukan"]
    results = scrape_all_products(test_urls, max_pages=1)
    print(f"Test complete. Scraped {len(results)} products.")


