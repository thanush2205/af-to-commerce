import { config } from "./config.js";
import { getJson } from "./http.js";

function apiHeaders() {
  const headers = { apikey: config.api.key };
  if (config.api.location) headers.location = config.api.location;
  if (config.api.pricelist) headers.pricelist = config.api.pricelist;
  return headers;
}

/**
 * The Summerhill storefront is backed by the Homesome partner API
 * (https://user-api.gethomesome.com) with a public `apikey` header that the
 * site itself embeds in every page.
 *
 * `GET /product/list?listType=ui` returns the FULL catalog in a single
 * response (no pagination pageSize/next token exists on the source).
 */

export async function fetchCatalog() {
  const url = new URL("/product/list", config.api.baseUrl);
  url.searchParams.set("listType", config.data.catalogListType);

  return getJson(url.toString(), {
    headers: apiHeaders(),
    label: "product/list",
  });
}

export async function fetchLocations() {
  const url = new URL("/locations", config.api.baseUrl);
  return getJson(url.toString(), {
    headers: apiHeaders(),
    label: "locations",
  });
}

export async function fetchProductDetail(name) {
  const url = new URL("/product", config.api.baseUrl);
  url.searchParams.set("name", name);
  return getJson(url.toString(), {
    headers: apiHeaders(),
    label: `product/${name}`,
  });
}