"""Transformation-layer unit tests."""

from decimal import Decimal

import pytest

from src.normalize import normalize_file, normalize_product, slugify


def test_slugify_matches_javascript_loader():
    assert slugify("Summerhill's Own White French Baguette 280 g") == (
        "summerhill-s-own-white-french-baguette-280-g"
    )
    assert slugify("  Organic & Fresh Æble  ") == "organic-and-fresh-aeble"
    assert slugify("---") == ""
    assert slugify("Cap'n Crunch — Réturn Øf") == "cap-n-crunch-re-turn-of"


def test_flatten_grouped_output_counts():
    groups = [
        {"category": "Snacks", "subcategory": "Chips", "products": [{"sku": "1"}, {"sku": "2"}]},
        {"category": "Snacks", "subcategory": "Pretzels", "products": [{"sku": "3"}]},
        {"category": "Beverages", "subcategory": "Juices", "products": [{"sku": "4"}]},
    ]
    products = normalize_file(groups)[0]
    assert len(products) == 4
    assert {p["sku"] for p in products} == {"1", "2", "3", "4"}


def test_normalize_product_coercions():
    product = normalize_product(
        {
            "id": "123",
            "sku": "123",
            "name": "Organic Apple Juice",
            "price": 6.999,
            "currency": "cad",
            "organic": 1,
            "unitQuantity": "2",
            "minQuantity": None,
            "maxQuantity": "",
            "availability": "IN_STOCK",
            "category": "Beverages",
            "subcategory": "Juices",
            "images": ["a.jpg"],
        }
    )
    assert product["price"] == Decimal("7.00")
    assert product["currency"] == "CAD"
    assert product["organic"] is True
    assert product["unit_quantity"] == Decimal("2")
    assert product["min_quantity"] == Decimal("0")
    assert product["max_quantity"] == Decimal("0")
    assert product["availability"] == "in_stock"


def test_negative_price_rejected():
    with pytest.raises(ValueError, match="negative price"):
        normalize_product({"sku": "x", "name": "N", "price": -5})


def test_invalid_availability_rejected():
    with pytest.raises(ValueError, match="invalid availability"):
        normalize_product({"sku": "x", "name": "N", "availability": "maybe"})


def test_missing_sku_rejected():
    with pytest.raises(ValueError, match="without sku/id"):
        normalize_product({"name": "N"})


def test_description_defaults_to_empty_with_source_none():
    product = normalize_product({"sku": "x", "name": "N"})
    assert product["description"] == ""
    assert product["description_source"] == "none"


def test_missing_category_subcategory_defaults():
    product = normalize_product({"sku": "x", "name": "N"})
    assert product["category"] == "Uncategorized"
    assert product["subcategory"] == "Other"


def test_catalog_stats_detect_slug_collisions():
    groups = [
        {
            "category": "Snacks",
            "subcategory": "Chips",
            "products": [{"sku": "1", "name": "Chips!"}, {"sku": "2", "name": "Chips ?"}],
        }
    ]
    products, stats = normalize_file(groups)
    assert stats["product_count"] == 2
    assert stats["slug_collisions"]["chips"] == 2
    assert len(products) == 2 and products[0]["sku"] != products[1]["sku"]


def test_slug_collisions_resolved_deterministically():
    groups = [
        {
            "category": "Coffee",
            "subcategory": "Ground",
            "products": [
                {"sku": "1", "name": "Kicking Horse Coffee 284 g"},
                {"sku": "2", "name": "Kicking Horse Coffee 284 g"},
                {"sku": "3", "name": "Kicking Horse Coffee 284 g"},
            ],
        }
    ]
    products, stats = normalize_file(groups)
    slugs = [p["slug"] for p in products]
    assert len(set(slugs)) == 3, slugs
    assert stats["slug_collisions"]["kicking-horse-coffee-284-g"] == 3
    # deterministic: same input, same assignment across calls
    again, _ = normalize_file(groups)
    assert [p["slug"] for p in sorted(again, key=lambda p: p["sku"])] == [
        p["slug"] for p in sorted(products, key=lambda p: p["sku"])
    ]


def test_a_clean_slug_is_never_reused_by_a_suffix():
    groups = [
        {
            "category": "Snacks",
            "subcategory": "Chips",
            "products": [
                {"sku": "1", "name": "Chips!"},
                {"sku": "2", "name": "Chips ?"},
                {"sku": "3", "name": "Chips - 2"},
            ],
        }
    ]
    products, _ = normalize_file(groups)
    assert len({p["slug"] for p in products}) == 3