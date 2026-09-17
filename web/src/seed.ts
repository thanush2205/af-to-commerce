/* eslint-disable no-console */
/**
 * Seed the Payload CMS collections from the canonical catalog (Postgres),
 * reading it through the Section 6 Node API (internal http://api:8000).
 *
 * Run against the running stack:
 *   docker compose exec -T web npm run seed
 *
 * The Dagster pipeline must have been materialized first (products/categories
 * present in Postgres + Elasticsearch).
 */
import 'dotenv/config'
import { getPayload } from 'payload'
import config from './payload.config'

const API_URL = process.env.API_URL || 'http://localhost:8000'
const PAGE_SIZE = 250
const CONCURRENCY = 6
// Deterministic, pseudo-curated: ~every 126th product gets the "featured" flag
// so the homepage has a handful of rotated picks across categories.
const FEATURED_EVERY = 126

interface ApiProduct {
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
}

interface ApiCategory {
  id: number
  name: string
  slug: string
  imageUrl: string | null
}

let payload: Awaited<ReturnType<typeof getPayload>>

async function apiJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`)
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`)
  return res.json()
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  async function runOne() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index], index)
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () =>
    runOne(),
  )
  await Promise.all(workers)
  return results
}

async function ensureAdminUser(): Promise<void> {
  const existing = await payload.find({
    collection: 'users',
    limit: 1,
    depth: 0,
  })
  if (existing.totalDocs > 0) {
    console.log(`Admin user exists: ${existing.docs[0].email}`)
    return
  }
  const email = process.env.PAYLOAD_ADMIN_EMAIL || 'admin@summerhill.demo'
  const password = process.env.PAYLOAD_ADMIN_PASSWORD || 'admin1234'
  await payload.create({
    collection: 'users',
    data: { email, password, name: 'Store Admin' },
  })
  console.log(`Created admin user: ${email} / ${password}`)
}

async function seedCategories(): Promise<Map<string, number>> {
  const res = await apiJson<{ data: ApiCategory[] }>('/api/categories?limit=100')
  const slugToId = new Map<string, number>()
  for (const c of res.data) {
    const existing = await payload.find({
      collection: 'categories',
      where: { slug: { equals: c.slug } },
      limit: 1,
      depth: 0,
    })
    const data = {
      name: c.name,
      slug: c.slug,
      icon: c.imageUrl || undefined,
    }
    if (existing.totalDocs > 0) {
      await payload.update({
        collection: 'categories',
        id: existing.docs[0].id,
        data,
      })
    } else {
      const created = await payload.create({ collection: 'categories', data })
      slugToId.set(c.slug, created.id)
    }
    if (existing.totalDocs > 0) slugToId.set(c.slug, existing.docs[0].id)
    console.log(`Category ${c.slug} -> id ${slugToId.get(c.slug)}`)
  }
  return slugToId
}

async function seedProducts(categoryIds: Map<string, number>): Promise<void> {
  let upserted = 0
  let page = 1
  let pages = 1

  do {
    const res = await apiJson<{ data: ApiProduct[]; pagination: { pages: number } }>(
      `/api/products?page=${page}&limit=${PAGE_SIZE}`,
    )
    pages = res.pagination.pages

    await mapWithConcurrency(res.data, CONCURRENCY, async (p, index) => {
      const categoryId = categoryIds.get(p.category?.slug ?? '')
      const globalIndex = (page - 1) * PAGE_SIZE + index
      const data = {
        title: p.name,
        slug: p.slug,
        description: p.description || undefined,
        price: Number(p.price),
        currency: p.currency || 'CAD',
        image: p.mainImage || p.thumbnail || undefined,
        category: categoryId,
        stockStatus: p.availability,
        featured: globalIndex % FEATURED_EVERY === 0,
        sku: p.sku,
        brand: p.brand || undefined,
        unit: p.unit || undefined,
      }
      const existing = await payload.find({
        collection: 'products',
        where: { slug: { equals: p.slug } },
        limit: 1,
        depth: 0,
      })
      if (existing.totalDocs > 0) {
        await payload.update({
          collection: 'products',
          id: existing.docs[0].id,
          data,
        })
      } else {
        await payload.create({ collection: 'products', data })
      }
      upserted += 1
    })

    console.log(`Page ${page}/${pages} done (${upserted} products upserted so far)`)
    page += 1
  } while (page <= pages)

  console.log(`Products done (${upserted} upserted)`)
}

async function main(): Promise<void> {
  payload = await getPayload({ config })

  await ensureAdminUser()
  const categoryIds = await seedCategories()
  await seedProducts(categoryIds)

  console.log('Seed complete.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })