"""Dagster code location entry point.

Discovered by dagster-webserver / dagster daemon via workspace.yaml.
"""

from src.assets import (
    catalog_ingestion_job,
    catalog_ingestion_schedule,
    defs,
    elasticsearch_products,
    normalized_products,
    postgres_products,
    raw_products,
)

__all__ = [
    "defs",
    "raw_products",
    "normalized_products",
    "postgres_products",
    "elasticsearch_products",
    "catalog_ingestion_job",
    "catalog_ingestion_schedule",
]