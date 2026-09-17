"""
Asset definitions for the offline catalog ingestion.

Pipeline shaped like the assignment:

    read products.json  ->  transform/normalize  ->  upsert PostgreSQL  ->  index Elasticsearch

    raw_products            normalized_products        postgres_products       elasticsearch_products

Failure semantics:
  * postgres_products runs in one transaction — any statement failure rolls the
    whole batch back and fails the op.
  * elasticsearch_products depends on postgres_products (Postgres stays the
    source of truth) and raises on bulk errors, so "Elasticsearch ingestion
    failed" fails the operation instead of silently succeeding.
  * Both write paths are idempotent: reruns upsert on natural keys / `_id = sku`.
"""

import json
import os
import time

from dagster import (
    AssetIn,
    AssetSelection,
    Definitions,
    MaterializeResult,
    MetadataValue,
    Output,
    asset,
    define_asset_job,
    DefaultScheduleStatus,
    ScheduleDefinition,
)

from src.config import (
    database_url,
    elasticsearch_api_key,
    elasticsearch_index,
    elasticsearch_url,
    normalized_output_path,
    products_json_path,
)
from src.elasticsearch_loader import upsert_products
from src.normalize import normalize_file
from src.postgres import upsert_catalog

GROUP = "catalog_ingestion"


@asset(group_name=GROUP)
def raw_products(context) -> Output:
    """External artifact produced by the scraper — the pipeline's raw input."""
    path = products_json_path()
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"products.json not found at {path}. Run the scraper first (cd scraper && npm run scrape)."
        )
    with open(path, encoding="utf-8") as handle:
        groups = json.load(handle)

    count = sum(len(group.get("products") or []) for group in groups)
    context.log.info(
        "raw_products: read %d category/subcategory groups, %d products from %s",
        len(groups),
        count,
        path,
    )
    return Output(
        groups,
        metadata={
            "groups": len(groups),
            "products": count,
            "source": MetadataValue.path(path),
        },
    )


@asset(
    group_name=GROUP,
    ins={"raw_groups": AssetIn("raw_products")},
)
def normalized_products(context, raw_groups) -> Output:
    """Transform step: flatten grouped JSON and coerce every field to the
    canonical shape shared by Postgres and Elasticsearch."""
    products, stats = normalize_file(raw_groups)

    os.makedirs(os.path.dirname(normalized_output_path()), exist_ok=True)
    with open(normalized_output_path(), "w", encoding="utf-8") as handle:
        json.dump(products, handle, ensure_ascii=False, default=str, indent=2)

    if stats["slug_collisions"]:
        top = list(stats["slug_collisions"].items())[:5]
        context.log.warning(
            "normalized_products: %d slug collisions resolved with numeric suffixes: %s",
            len(stats["slug_collisions"]),
            top,
        )

    context.log.info(
        "normalized_products: transformed %d products across %d categories / %d subcategories",
        stats["product_count"],
        stats["category_count"],
        stats["subcategory_count"],
    )
    return Output(
        products,
        metadata={
            "product_count": stats["product_count"],
            "category_count": stats["category_count"],
            "subcategory_count": stats["subcategory_count"],
            "slug_collisions": len(stats["slug_collisions"]),
            "artifact": MetadataValue.path(normalized_output_path()),
        },
    )


@asset(
    group_name=GROUP,
    ins={"products": AssetIn("normalized_products")},
)
def postgres_products(context, products) -> MaterializeResult:
    """Upsert the catalog into PostgreSQL (source of truth). Idempotent via
    natural-key ON CONFLICT upserts inside a single transaction."""
    started = time.time()
    counts = upsert_catalog(database_url(), products)
    duration = time.time() - started

    context.log.info(
        "postgres_products: ingestion completed — categories upserted=%d, subcategories=%d, "
        "products=%d, images=%d in %.2fs",
        counts["categories"],
        counts["subcategories"],
        counts["products"],
        counts["images"],
        duration,
    )
    return MaterializeResult(
        metadata={
            "categories": counts["categories"],
            "subcategories": counts["subcategories"],
            "products": counts["products"],
            "images": counts["images"],
            "duration_seconds": round(duration, 3),
        }
    )


@asset(
    group_name=GROUP,
    ins={"products": AssetIn("normalized_products")},
    deps=[postgres_products],  # Postgres is the source of truth; index only after it succeeds
)
def elasticsearch_products(context, products) -> MaterializeResult:
    """Bulk-upsert documents into Elasticsearch (derived search index).
    `_id = sku`, so reruns update in place and never duplicate."""
    started = time.time()
    result = upsert_products(
        elasticsearch_url(),
        elasticsearch_index(),
        products,
        api_key=elasticsearch_api_key(),
    )
    duration = time.time() - started

    context.log.info(
        "elasticsearch_products: ingestion completed — indexed=%d, index total=%d, "
        "batches=%d in %.2fs",
        result["indexed"],
        result["total_docs"],
        result["batches"],
        duration,
    )
    return MaterializeResult(
        metadata={
            "indexed": result["indexed"],
            "total_docs": result["total_docs"],
            "batches": result["batches"],
            "index": elasticsearch_index(),
            "duration_seconds": round(duration, 3),
        }
    )


catalog_ingestion_job = define_asset_job(
    name="catalog_ingestion",
    selection=AssetSelection.groups(GROUP),
)

# Every night at 03:00. Registered stopped by default so the live stack doesn't
# run the pipeline unprompted; start it in the Dagster UI when you want it.
catalog_ingestion_schedule = ScheduleDefinition(
    job=catalog_ingestion_job,
    cron_schedule="0 3 * * *",
    default_status=DefaultScheduleStatus.STOPPED,
)


defs = Definitions(
    assets=[raw_products, normalized_products, postgres_products, elasticsearch_products],
    jobs=[catalog_ingestion_job],
    schedules=[catalog_ingestion_schedule],
)