/**
 * Thin client for the Section 6 Node API (http://api:8000 in compose).
 */

// Server-side fetches must use the internal host; NEXT_PUBLIC_* would leak the
// container name to the browser.
const API_URL = process.env.API_URL || 'http://localhost:8000'

export interface Pagination {
  total: number
  page: number
  limit: number
  pages: number
}

export interface ApiProduct {
  id: number
  sku: string
  slug: string
  name: string
  description: string
  price: number
  currency: string
  brand: string | null
  organic: boolean
  availability: 'in_stock' | 'out_of_stock' | 'unavailable'
  unit: string | null
  mainImage: string | null
  thumbnail: string | null
  category: { name: string; slug: string }
  subcategory: { name: string; slug: string }
  images?: { id: number; url: string; position: number; kind: string | null }[]
}

export interface ApiCategory {
  id: number
  name: string
  slug: string
  imageUrl: string | null
  subcategoryCount: number
  productCount: number
  subcategories: { id: number; name: string; slug: string; productCount: number }[]
}

export async function apiGet<T>(path: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, { cache: 'no-store' })
  } catch {
    throw new Error(`API unreachable at ${API_URL}${path}`)
  }
  if (!res.ok) {
    let detail = ''
    try {
      detail = JSON.stringify(await res.json())
    } catch {
      /* ignore */
    }
    throw new Error(`API ${res.status} for ${path}: ${detail}`)
  }
  return res.json() as Promise<T>
}

export function formatPrice(price: number, currency: string): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: currency || 'CAD',
  }).format(price)
}