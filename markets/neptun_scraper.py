import httpx
from bs4 import BeautifulSoup
import re
from datetime import datetime
import time
import logging
from typing import List, Dict, Optional

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Constants
BASE_URL = "https://neptun.az"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
DEFAULT_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "az,en-US;q=0.9,en;q=0.8",
}

# Main product categories on neptun.az
# Format: {"path": "url-path", "name": "Display Name"}
CATEGORIES = [
    [
        {"path": "meyve-terevez-quru-meyveler", "name": "Meyvə, tərəvəz, quru meyvə"},
        {"path": "et-toyuq-deniz-mehsullari", "name": "Ət, toyuq, dəniz məhsulları"},
        {"path": "qastronom", "name": "Qastronom"},
        {"path": "erzaq-mehsullari", "name": "Ərzaq məhsulları"},
        {"path": "sirniyyat-cay-kofe-diabet", "name": "Şirniyyat, çay, kofe, diabetik"},
        {"path": "ickiler", "name": "İçkilər"},
        {"path": "sud-mehsullari", "name": "Süd məhsulları"},
        {"path": "usaq-mehsullari", "name": "Uşaq məhsulları"},
        {
            "path": "yuyucu-temizleyici-vasiteler",
            "name": "Yuyucu,təmizləyici vasitələr",
        },
        {"path": "kosmetik-gigiyenik-vasiteler", "name": "Kosmetik və gigiyenik"},
        {"path": "meiset-metbex-tekstil", "name": "Məişət, mətbəx, tekstil"},
        {"path": "konselyariya", "name": "Konselyariya"},
        {"path": "heyvan-yemleri", "name": "Heyvan yemləri"},
        {"path": "yalniz-neptunda", "name": "Yalnız Neptunda"},
        {"path": "alicilarin-nezerine", "name": "Elektronika & Mebel"},
        {"path": "terefdaslar", "name": "Tərəfdaşlar"},
    ]
]


def discover_categories() -> List[Dict]:
    """
    Dynamically discovers main categories from neptun.az navigation.

    Returns:
        List[Dict]: List of categories with 'path' and 'name' keys.
    """
    logger.info("Discovering categories from neptun.az...")

    try:
        with httpx.Client(
            headers=DEFAULT_HEADERS, timeout=30.0, verify=False, follow_redirects=True
        ) as client:
            response = client.get(BASE_URL)
            response.raise_for_status()

            soup = BeautifulSoup(response.text, "html.parser")
            categories = []
            seen_paths = set()

            # Find navigation links
            nav_links = soup.select("nav a")

            current_main_category = None

            for link in nav_links:
                href = link.get("href", "")
                text = link.get_text(strip=True)

                if not text or len(text) < 3:
                    continue

                # Neptun uses javascript:void(0) for main category headers in some views
                # and actual links for subcategories. We want to group by main category.
                if "javascript:" in href:
                    current_main_category = text
                    continue

                # External links skip (like soliton.az)
                if "soliton.az" in href or not href.startswith((BASE_URL, "/")):
                    continue

                # Extract path
                path = href.replace(BASE_URL, "").strip("/")
                if not path:
                    continue

                # Get the top-level segment of the path
                path_parts = path.split("/")
                top_path = path_parts[0]

                # Skip system paths
                skip_patterns = [
                    "index.php",
                    "login",
                    "account",
                    "wishlist",
                    "compare",
                    "blog",
                    "about",
                    "bonus",
                    "supermarket",
                    "karyera",
                    "information",
                    "siyaset",
                    "reklam",
                    "partnyorluq",
                    "contact",
                ]
                if any(p in top_path.lower() for p in skip_patterns):
                    continue

                if top_path not in seen_paths:
                    seen_paths.add(top_path)

                    # If we just saw a JS header, use its name for this path
                    name = current_main_category if current_main_category else text

                    categories.append({"path": top_path, "name": name})
                    current_main_category = None  # Reset after using

            if categories:
                logger.info(f"Discovered {len(categories)} categories")
                return categories
            else:
                logger.warning("No categories found dynamically, using defaults")
                return CATEGORIES

    except Exception as e:
        logger.error(f"Error discovering categories: {e}")
        logger.info("Using default category list")
        return CATEGORIES


