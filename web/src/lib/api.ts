/**
 * Thin client for the Section 6 Node API (http://api:8000 in compose).
 *
 * `API_URL` is the server-side base (inside the compose network we use the
 * container hostname). `PUBLIC_API_URL` is what the browser should call when a
 * client component needs to reach the API directly (e.g. checkout).
 */

// Server-side fetches must use the internal host; NEXT_PUBLIC_* would leak the
// container name to the browser.
const API_URL = process.env.API_URL || 'http://localhost:8000'
export const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

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

/** Client-component HTTP POST (browser -> public API host). */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${PUBLIC_API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
  } catch {
    throw new Error(`API unreachable at ${PUBLIC_API_URL}${path}`)
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

/** Server-side HTTP POST (server -> internal API host, e.g. compose network). */
export async function apiPostServer<T>(path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
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

export interface CheckoutRequestItem {
  sku: string
  quantity: number
}

export interface CheckoutSessionResponse {
  sessionId: string
  url: string
  amountTotal: number
  currency: string
}

export interface SessionDetail {
  id: string
  status: string
  paymentStatus: string
  amountTotal: number | null
  currency: string | null
  customerEmail: string | null
  metadata: Record<string, string>
  lineItems: { name: string; quantity: number; amountTotal: number }[]
}

export interface ApiMerchant {
  id: number
  name: string
  email: string
  stripeAccountId: string | null
  status: string
  storedStatus: string
  statusReason: string | null
  createdAt: string
  updatedAt: string
}

export interface OrderSplit {
  total: number
  rate: number
  platformFee: number
  merchantShare: number
}

export interface OrderDetail {
  order: {
    id: number
    stripeSessionId: string
    stripePaymentIntentId: string | null
    merchantId: number | null
    amountTotal: string
    currency: string
    status: string
  }
  amountMinor: number
  split: OrderSplit
  paymentIntent: {
    id: string
    status: string
    amount: number
    currency: string
    applicationFeeAmount: number | null
    onBehalfOf: string | null
    transferData: unknown
  } | null
  transfer: { id: string; amount: number; destination: string } | null
  balances: { platform: number | null; merchant: number | null }
}

export function formatPrice(price: number, currency: string): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: currency || 'CAD',
  }).format(price)
}