import unittest

import rent
import sale
from scraper_utils import extract_category_from_html


class ExtractCategoryTests(unittest.TestCase):
    def test_current_detail_field_wins_over_unrelated_page_text(self):
        html = """
            <nav>Yeni tikili</nav>
            <span data-cy="sizes-section__desc" class="generated-class">
                Köhnə tikili
            </span>
        """
        self.assertEqual(extract_category_from_html(html), "Köhnə tikili")

    def test_current_category_object_ignores_generic_real_estate(self):
        html = """
            <script type="application/ld+json">
                {"category":"Real Estate"}
            </script>
            <script>
                {"category":{"__typename":"Category","id":"5",
                "name":"Torpaq","slug":"torpaq"}}
            </script>
        """
        self.assertEqual(extract_category_from_html(html), "Torpaq")

    def test_legacy_category_field_is_supported(self):
        html = """
            <label class="product-properties__i-name">Kateqoriya</label>
            <span class="product-properties__i-value">Obyekt</span>
        """
        self.assertEqual(extract_category_from_html(html), "Obyekt")

    def test_listing_title_is_a_safe_fallback(self):
        html = "<title>Satılır 6 sot torpaq — Bakı - bina.az</title>"
        self.assertEqual(extract_category_from_html(html), "Torpaq")

    def test_generic_real_estate_is_rejected(self):
        html = '<script>{"category":"Real Estate"}</script>'
        self.assertIsNone(extract_category_from_html(html))

    def test_sale_and_rent_use_the_shared_extractor(self):
        self.assertIs(sale.extract_category_from_html, extract_category_from_html)
        self.assertIs(rent.extract_category_from_html, extract_category_from_html)


if __name__ == "__main__":
    unittest.main()