def scrape_category_page(
    client: httpx.Client, category_path: str, page: int = 1, retries: int = 3
) -> Optional[List[Dict]]:
    """
    Scrapes a single page of products from a neptun.az category.

    Args:
        client: The httpx Client session.
        category_path: The URL path segment for the category.
        page: Page number to scrape.
        retries: Number of retry attempts.

    Returns:
        Optional[List[Dict]]: List of product dictionaries, or None on failure.
    """
    url = f"{BASE_URL}/{category_path}"
    params = {}
    if page > 1:
        params["page"] = page
    # Show max products per page to reduce requests
    params["limit"] = 100

    for attempt in range(retries):
        try:
            response = client.get(url, params=params)
            response.raise_for_status()

            soup = BeautifulSoup(response.text, "html.parser")
            products = []

            # Find all product cards
            product_cards = soup.select(".product-layout")

            if not product_cards:
                return []

            for card in product_cards:
                try:
                    product = parse_product_card(card, category_path)
                    if product:
                        products.append(product)
                except Exception as e:
                    logger.debug(f"Error parsing product card: {e}")
                    continue

            return products

        except httpx.HTTPStatusError as e:
            logger.warning(
                f"Attempt {attempt + 1}: HTTP error {e.response.status_code} for {url}"
            )
        except Exception as e:
            logger.warning(
                f"Attempt {attempt + 1}: Error fetching page {page} of {category_path}: {e}"
            )

        if attempt < retries - 1:
            time.sleep(2**attempt)

    return None


def parse_product_card(card, category_path: str) -> Optional[Dict]:
    """
    Parses a single product card element into a product dictionary.

    Args:
        card: BeautifulSoup element for the product card.
        category_path: The category path for this product.

    Returns:
        Optional[Dict]: Product dictionary or None if parsing fails.
    """
    # Get product link and name
    link_elem = card.select_one(".product-image-container a")
    if not link_elem:
        return None

    product_url = link_elem.get("href", "")
    product_name = link_elem.get("title", "").strip()

    if not product_url or not product_name:
        return None

    # Strip query params from product URL (e.g. ?limit=100)
    product_url = product_url.split("?")[0]

    # Make URL absolute
    if not product_url.startswith("http"):
        product_url = f"{BASE_URL}/{product_url.lstrip('/')}"

    # Extract product ID from the quickview link or the add-to-cart button
    product_id = None
    quickview_link = card.select_one("a.quickview")
    if quickview_link:
        href = quickview_link.get("href", "")
        id_match = re.search(r"product_id=(\d+)", href)
        if id_match:
            product_id = id_match.group(1)

    # Fallback: get product_id from cart button onclick
    if not product_id:
        cart_btn = card.select_one("button.addToCart")
        if cart_btn:
            onclick = cart_btn.get("onclick", "")
            id_match = re.search(r"cart\.add\('(\d+)'", onclick)
            if id_match:
                product_id = id_match.group(1)

    # Fallback: extract from product URL slug (e.g., mvt-alma-fudji-kg-079552)
    if not product_id:
        slug_match = re.search(r"-(\d{5,})$", product_url.rstrip("/"))
        if slug_match:
            product_id = slug_match.group(1)

    if not product_id:
        return None

    # Extract SKU from product URL slug
    sku = product_url.rstrip("/").split("/")[-1]

    # Extract prices
    price = 0.0
    base_price = 0.0
    discount_percent = 0.0

    price_new_elem = card.select_one(".price .price-new")
    price_old_elem = card.select_one(".price .price-old")

    if price_new_elem:
        price_text = price_new_elem.get_text(strip=True)
        price_match = re.search(r"([\d.]+)", price_text)
        if price_match:
            price = float(price_match.group(1))

    if price_old_elem:
        old_text = price_old_elem.get_text(strip=True)
        old_match = re.search(r"([\d.]+)", old_text)
        if old_match:
            base_price = float(old_match.group(1))
    else:
        base_price = price

    # Extract discount percentage from label
    discount_label = card.select_one(".label-sale")
    if discount_label:
        discount_text = discount_label.get_text(strip=True)
        discount_match = re.search(r"(\d+)", discount_text)
        if discount_match:
            discount_percent = float(discount_match.group(1))
    elif base_price > 0 and price > 0 and base_price != price:
        discount_percent = round(((base_price - price) / base_price) * 100, 2)

    # Extract image URL
    image_url = ""
    img_elem = card.select_one(".product-image-container img.img-1")
    if img_elem:
        image_url = img_elem.get("src", "") or img_elem.get("data-src", "")
        if image_url and not image_url.startswith("http"):
            image_url = f"{BASE_URL}/{image_url.lstrip('/')}"

    # Get category name from breadcrumbs or use path
    category_name = category_path.replace("-", " ").title()

    return {
        "id": product_id,
        "name": product_name,
        "brand": "Unknown",
        "category": category_name,
        "category_id": category_path,
        "price": price,
        "base_price": base_price,
        "discount_percent": discount_percent,
        "sku": sku,
        "available": True,
        "currency": "AZN",
        "url": product_url,
        "image": image_url,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "source": "neptun",
    }


