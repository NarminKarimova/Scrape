import httpx
from bs4 import BeautifulSoup
import re
from datetime import datetime
import time
import logging
from typing import List, Dict, Optional
from urllib.parse import urlparse, parse_qs

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Constants
BASE_URL = "https://www.arazmarket.az"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
DEFAULT_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "az,en-US;q=0.9,en;q=0.8",
}
SORT_FIELD = "title"
SORT_DIRECTION = "asc"

# Main product categories on arazmarket.az
CATEGORIES = [
    {"slug": "tutun-ve-tutun-mehsullari-292", "name": "Tütün və tütün məhsulları"},
    {"slug": "et-mehsullari-4139", "name": "Ət məhsulları"},
    {"slug": "meyve-terevez-bitkiler-1325", "name": "Meyvə tərəvəz bitkilər"},
    {
        "slug": "kosmetika-ve-qulluq-vasiteleri-1838",
        "name": "Kosmetika və qulluq vasitələri",
    },
    {
        "slug": "xirdavatelektronikaavto-mehsullari-307",
        "name": "Xırdavat, elektronika, avto məhsulları",
    },
    {"slug": "yumurta-4151", "name": "Yumurta"},
    {"slug": "spirtli-ickiler-571", "name": "Spirtli içkilər"},
    {
        "slug": "defterxana-oyuncaq-senlik-mehsullari-4158",
        "name": "Dəftərxana oyuncaq şənlik məhsulları",
    },
    {"slug": "ag-et-mehsullari-65", "name": "Ağ ət məhsulları"},
    {"slug": "temizlik-322", "name": "Təmizlik"},
    {
        "slug": "konservlesdirilmis-mehsullar-1869",
        "name": "Konservləşdirilmiş məhsullar",
    },
    {"slug": "donmus-2386", "name": "Donmuş"},
    {"slug": "ketrinq-take-away-1879", "name": "Ketrınq-take away"},
    {"slug": "sirniyyat-605", "name": "Şirniyyat"},
    {
        "slug": "sud-ve-emal-olunmus-et-mehsullari-884",
        "name": "Süd və emal olunmuş ət məhsulları",
    },
    {"slug": "saglam-yasam-1140", "name": "Sağlam yaşam"},
    {
        "slug": "heyvan-yemekleri-ve-qulluq-mehsullari-1913",
        "name": "Heyvan yeməkləri və qulluq məhsulları",
    },
    {"slug": "defterxana-materiallari-2945", "name": "Dəftərxana materialları"},
    {"slug": "ev-esyalari-1943", "name": "Ev əşyaları"},
    {"slug": "quru-qida-1446", "name": "Quru qida"},
    {"slug": "baliq-mehsullari-170", "name": "Balıq məhsulları"},
    {"slug": "corek-ve-mayali-memulatlar-2489", "name": "Çörək və mayalı məmulatlar"},
    {
        "slug": "usaq-qidasi-ve-qulluq-vasiteleri-207",
        "name": "Uşaq qidası və qulluq vasitələri",
    },
    {"slug": "araz-un-memulatlari-2533", "name": "Araz un məmulatları"},
    {"slug": "quru-meyve-ve-cerezler-1", "name": "Quru meyvə və çərəzlər"},
    {"slug": "spirtsiz-ickiler-1027", "name": "Spirtsiz içkilər"},
]


def discover_categories() -> List[Dict]:
    """
    Dynamically discovers main categories from arazmarket.az.

    Returns:
        List[Dict]: List of categories with 'slug' and 'name' keys.
    """
    logger.info("Discovering categories from arazmarket.az...")

    try:
        with httpx.Client(
            headers=DEFAULT_HEADERS, timeout=30.0, verify=False, follow_redirects=True
        ) as client:
            response = client.get(f"{BASE_URL}/az")
            response.raise_for_status()

            soup = BeautifulSoup(response.text, "html.parser")
            categories = []
            seen_slugs = set()

            # Find all category links
            all_links = soup.find_all("a", href=True)
            for link in all_links:
                href = link.get("href", "")

                # Match category URLs like /az/categories/slug-id
                if "/az/categories/" in href:
                    # Extract slug from URL
                    match = re.search(r"/az/categories/([a-z0-9-]+)$", href)
                    if match:
                        slug = match.group(1)

                        if slug and slug not in seen_slugs:
                            # Get category name from link text
                            name = link.get_text(strip=True)
                            name = re.sub(r"\s+", " ", name)  # Clean whitespace

                            if name and len(name) > 2:
                                seen_slugs.add(slug)
                                categories.append({"slug": slug, "name": name})

            logger.info(f"Discovered {len(categories)} categories")

            if categories:
                return categories
            else:
                logger.warning("No categories found, using defaults")
                return CATEGORIES

    except Exception as e:
        logger.error(f"Error discovering categories: {e}")
        logger.info("Using default category list")
        return CATEGORIES


