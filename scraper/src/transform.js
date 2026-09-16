import { config } from "./config.js";

function fullImageUrl(mainImage) {
  if (!mainImage) return null;
  const { baseUrl } = config.image;
  return `${baseUrl}/productimages/${mainImage}.jpg`;
}

function thumbnailUrl(mainImage) {
  if (!mainImage) return null;
  const { baseUrl } = config.image;
  return `${baseUrl}/productimages_tn/${mainImage}.jpg`;
}

/**
 * Availability is derived from the source flags:
 *  - isInStock=false or availableToOrder=false  -> out_of_stock
 *  - a populated reasonUnavailable              -> unavailable
 *  - otherwise                                  -> in_stock
 */
export function availabilityOf(product) {
  if (product.isInStock === false || product.availableToOrder === false) {
    return "out_of_stock";
  }
  if (product.reasonUnavailable) {
    return "unavailable";
  }
  return "in_stock";
}

/**
 * The source API exposes no free-form product description anywhere (catalog,
 * detail endpoint, PDP page, or embed app). The closest real descriptive text
 * fields are `disclaimer` and (on the detail endpoint) `ingredients`. To avoid
 * fabricating data we map `description` to the available real text and record
 * its provenance in `descriptionSource` so downstream consumers can tell
 * generated vs. source-authored text apart.
 */
export function descriptionOf(product) {
  const disclaimer = (product.disclaimer ?? "").trim();
  if (disclaimer) {
    return { description: disclaimer, descriptionSource: "disclaimer" };
  }
  return { description: "", descriptionSource: "none" };
}

export function toProduct(raw) {
  const availability = availabilityOf(raw);
  const { description, descriptionSource } = descriptionOf(raw);

  const images = [];
  const full = fullImageUrl(raw.mainImage);
  if (full) images.push(full);
  const thumb = thumbnailUrl(raw.mainImage);
  if (thumb) images.push(thumb);

  return {
    id: raw.upc ?? raw.name,
    name: raw.displayName ?? raw.name,
    description,
    price: raw.price,
    currency: config.data.currency,
    sku: raw.upc ?? raw.name,
    brand: raw.brand ?? null,
    organic: raw.organic ?? false,
    unit: raw.unit ?? null,
    unitQuantity: raw.unitQuantity ?? null,
    minQuantity: raw.minQuantity ?? 0,
    maxQuantity: raw.maxQuantity ?? 0,
    availability,
    images,
    mainImage: full,
    thumbnail: thumb,
    category: raw.type ?? null,
    subcategory: raw.subType ?? null,
    descriptionSource,
  };
}

/**
 * Group products into the assessment output shape:
 * [ { category, subcategory, products: [...] } ]
 */
export function groupByCategoryAndSubcategory(products) {
  const groups = new Map();

  for (const product of products) {
    const category = product.category ?? "Uncategorized";
    const subcategory = product.subcategory ?? "Other";

    const key = `${category}\u0000${subcategory}`;
    let group = groups.get(key);
    if (!group) {
      group = { category, subcategory, products: [] };
      groups.set(key, group);
    }
    group.products.push(product);
  }

  return [...groups.values()]
    .sort((a, b) => a.category.localeCompare(b.category) || a.subcategory.localeCompare(b.subcategory))
    .map((g) => ({ ...g, products: sortByPrice(g.products) }));
}

function sortByPrice(products) {
  return [...products].sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
}

export function summarize(products, groups, run) {
  const hasImages = products.filter((p) => p.images.length > 0).length;
  const inStock = products.filter((p) => p.availability === "in_stock").length;
  const withDescription = products.filter((p) => p.description).length;

  return {
    run,
    source: "https://user-api.gethomesome.com/product/list?listType=ui",
    productCount: products.length,
    categoryGroups: groups.length,
    categories: new Set(products.map((p) => p.category)).size,
    subcategories: new Set(products.map((p) => `${p.category}|${p.subcategory}`)).size,
    inStock,
    outOfStock: products.length - inStock,
    withImages: hasImages,
    withoutImages: products.length - hasImages,
    withDescription,
    withoutDescription: products.length - withDescription,
    currency: config.data.currency,
  };
}