def get_total_pages(client: httpx.Client, category_path: str) -> int:
    """
    Determines the total number of pages for a category.

    Args:
        client: The httpx Client session.
        category_path: The URL path segment for the category.

    Returns:
        int: Total number of pages.
    """
    try:
        url = f"{BASE_URL}/{category_path}"
        response = client.get(url, params={"limit": 100})
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")

        # Find the last page link (">|" button)
        last_page_link = soup.select_one(".pagination li:last-child a")
        if last_page_link:
            href = last_page_link.get("href", "")
            page_match = re.search(r"page=(\d+)", href)
            if page_match:
                return int(page_match.group(1))

        # Check if there's any pagination at all
        pagination = soup.select(".pagination li")
        if len(pagination) > 1:
            # Get the second-to-last item (before ">|")
            for item in reversed(pagination):
                text = item.get_text(strip=True)
                if text.isdigit():
                    return int(text)

        return 1

    except Exception as e:
        logger.warning(f"Error getting total pages for {category_path}: {e}")
        return 1


def scrape_category(
    client: httpx.Client, category: Dict, max_pages: Optional[int] = None
) -> List[Dict]:
    """
    Scrapes all products from a specific category.

    Args:
        client: The httpx Client session.
        category: Dictionary with 'path' and 'name' keys.
        max_pages: Maximum number of pages to scrape (None for all).

    Returns:
        List[Dict]: List of product dictionaries.
    """
    all_products = []
    seen_ids = set()
    page = 1

    while True:
        if max_pages and page > max_pages:
            break

        products = scrape_category_page(client, category["path"], page=page)

        if not products:
            break

        # Add unique products
        new_count = 0
        for p in products:
            if p["id"] not in seen_ids:
                p["category"] = category["name"]  # Use category display name
                all_products.append(p)
                seen_ids.add(p["id"])
                new_count += 1

        if new_count == 0:
            break

        logger.info(f"  Page {page}: Got {new_count} new products")
        page += 1
        time.sleep(0.3)  # Be nice to the server

    return all_products


def scrape_all_products(
    categories: Optional[List[Dict]] = None, max_pages: Optional[int] = None
) -> List[Dict]:
    """
    Scrapes products from all or specified categories on neptun.az.

    Args:
        categories: List of category dictionaries to scrape. If None, scrapes all.
        max_pages: Maximum number of pages per category.

    Returns:
        List[Dict]: List of all scraped products.
    """
    if categories is None:
        categories = CATEGORIES
    if categories and isinstance(categories[0], list):
        categories = [category for group in categories for category in group]

    total_collected = []
    global_seen_ids = set()

    with httpx.Client(
        headers=DEFAULT_HEADERS, follow_redirects=True, timeout=60.0, verify=False
    ) as client:
        for category in categories:
            logger.info(f"Scraping category: {category['name']}")

            products = scrape_category(client, category, max_pages=max_pages)

            # Add only globally unique products
            unique_products = []
            for p in products:
                if p["id"] not in global_seen_ids:
                    unique_products.append(p)
                    global_seen_ids.add(p["id"])

            total_collected.extend(unique_products)
            logger.info(
                f"  Collected {len(unique_products)} unique products from {category['name']}"
            )
            time.sleep(0.5)  # Pause between categories

    logger.info(f"Total unique products collected: {len(total_collected)}")
    return total_collected


def get_available_categories() -> List[Dict]:
    """
    Returns list of all available categories (dynamically discovered).
    Falls back to hardcoded list if discovery fails.
    """
    try:
        return discover_categories()
    except Exception:
        return CATEGORIES.copy()


if __name__ == "__main__":
    # Test scrape
    logger.info("Testing Neptun scraper...")

    test_categories = [
        {"path": "meyve-terevez-quru-meyveler", "name": "Meyvə, tərəvəz, quru meyvə"}
    ]
    results = scrape_all_products(test_categories, max_pages=1)
    print(f"Test complete. Scraped {len(results)} products.")

    if results:
        print("\nSample products:")
        for p in results[:10]:
            print(f"  - {p['name']}: {p['price']} AZN (base: {p['base_price']} AZN)")
            print(f"    URL: {p['url']}")