def get_search_page_products(
    client: httpx.Client,
    page: int = 1,
    category_slug: Optional[str] = None,
    retries: int = 3,
) -> Optional[List[Dict]]:
    """
    Fetches products from arazmarket.az using search or category pages.

    Args:
        client: The httpx Client session.
        page: The page number.
        category_slug: Category slug to scrape (if None, scrapes all via search).
        retries: Number of retry attempts.

    Returns:
        Optional[List[Dict]]: A list of product dictionaries.
    """
    if category_slug:
        url = f"{BASE_URL}/az/categories/{category_slug}"
    else:
        url = f"{BASE_URL}/az/search-result"

    # Araz's default "popular" order can repeat products across pages. A stable
    # alphabetical order prevents pagination overlap and missing products after
    # the existing ID-based deduplication.
    params = {
        "sort_field": SORT_FIELD,
        "sort_dir": SORT_DIRECTION,
    }
    if page > 1:
        params["page"] = page
    if not category_slug:
        params["search_term"] = ""

    for attempt in range(retries):
        try:
            response = client.get(url, params=params)
            response.raise_for_status()

            soup = BeautifulSoup(response.text, "html.parser")
            products = []

            # Find product cards - they have links to /az/products/
            product_links = soup.find_all(
                "a", href=re.compile(r"/az/products/[a-z0-9-]+-\d+")
            )

            seen_ids = set()
            for link in product_links:
                href = link.get("href", "")

                # Extract product ID and slug
                match = re.search(r"/az/products/([a-z0-9-]+)-(\d+)$", href)
                if not match:
                    continue

                product_slug = match.group(1)
                product_id = match.group(2)

                if product_id in seen_ids:
                    continue
                seen_ids.add(product_id)

                # Get product container (the card)
                card = link.find_parent("div", class_=re.compile(r"products-card_card"))
                if not card:
                    continue

                # Extract product name
                name_elem = card.find("h2") or card.find("heading")
                name = (
                    name_elem.get_text(strip=True)
                    if name_elem
                    else card.get_text(strip=True).split("|")[0].strip()
                )

                # Extract category from strong tag or card text
                category_elem = card.find("strong")
                category = (
                    category_elem.get_text(strip=True) if category_elem else "Unknown"
                )

                # Extract prices - using specific price container
                price = 0
                old_price = 0
                price_container = card.find(class_=re.compile(r"products-card_price"))

                if price_container:
                    # Current price usually in span
                    current_price_elem = price_container.find("span")
                    if current_price_elem:
                        price_text = current_price_elem.get_text(strip=True)
                        price_match = re.search(r"(\d+\.?\d*)", price_text)
                        if price_match:
                            price = float(price_match.group(1))

                    # Old price in del tag
                    old_price_elem = price_container.find("del")
                    if old_price_elem:
                        old_price_text = old_price_elem.get_text(strip=True)
                        old_price_match = re.search(r"(\d+\.?\d*)", old_price_text)
                        if old_price_match:
                            old_price = float(old_price_match.group(1))

                # Check for discount percentage
                discount = 0
                discount_elem = card.find(string=re.compile(r"\d+%"))
                if discount_elem:
                    discount_match = re.search(r"(\d+)%", discount_elem)
                    if discount_match:
                        discount = int(discount_match.group(1))

                # Calculate base price correctly
                base_price = old_price if old_price > 0 else price

                # Get image URL - specifically looking for the real product image in the Next.js optimized link
                image_url = None
                imgs = card.find_all("img")
                for img in imgs:
                    src = img.get("src", "")
                    if "/_next/image?url=" in src:
                        parsed = urlparse(src)
                        params = parse_qs(parsed.query)
                        if "url" in params:
                            image_url = params["url"][0]
                            break

                # Fallback to simple img if real one not found
                if not image_url:
                    img = card.find("img", src=True, alt=lambda x: x != "loading")
                    if img:
                        image_url = img.get("src")
                        if image_url and image_url.startswith("/"):
                            image_url = BASE_URL + image_url

                products.append(
                    {
                        "id": product_id,
                        "name": name,
                        "brand": "Unknown",
                        "category": category,
                        "category_id": category_slug or "all",
                        "price": price,
                        "base_price": base_price,
                        "discount_percent": discount,
                        "sku": product_slug,
                        "available": True,
                        "currency": "AZN",
                        "url": f"{BASE_URL}{href}",
                        "image": image_url,
                        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        "source": "arazmarket",
                    }
                )

            return products

        except httpx.HTTPStatusError as e:
            logger.warning(
                f"Attempt {attempt + 1}: HTTP error {e.response.status_code}"
            )
        except Exception as e:
            logger.warning(f"Attempt {attempt + 1}: Error fetching page {page}: {e}")

        if attempt < retries - 1:
            time.sleep(2**attempt)  # Exponential backoff

    return None


def scrape_category(
    client: httpx.Client, category: Dict, max_pages: Optional[int] = None
) -> List[Dict]:
    """
    Scrapes all products from a specific category.

    Args:
        client: The httpx Client session.
        category: Dictionary with 'slug' and 'name' keys.
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

        products = get_search_page_products(
            client, page=page, category_slug=category["slug"]
        )

        if not products:
            break

        # Add unique products
        new_count = 0
        for p in products:
            if p["id"] not in seen_ids:
                p["category"] = category["name"]  # Use category name from our list
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
    Scrapes products from all or specified categories.

    Args:
        categories: List of category dictionaries to scrape. If None, scrapes all.
        max_pages: Maximum number of pages per category.

    Returns:
        List[Dict]: List of all scraped products.
    """
    if categories is None:
        categories = CATEGORIES

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
    # Test dynamic discovery
    logger.info("Testing Araz Market scraper...")

    # Test scrape - scrape first page from a category with potential price confusion
    print("\nTesting product scraping (Drinks)...")
    test_categories = [{"slug": "spirtsiz-ickiler-1027", "name": "Spirtsiz içkilər"}]
    results = scrape_all_products(test_categories, max_pages=1)
    print(f"Test complete. Scraped {len(results)} products.")

    if results:
        print("\nSample products:")
        for p in results[:10]:
            print(f"  - {p['name']}: {p['price']} AZN (was {p['base_price']} AZN)")
            print(f"    Image: {p['image']}")
