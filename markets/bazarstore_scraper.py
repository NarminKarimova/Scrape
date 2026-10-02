import json
import logging
import re
import time
from datetime import datetime
from typing import List, Dict, Optional
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Constants
BASE_URL = "https://bazarstore.az"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
DEFAULT_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
PAGE_SIZE = 20  # Largest page size currently offered by Bazarstore

# Current top-level category routes on bazarstore.az. These are also used as a
# fallback if dynamic discovery is temporarily unavailable.
COLLECTIONS = [
    {"handle": "meyve-terevez", "name": "Meyvə, tərəvəz"},
    {"handle": "et-toyuq-baliq", "name": "Ət, Toyuq, Balıq"},
    {"handle": "temel-qida", "name": "Təməl qida"},
    {"handle": "sud-seher-yemeyi", "name": "Süd, Səhər Yeməyi"},
    {"handle": "ickiler", "name": "İçkilər"},
    {"handle": "atisdirmaliq", "name": "Atışdırmalıq"},
    {"handle": "tort-bismeler-corek", "name": "Tort, Bişmələr, Çörək"},
    {"handle": "baxim-kosmetik-sagliq", "name": "Baxım, kosmetik, sağlamlıq"},
    {"handle": "ev-ve-bag-mehsullari", "name": "Ev və bağ məhsulları"},
    {"handle": "petshop", "name": "Petshop"},
    {"handle": "elektronik", "name": "Elektronika"},
    {"handle": "defterxana-levazimatlari", "name": "Dəftərxana ləvazimatları"},
    {"handle": "usaq-dunyasi", "name": "Uşaq dünyası"},
    {"handle": "deterjan-temizlik", "name": "Deterjan, təmizlik"},
]


def discover_collections() -> List[Dict]:
    """
    Dynamically discovers top-level categories from Bazarstore's main menu.

    Returns:
        List[Dict]: List of collections with 'handle' and 'name' keys.
    """
    logger.info("Discovering categories from bazarstore.az sidebar...")

    try:
        with httpx.Client(
            headers=DEFAULT_HEADERS, timeout=30.0, verify=False
        ) as client:
            response = client.get(BASE_URL)
            response.raise_for_status()

            soup = BeautifulSoup(response.text, "html.parser")
            collections: List[Dict] = []
            seen_handles = set()

            # The desktop mega-menu has one direct child per top-level category.
            # The same menu is repeated for mobile, so use this specific selector
            # and still deduplicate defensively.
            links = soup.select("ul.mega-menu > li.root-category-items > a[href]")
            for link in links:
                href = link.get("href", "").split("?", 1)[0]
                handle = href.strip("/")
                name = " ".join(link.get_text(" ", strip=True).split())
                name = re.sub(r"^[^\w]+", "", name, flags=re.UNICODE).strip()

                if handle and name and handle not in seen_handles:
                    seen_handles.add(handle)
                    collections.append({"handle": handle, "name": name})

            logger.info(f"Discovered {len(collections)} main categories")

            # If we found collections, return them; otherwise return defaults
            if collections:
                return collections
            else:
                logger.warning("No categories found, using defaults")
                return COLLECTIONS.copy()

    except Exception as e:
        logger.error(f"Error discovering categories: {e}")
        logger.info("Using default collection list")
        return COLLECTIONS.copy()


