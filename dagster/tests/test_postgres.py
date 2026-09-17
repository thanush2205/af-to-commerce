"""
Contract tests for the Postgres loader's SQL.

These pin the idempotency guarantee the assessment requires (safe reruns):
every upsert in the ingestion must be guarded by ON CONFLICT on its natural key,
so a second Dagster run updates rows instead of inserting duplicates.
"""

from src.postgres import (
    CATEGORY_UPSERT,
    DELETE_ORPHAN_IMAGES,
    IMAGE_UPSERT,
    PRODUCT_UPSERT,
    SUBCATEGORY_UPSERT,
)


def test_category_upsert_on_slug():
    assert "ON CONFLICT (slug)" in CATEGORY_UPSERT
    assert "DO UPDATE SET" in CATEGORY_UPSERT


def test_subcategory_upsert_on_category_and_slug():
    assert "ON CONFLICT ON CONSTRAINT subcategories_category_slug_key" in SUBCATEGORY_UPSERT


def test_product_upsert_on_sku():
    assert "ON CONFLICT (sku)" in PRODUCT_UPSERT
    assert "DO UPDATE SET" in PRODUCT_UPSERT
    assert "RETURNING id, sku" in PRODUCT_UPSERT


def test_image_upsert_on_product_and_url():
    assert "ON CONFLICT (product_id, image_url)" in IMAGE_UPSERT
    assert "DO NOTHING" in IMAGE_UPSERT


def test_orphan_images_cleaned_up():
    assert "DELETE FROM product_images" in DELETE_ORPHAN_IMAGES
    assert "keep_urls" in DELETE_ORPHAN_IMAGES