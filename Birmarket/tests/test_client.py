from birmarket.client import category_id, normalize_product


def test_category_id_accepts_ids_paths_and_urls() -> None:
    assert category_id("2492") == "2492"
    assert category_id("/categories/2492-food") == "2492"
    assert category_id("https://birmarket.az/categories/2-phones") == "2"


def test_normalize_product_handles_api_shape() -> None:
    product = {
        "id": 42,
        "name": "Test product",
        "slugged_name": "test-product",
        "brand": "Test Brand",
        "category": {"id": 7, "name": "Test category"},
        "default_offer": {
            "retail_price": 8,
            "old_price": 10,
            "seller": {"name": "Seller", "rating": 95},
        },
        "ratings": {"rating_value": 4.5, "session_count": 12},
        "product_labels": [{"text": "Yenilik"}],
        "main_img": {"small": "https://example.test/image.jpg"},
    }

    result = normalize_product(product, "2026-09-30T00:00:00+00:00")

    assert result["id"] == "42"
    assert result["price"] == 8.0
    assert result["base_price"] == 10.0
    assert result["discount_percent"] == 20.0
    assert result["is_new"] is True
    assert result["source"] == "birmarket"
    assert result["url"] == "https://birmarket.az/product/42-test-product"
