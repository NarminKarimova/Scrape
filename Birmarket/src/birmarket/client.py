from __future__ import annotations

import logging
import math
import re
import ssl
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable

import httpx
import truststore
from bs4 import BeautifulSoup

BASE_URL = "https://birmarket.az"
API_URL = "https://mp-catalog.umico.az/api/v1/products"
DEFAULT_CATEGORY = "2492"
DEFAULT_HEADERS = {
    "Accept": "application/json",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    ),
}
CATEGORY_PATTERN = re.compile(r"^/categories/(?P<id>\d+)(?:-[a-z0-9-]+)?/?$")

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Category:
    id: str
    name: str
    url: str


def category_id(value: str | int) -> str:
    """Extract a numeric category ID from an ID, path, or BirMarket URL."""
    text = str(value).strip()
    if text.isdigit():
        return text

    match = re.search(r"(?:^|/)categories/(\d+)(?:-|/|$)", text)
    if not match:
        raise ValueError(f"Invalid BirMarket category: {value!r}")
    return match.group(1)


def _number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _name(value: Any, default: str) -> str:
    if isinstance(value, dict):
        return str(value.get("name") or value.get("title") or default)
    return str(value or default)


def normalize_product(product: dict[str, Any], scraped_at: str) -> dict[str, Any]:
    """Convert one catalog API product into the snapshot schema."""
    offer = product.get("default_offer") or {}
    retail_price = _number(offer.get("retail_price"))
    old_price = _number(offer.get("old_price"))
    base_price = max(retail_price, old_price)
    discount = round((base_price - retail_price) / base_price * 100, 2) if base_price else 0.0

    labels = {
        str(label.get("text", "")).strip().casefold()
        for label in product.get("product_labels") or []
        if isinstance(label, dict)
    }
    ratings = product.get("ratings") or {}
    seller = offer.get("seller") or {}
    category = product.get("category") or {}
    product_id = str(product.get("id") or "")
    slug = str(product.get("slugged_name") or "").strip("-")
    product_path = f"{product_id}-{slug}" if slug else product_id

    main_image = product.get("main_img") or {}
    if isinstance(main_image, dict):
        image = main_image.get("large") or main_image.get("medium") or main_image.get("small")
    else:
        image = main_image

    return {
        "id": product_id,
        "name": product.get("name"),
        "brand": _name(product.get("brand"), "No Brand"),
        "category": _name(category, "Unknown"),
        "category_id": str(category.get("id") or product.get("category_id") or "")
        if isinstance(category, dict)
        else str(product.get("category_id") or ""),
        "price": retail_price,
        "base_price": base_price,
        "discount_percent": discount,
        "rating": _number(ratings.get("rating_value")),
        "rating_count": int(_number(ratings.get("session_count"))),
        "seller": seller.get("name"),
        "seller_rating": _number(seller.get("rating")),
        "is_new": any(label in {"yenilik", "new"} for label in labels),
        "currency": "AZN",
        "url": f"{BASE_URL}/product/{product_path}",
        "image": image,
        "source": "birmarket",
        "timestamp": scraped_at,
    }


class BirMarketClient:
    """Small synchronous client for BirMarket category discovery and products."""

    def __init__(
        self,
        *,
        timeout: float = 30.0,
        retries: int = 3,
        delay: float = 0.15,
        verify: bool = True,
        client: httpx.Client | None = None,
    ) -> None:
        self.retries = max(1, retries)
        self.delay = max(0.0, delay)
        self._owns_client = client is None
        if client is None:
            ssl_verification = (
                truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT) if verify else False
            )
            client = httpx.Client(
                headers=DEFAULT_HEADERS,
                follow_redirects=True,
                timeout=timeout,
                verify=ssl_verification,
            )
        self.http = client

    def __enter__(self) -> BirMarketClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        if self._owns_client:
            self.http.close()

    def _get(self, url: str, **kwargs: Any) -> httpx.Response:
        last_error: Exception | None = None
        for attempt in range(1, self.retries + 1):
            try:
                response = self.http.get(url, **kwargs)
                response.raise_for_status()
                return response
            except (httpx.HTTPError, ValueError) as exc:
                last_error = exc
                if attempt == self.retries:
                    break
                wait = 2 ** (attempt - 1)
                logger.warning("Request failed (%s); retrying in %ss", exc, wait)
                time.sleep(wait)
        assert last_error is not None
        raise last_error

    def discover_categories(self) -> list[Category]:
        response = self._get(f"{BASE_URL}/categories")
        soup = BeautifulSoup(response.text, "html.parser")
        categories: list[Category] = []
        seen: set[str] = set()

        for link in soup.find_all("a", href=True):
            href = str(link["href"]).split("?", 1)[0]
            match = CATEGORY_PATTERN.match(href)
            if not match:
                continue
            identifier = match.group("id")
            if identifier in seen:
                continue
            seen.add(identifier)
            name = " ".join(link.get_text(" ", strip=True).split()) or f"Category {identifier}"
            categories.append(Category(identifier, name, f"{BASE_URL}{href.rstrip('/')}"))

        logger.info("Discovered %s BirMarket categories", len(categories))
        return categories

    def products_page(
        self,
        category: str | int,
        *,
        page: int = 1,
        per_page: int = 24,
        scraped_at: str | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        identifier = category_id(category)
        response = self._get(
            API_URL,
            params={
                "category_id": identifier,
                "page": page,
                "per_page": per_page,
                "sort": "global_popular_score",
            },
        )
        payload = response.json()
        timestamp = scraped_at or datetime.now(timezone.utc).isoformat(timespec="seconds")
        products = [
            normalize_product(product, timestamp)
            for product in payload.get("products", [])
            if isinstance(product, dict)
        ]
        return products, int(payload.get("meta", {}).get("total") or 0)

    def scrape_category(
        self,
        category: str | int,
        *,
        max_pages: int | None = None,
        per_page: int = 24,
        scraped_at: str | None = None,
    ) -> list[dict[str, Any]]:
        identifier = category_id(category)
        timestamp = scraped_at or datetime.now(timezone.utc).isoformat(timespec="seconds")
        first_page, total = self.products_page(
            identifier, page=1, per_page=per_page, scraped_at=timestamp
        )
        pages = max(1, math.ceil(total / per_page))
        if max_pages is not None:
            pages = min(pages, max(1, max_pages))

        logger.info("Category %s: %s products across %s selected pages", identifier, total, pages)
        products = list(first_page)
        seen = {product["id"] for product in first_page}

        for page in range(2, pages + 1):
            if self.delay:
                time.sleep(self.delay)
            page_products, _ = self.products_page(
                identifier, page=page, per_page=per_page, scraped_at=timestamp
            )
            for product in page_products:
                if product["id"] not in seen:
                    seen.add(product["id"])
                    products.append(product)
        return products

    def scrape_categories(
        self,
        categories: Iterable[str | int],
        *,
        max_pages: int | None = None,
        per_page: int = 24,
    ) -> list[dict[str, Any]]:
        timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        products: list[dict[str, Any]] = []
        seen: set[str] = set()
        for category in categories:
            for product in self.scrape_category(
                category,
                max_pages=max_pages,
                per_page=per_page,
                scraped_at=timestamp,
            ):
                if product["id"] not in seen:
                    seen.add(product["id"])
                    products.append(product)
        return products
