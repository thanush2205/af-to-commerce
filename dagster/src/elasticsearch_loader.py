"""
Elasticsearch loader — the derived search index write path.

Downstream of Postgres (source of truth). Documents are upserted with
`_id = sku`, matching the Search section's `index-products.js` and the
idempotency invariant: a re-run updates in place and never duplicates.

Bulk errors raise, so a failed index job fails the Dagster operation instead of
silently reporting success.
"""

import json

from elasticsearch import Elasticsearch
from elasticsearch.helpers import bulk

from .config import elasticsearch_mapping_path

BULK_CHUNK = 500


def _as_document(product: dict) -> dict:
    """Map a normalized record to the Search-section document shape."""
    return {
        "id": product["id"],
        "sku": product["sku"],
        "slug": product["slug"],
        "name": product["name"],
        "description": product["description"],
        "brand": product["brand"],
        "price": float(product["price"]),
        "currency": product["currency"],
        "category": product["category"],
        "subcategory": product["subcategory"],
        "availability": product["availability"],
        "organic": product["organic"],
        "descriptionSource": product["description_source"],
        "unit": product["unit"],
        "unitQuantity": float(product["unit_quantity"]) if product["unit_quantity"] is not None else None,
        "minQuantity": float(product["min_quantity"]),
        "maxQuantity": float(product["max_quantity"]),
        "images": product["images"],
        "mainImage": product["main_image"],
        "thumbnail": product["thumbnail"],
    }


def _actions(products: list[dict], index: str):
    for product in products:
        doc = _as_document(product)
        yield {"_op_type": "index", "_index": index, "_id": doc["sku"], "_source": doc}


def _ensure_index(client: Elasticsearch, index: str) -> None:
    if client.indices.exists(index=index):
        return
    with open(elasticsearch_mapping_path(), encoding="utf-8") as handle:
        mapping = json.load(handle)
    client.indices.create(index=index, body=mapping)


def upsert_products(url: str, index: str, products: list[dict], api_key: str | None = None) -> dict:
    """Bulk-upsert all products into the search index; raises on any failure."""
    client = Elasticsearch(
        url,
        api_key=api_key,
        request_timeout=60,
        max_retries=2,
        retry_on_timeout=True,
    )
    try:
        _ensure_index(client, index)

        if not products:
            return {"indexed": 0, "batches": 0, "total_docs": 0}

        actions = _actions(products, index)
        succeeded, failed_items = bulk(
            client,
            actions,
            chunk_size=BULK_CHUNK,
            refresh=False,
            raise_on_error=True,
            raise_on_exception=True,
        )
        if failed_items:
            sample = failed_items[0].get("index", {}).get("error", "unknown error")
            raise RuntimeError(f"elasticsearch bulk ingest failed: {sample}")

        total = client.count(index=index)["count"]
        return {"indexed": succeeded, "batches": (succeeded + BULK_CHUNK - 1) // BULK_CHUNK, "total_docs": total}
    finally:
        client.close()