def _parse_price(value: Optional[str]) -> Optional[float]:
    """Parse prices such as ``1.234,56 ₼`` and ``12,50 ₼``."""
    if not value:
        return None

    cleaned = re.sub(r"[^\d,.-]", "", value)
    if not cleaned:
        return None

    if "," in cleaned and "." in cleaned:
        if cleaned.rfind(",") > cleaned.rfind("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif "," in cleaned:
        cleaned = cleaned.replace(",", ".")

    try:
        return float(cleaned)
    except ValueError:
        return None


def _parse_product_card(card, collection_handle: str, collection_name: str) -> Optional[Dict]:
    """Convert one server-rendered Bazarstore product card to our schema."""
    tracking_data = {}
    raw_tracking_data = card.get("data-bzdl-item")
    if raw_tracking_data:
        try:
            tracking_data = json.loads(raw_tracking_data)
        except (TypeError, json.JSONDecodeError):
            logger.debug("Could not parse tracking data for a product card")

    title_link = card.select_one(".product-title a[href]") or card.select_one("a[href]")
    if not title_link:
        return None

    name = tracking_data.get("item_name") or title_link.get_text(" ", strip=True)
    product_id = card.get("data-productid") or tracking_data.get("item_id")
    if not name or product_id is None:
        return None

    actual_price_node = card.select_one(".prices .actual-price")
    old_price_node = card.select_one(".prices .old-price")
    price = _parse_price(actual_price_node.get_text(" ", strip=True)) if actual_price_node else None

    # Tracking data provides the same current price and is a useful fallback.
    if price is None:
        try:
            price = float(tracking_data.get("price"))
        except (TypeError, ValueError):
            return None

    old_price = _parse_price(old_price_node.get_text(" ", strip=True)) if old_price_node else None
    base_price = old_price if old_price is not None and old_price > price else price
    discount = round(((base_price - price) / base_price) * 100, 2) if base_price else 0

    image_node = card.select_one(".picture img")
    image_url = None
    if image_node:
        image_url = (
            image_node.get("data-lazyloadsrc")
            or image_node.get("data-src")
            or image_node.get("src")
        )

    cart_button = card.select_one(".product-box-add-to-cart-button")
    button_classes = cart_button.get("class", []) if cart_button else []
    available = bool(
        cart_button
        and not cart_button.has_attr("disabled")
        and "disabled" not in button_classes
        and not card.select_one(".out-of-stock")
    )

    return {
        "id": str(product_id),
        "name": name,
        "brand": tracking_data.get("item_brand") or "No Brand",
        "category": collection_name,
        "category_id": collection_handle,
        "price": price,
        "base_price": base_price,
        "discount_percent": discount,
        "sku": str(tracking_data.get("item_id") or ""),
        "available": available,
        "currency": "AZN",
        "url": urljoin(BASE_URL, title_link.get("href", "")),
        "image": urljoin(BASE_URL, image_url) if image_url else None,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "source": "bazarstore",
    }


def get_collection_products(
    client: httpx.Client,
    collection_handle: str,
    collection_name: str,
    page: int = 1,
    limit: int = PAGE_SIZE,
    retries: int = 3,
) -> Optional[List[Dict]]:
    """
    Fetch products from a server-rendered Bazarstore category page.

    Args:
        client: The httpx Client session.
        collection_handle: The URL handle of the collection.
        collection_name: Human-readable name of the collection.
        page: The page number.
        limit: Requested products per page (Bazarstore currently supports 5, 10, or 20).
        retries: Number of retry attempts.

    Returns:
        Optional[List[Dict]]: A list of product dictionaries.
    """
    url = urljoin(f"{BASE_URL}/", collection_handle.strip("/"))
    if limit <= 5:
        page_size = 5
    elif limit <= 10:
        page_size = 10
    else:
        page_size = PAGE_SIZE
    params = {"pagesize": page_size, "pagenumber": page}

    for attempt in range(retries):
        try:
            response = client.get(url, params=params)
            response.raise_for_status()

            soup = BeautifulSoup(response.text, "html.parser")
            product_cards = soup.select(".product-item[data-productid]")
            if not product_cards:
                return []

            products = []
            for card in product_cards:
                product = _parse_product_card(card, collection_handle, collection_name)
                if product:
                    products.append(product)

            if not products:
                logger.warning(
                    f"Found {len(product_cards)} product cards but could not parse them "
                    f"for {collection_name} page {page}"
                )

            return products

        except httpx.HTTPStatusError as e:
            logger.warning(
                f"Attempt {attempt + 1}: HTTP error {e.response.status_code} for {collection_name} page {page}"
            )
        except Exception as e:
            logger.warning(
                f"Attempt {attempt + 1}: Error fetching {collection_name} page {page}: {e}"
            )

        if attempt < retries - 1:
            time.sleep(2**attempt)  # Exponential backoff

    return None


def scrape_collection(
    client: httpx.Client, collection: Dict, max_pages: Optional[int] = None
) -> List[Dict]:
    """
    Scrapes all products from a specific collection.

    Args:
        client: The httpx Client session.
        collection: Dictionary with 'handle' and 'name' keys.
        max_pages: Maximum number of pages to scrape (None for all).

    Returns:
        List[Dict]: List of product dictionaries.
    """
    all_products = []
    seen_ids = set()
    page = 1
    limit = PAGE_SIZE

    while True:
        if max_pages and page > max_pages:
            break

        products = get_collection_products(
            client, collection["handle"], collection["name"], page=page, limit=limit
        )

        if not products:
            break

        # Add unique products
        new_count = 0
        for p in products:
            if p["id"] not in seen_ids:
                all_products.append(p)
                seen_ids.add(p["id"])
                new_count += 1

        if new_count == 0:
            break

        logger.info(f"  Page {page}: Got {new_count} new products")
        page += 1
        time.sleep(0.2)  # Be nice to the server

    return all_products


def scrape_all_products(
    collections: Optional[List[Dict]] = None, max_pages: Optional[int] = None
) -> List[Dict]:
    """
    Scrapes products from all or specified collections.

    Args:
        collections: List of collection dictionaries to scrape. If None, scrapes all.
        max_pages: Maximum number of pages per collection.

    Returns:
        List[Dict]: List of all scraped products.
    """
    if collections is None:
        collections = COLLECTIONS

    total_collected = []
    global_seen_ids = set()

    with httpx.Client(
        headers=DEFAULT_HEADERS, follow_redirects=True, timeout=60.0, verify=False
    ) as client:
        for collection in collections:
            logger.info(f"Scraping collection: {collection['name']}")

            products = scrape_collection(client, collection, max_pages=max_pages)

            # Add only globally unique products
            unique_products = []
            for p in products:
                if p["id"] not in global_seen_ids:
                    unique_products.append(p)
                    global_seen_ids.add(p["id"])

            total_collected.extend(unique_products)
            logger.info(
                f"  Collected {len(unique_products)} unique products from {collection['name']}"
            )
            time.sleep(0.5)  # Pause between collections

    logger.info(f"Total unique products collected: {len(total_collected)}")
    return total_collected


def get_available_collections() -> List[Dict]:
    """
    Returns list of all available collections (dynamically discovered).
    Falls back to hardcoded list if discovery fails.
    """
    try:
        return discover_collections()
    except:
        return COLLECTIONS.copy()


if __name__ == "__main__":
    # Test dynamic discovery
    logger.info("Testing dynamic collection discovery...")
    discovered = discover_collections()
    print(f"\nDiscovered {len(discovered)} collections:")
    for col in discovered[:10]:
        print(f"  - {col['name']} ({col['handle']})")

    # Test scrape - scrape first 2 pages from first 2 collections
    print("\nTesting product scraping...")
    test_collections = discovered[:2] if discovered else COLLECTIONS[:2]
    results = scrape_all_products(test_collections, max_pages=1)
    print(f"Test complete. Scraped {len(results)} products.")

    if results:
        print("\nSample products:")
        for p in results[:3]:
            print(f"  - {p['name']}: {p['price']} AZN (was {p['base_price']} AZN)")
