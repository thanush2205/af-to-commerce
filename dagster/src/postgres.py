"""
PostgreSQL loader — the source-of-truth write path.

Idempotency contract (matches database/migrations/up/001_create_catalog_schema.sql):
  * categories   upserted on `slug`
  * subcategories upserted on `(category_id, slug)`
  * products      upserted on `sku`
  * product_images upserted on `(product_id, image_url)`

Everything runs inside a single transaction: if any statement fails the whole
batch rolls back, so a partial ingestion can never be committed. A re-run of
this loader therefore updates rows in place and never duplicates.
"""

from typing import Iterator

import psycopg
from psycopg.rows import dict_row

from .normalize import slugify

#: Constant fragments extracted so the ingest contract can be unit-tested.
CATEGORY_UPSERT = """
    INSERT INTO categories (name, slug)
    VALUES (%(name)s, %(slug)s)
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
"""

SUBCATEGORY_UPSERT = """
    INSERT INTO subcategories (category_id, name, slug)
    VALUES (%(category_id)s, %(name)s, %(slug)s)
    ON CONFLICT ON CONSTRAINT subcategories_category_slug_key
    DO UPDATE SET name = EXCLUDED.name
    RETURNING id
"""

PRODUCT_UPSERT = """
    INSERT INTO products (
        name, slug, description, description_source, price, currency, sku,
        availability, brand, organic, unit, unit_quantity, min_quantity,
        max_quantity, main_image, thumbnail, category_id, subcategory_id
    )
    VALUES (
        %(name)s, %(slug)s, %(description)s, %(description_source)s, %(price)s,
        %(currency)s, %(sku)s, %(availability)s, %(brand)s, %(organic)s,
        %(unit)s, %(unit_quantity)s, %(min_quantity)s, %(max_quantity)s,
        %(main_image)s, %(thumbnail)s, %(category_id)s, %(subcategory_id)s
    )
    ON CONFLICT (sku) DO UPDATE SET
        name = EXCLUDED.name,
        slug = EXCLUDED.slug,
        description = EXCLUDED.description,
        description_source = EXCLUDED.description_source,
        price = EXCLUDED.price,
        currency = EXCLUDED.currency,
        availability = EXCLUDED.availability,
        brand = EXCLUDED.brand,
        organic = EXCLUDED.organic,
        unit = EXCLUDED.unit,
        unit_quantity = EXCLUDED.unit_quantity,
        min_quantity = EXCLUDED.min_quantity,
        max_quantity = EXCLUDED.max_quantity,
        main_image = EXCLUDED.main_image,
        thumbnail = EXCLUDED.thumbnail,
        category_id = EXCLUDED.category_id,
        subcategory_id = EXCLUDED.subcategory_id
    RETURNING id, sku
"""

IMAGE_UPSERT = """
    INSERT INTO product_images (product_id, image_url, position, kind)
    VALUES (%(product_id)s, %(image_url)s, %(position)s, %(kind)s)
    ON CONFLICT (product_id, image_url) DO NOTHING
"""

DELETE_ORPHAN_IMAGES = """
    DELETE FROM product_images
    WHERE product_id = %(product_id)s
      AND NOT (image_url = ANY(%(keep_urls)s::text[]))
"""


def _product_rows(products: list[dict], category_ids: dict, subcategory_ids: dict) -> Iterator[dict]:
    for product in products:
        yield {
            **product,
            "price": product["price"],
            "unit_quantity": product["unit_quantity"],
            "min_quantity": product["min_quantity"],
            "max_quantity": product["max_quantity"],
            "category_id": category_ids[product["category"]],
            "subcategory_id": subcategory_ids[(product["category"], product["subcategory"])],
        }


def upsert_catalog(dsn: str, products: list[dict]) -> dict:
    """Upsert the normalized catalog into Postgres inside one transaction."""
    if not products:
        return {"categories": 0, "subcategories": 0, "products": 0, "images": 0}

    # Seed every category/subcategory with a stable placeholder id so FK lookups
    # below are always satisfiable even for an empty pre-existing catalog.
    categories = sorted({p["category"] for p in products})
    subcategories = sorted({(p["category"], p["subcategory"]) for p in products})
    category_slugs = {name: slugify(str(name)) for name in categories}
    subcategory_slugs = {(c, s): slugify(str(s)) for (c, s) in subcategories}

    with psycopg.connect(dsn) as conn, conn.cursor(row_factory=dict_row) as cur:
        category_ids: dict[str, int] = {}
        for name in categories:
            row = cur.execute(
                CATEGORY_UPSERT, {"name": name, "slug": category_slugs[name]}
            ).fetchone()
            category_ids[name] = row["id"]

        subcategory_ids: dict[tuple[str, str], int] = {}
        for (category, subcategory) in subcategories:
            row = cur.execute(
                SUBCATEGORY_UPSERT,
                {
                    "category_id": category_ids[category],
                    "name": subcategory,
                    "slug": subcategory_slugs[(category, subcategory)],
                },
            ).fetchone()
            subcategory_ids[(category, subcategory)] = row["id"]

        product_ids: dict[str, int] = {}
        for row in _product_rows(products, category_ids, subcategory_ids):
            result = cur.execute(PRODUCT_UPSERT, row).fetchone()
            product_ids[row["sku"]] = result["id"]

        inserted_images = 0
        for product in products:
            product_id = product_ids[product["sku"]]
            keep = list(product["images"])
            for position, image_url in enumerate(keep):
                cur.execute(
                    IMAGE_UPSERT,
                    {
                        "product_id": product_id,
                        "image_url": image_url,
                        "position": position,
                        "kind": None,
                    },
                )
                inserted_images += 1
            cur.execute(DELETE_ORPHAN_IMAGES, {"product_id": product_id, "keep_urls": keep})

    return {
        "categories": len(categories),
        "subcategories": len(subcategories),
        "products": len(products),
        "images": inserted_images,
    }