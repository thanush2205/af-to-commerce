"""
Central configuration for the ingestion pipeline.

Everything is driven by environment variables (`.env` at repo root), matching
the convention used by the scraper and Elasticsearch tooling. In the Docker
Compose stack these values are pinned to the internal service hostnames; on a
developer machine they fall back to sensible localhost defaults.
"""

import os
from pathlib import Path

DAGSTER_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[2]


def _env(key: str, default: str) -> str:
    value = os.environ.get(key)
    return value if value not in (None, "") else default


def products_json_path() -> str:
    """Path to the scraper output. Overridable for the container mount."""
    return _env("PRODUCTS_JSON_PATH", str(REPO_ROOT / "scraper" / "output" / "products.json"))


def normalized_output_path() -> str:
    """Where this pipeline writes the normalized artifact (for inspection/reuse)."""
    return _env("NORMALIZED_OUTPUT_PATH", str(DAGSTER_DIR / "output" / "products_normalized.json"))


def database_url() -> str:
    return _env("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/afcommerce")


def elasticsearch_url() -> str:
    url = _env("ELASTICSEARCH_URL", "http://localhost:9200")
    # On some hosts `localhost` resolves to ::1 first while Elasticsearch only
    # binds IPv4, which makes the client hang until timeout. Pin the loopback
    # to IPv4 when the URL is literally localhost.
    return url.replace("//localhost:", "//127.0.0.1:")


def elasticsearch_index() -> str:
    return _env("ELASTICSEARCH_INDEX", "products")


def elasticsearch_api_key() -> str | None:
    key = os.environ.get("ELASTICSEARCH_API_KEY")
    return key if key else None


def elasticsearch_mapping_path() -> str:
    """Existing index mapping from the Search section (single source of truth for the schema)."""
    return _env("ES_MAPPING_PATH", str(REPO_ROOT / "elasticsearch" / "mappings" / "product.index.json"))