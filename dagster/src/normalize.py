"""
Pure transformation layer: flattens the grouped scraper output
([{category, subcategory, products}] → flat normalized products) and coerces
every field to the shape expected by the Postgres schema and the
Elasticsearch mapping.

Kept free of I/O and service imports so it unit-tests quickly and stays the
single source of truth for field mapping.
"""

import re
import unicodedata
from collections import Counter
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

VALID_AVAILABILITY = {"in_stock", "out_of_stock", "unavailable"}
ZERO = Decimal("0")


def slugify(text: str) -> str:
    """Deterministic slug, mirrors the JS version used by the scraper/ES tooling."""
    s = unicodedata.normalize("NFKD", str(text or ""))
    s = s.replace("æ", "ae").replace("Æ", "AE").replace("ø", "o").replace("Ø", "O")
    s = s.replace("&", " and ")
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"^-+|-+$", "", s)
    return s[:130]


def _money(value) -> Decimal:
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        amount = ZERO
    amount = amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if amount < ZERO:
        raise ValueError(f"negative price not allowed: {value}")
    return amount


def _number(value, default=ZERO) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal(str(default))


def _nullable_number(value) -> Decimal | None:
    if value in (None, ""):
        return None
    return Decimal(str(value))


def _availability(value) -> str:
    availability = (value or "in_stock").strip().lower()
    if availability not in VALID_AVAILABILITY:
        raise ValueError(
            f"invalid availability '{value}' (allowed: {', '.join(sorted(VALID_AVAILABILITY))})"
        )
    return availability


def _dedupe_slugs(products: list[dict]) -> list[dict]:
    """Make slugs unique in a deterministic way.

    The catalog occasionally contains two products whose names normalize to the
    same slug (identical names). Postgres enforces `products.slug` unique, so
    collisions must be resolved here. Processing order is sorted by sku, and
    victims get a stable numeric suffix (slug-2, slug-3, …), lopping the base
    only when needed — re-runs therefore always assign the same slugs.
    """
    used: set[str] = set()
    for product in sorted(products, key=lambda p: (p["sku"], p["name"])):
        slug = product["slug"]
        if slug not in used:
            used.add(slug)
            continue
        n = 2
        while True:
            candidate = f"{slug[:120]}-{n}"
            if candidate not in used:
                used.add(candidate)
                product["slug"] = candidate[:130]
                break
            n += 1
    return products


def normalize_product(product: dict) -> dict:
    """Normalize one raw source product into the canonical ingestion record."""
    sku = str(product.get("sku") or product.get("id") or "").strip()
    if not sku:
        raise ValueError(f"product without sku/id: {product.get('name')!r}")
    name = (product.get("name") or "").strip() or "Untitled"

    return {
        "id": str(product.get("id") or sku),
        "sku": sku,
        "name": name,
        "slug": slugify(name),
        "description": (product.get("description") or "").strip(),
        "description_source": (product.get("descriptionSource") or "none").strip() or "none",
        "price": _money(product.get("price")),
        "currency": (product.get("currency") or "CAD").strip().upper() or "CAD",
        "brand": product.get("brand") or None,
        "organic": bool(product.get("organic")),
        "unit": product.get("unit") or None,
        "unit_quantity": _nullable_number(product.get("unitQuantity")),
        "min_quantity": _number(product.get("minQuantity")),
        "max_quantity": _number(product.get("maxQuantity")),
        "availability": _availability(product.get("availability")),
        "category": (product.get("category") or "Uncategorized").strip() or "Uncategorized",
        "subcategory": (product.get("subcategory") or "Other").strip() or "Other",
        "images": list(product.get("images") or []),
        "main_image": product.get("mainImage") or None,
        "thumbnail": product.get("thumbnail") or None,
    }


def normalize_groups(groups: list) -> list[dict]:
    """Flatten grouped scraper output ([{category, subcategory, products}]) to products."""
    normalized = []
    for group in groups or []:
        for product in group.get("products") or []:
            normalized.append(normalize_product(product))
    return _dedupe_slugs(normalized)


def normalize_file(groups: list) -> tuple[list[dict], dict]:
    """Normalize a full scraper file and produce run-level statistics."""
    products = normalize_groups(groups)
    raw_slug_counts = Counter(slugify(p["name"]) for p in products)
    slug_collisions = {slug: c for slug, c in raw_slug_counts.items() if c > 1}

    stats = {
        "product_count": len(products),
        "category_count": len({p["category"] for p in products}),
        "subcategory_count": len({(p["category"], p["subcategory"]) for p in products}),
        "sku_collisions": len(products) - len({p["sku"] for p in products}),
        "slug_collisions": slug_collisions,
        "invalid_entries": 0,
    }
    return products, stats