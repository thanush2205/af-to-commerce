import Link from 'next/link'
import { Suspense } from 'react'
import { apiGet, type ApiCategory, type ApiProduct, type Pagination } from '@/lib/api'
import { ProductCard } from '@/components/ProductCard'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Shop — Summerhill Market' }

interface SearchResponse {
  data: ApiProduct[]
  pagination: Pagination
}

const SORT_OPTIONS = [
  { label: 'Most relevant', value: 'relevance' },
  { label: 'Price: low to high', value: 'price_asc' },
  { label: 'Price: high to low', value: 'price_desc' },
  { label: 'Name A–Z', value: 'name_asc' },
]

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '')
}

function pageLink(opts: { q: string; category: string; sort: string; page: number }): string {
  const params = new URLSearchParams()
  if (opts.q) params.set('q', opts.q)
  if (opts.category) params.set('category', opts.category)
  if (opts.sort && opts.sort !== 'relevance') params.set('sort', opts.sort)
  if (opts.page > 1) params.set('page', String(opts.page))
  const qs = params.toString()
  return qs ? `/products?${qs}` : '/products'
}

async function load(
  q: string,
  category: string,
  sort: string,
  page: number,
): Promise<SearchResponse> {
  const params = new URLSearchParams({ page: String(page), limit: '24' })
  if (q) params.set('q', q)
  if (category) params.set('category', category)
  if (sort && sort !== 'relevance') params.set('sort', sort)
  return apiGet<SearchResponse>(`/api/search?${params.toString()}`)
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>
}) {
  const sp = await searchParams
  const q = one(sp.q).trim()
  const category = one(sp.category)
  const sort = one(sp.sort) || 'relevance'
  const page = Math.max(1, parseInt(one(sp.page), 10) || 1)

  const [results, categoriesRes] = await Promise.all([
    load(q, category, sort, page),
    apiGet<{ data: ApiCategory[] }>('/api/categories?limit=100'),
  ])
  const categories = categoriesRes.data
  const { data: products, pagination } = results

  const activeCategory =
    categories.find((c) => c.slug === category || c.name === category) ?? null

  return (
    <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            {activeCategory ? activeCategory.name : q ? `Results for “${q}”` : 'Shop all products'}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {pagination.total.toLocaleString()} products
          </p>
        </div>
        <Link href="/products" className="btn-outline text-sm">
          Clear filters
        </Link>
      </header>

      {/* Filters (plain GET forms — no client JS required) */}
      <form method="get" action="/products" className="mb-8 grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
            Search
          </span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Try “chips” or “avocado”"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-leaf focus:outline-none focus:ring-1 focus:ring-leaf"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
            Category
          </span>
          <select
            name="category"
            defaultValue={category}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-leaf focus:outline-none focus:ring-1 focus:ring-leaf"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name} ({c.productCount})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
            Sort
          </span>
          <select
            name="sort"
            defaultValue={sort}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-leaf focus:outline-none focus:ring-1 focus:ring-leaf"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="sm:col-span-3">
          <button type="submit" className="btn-primary">
            Apply
          </button>
        </div>
      </form>

      {/* Category filter chips — [All] [Fruits] [Vegetables] … */}
      <div className="mb-8 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-medium uppercase tracking-wide text-gray-500">
          Category:
        </span>
        <Link
          href={pageLink({ q, category: '', sort, page: 1 })}
          className={
            !activeCategory
              ? 'rounded-full bg-leaf px-4 py-1.5 text-sm font-semibold text-white'
              : 'rounded-full border border-gray-300 px-4 py-1.5 text-sm text-gray-700 transition hover:border-leaf hover:text-leaf'
          }
        >
          All
        </Link>
        {categories.map((c) => (
          <Link
            key={c.id}
            href={pageLink({ q, category: c.slug, sort, page: 1 })}
            className={
              activeCategory?.slug === c.slug
                ? 'rounded-full bg-leaf px-4 py-1.5 text-sm font-semibold text-white'
                : 'rounded-full border border-gray-300 px-4 py-1.5 text-sm text-gray-700 transition hover:border-leaf hover:text-leaf'
            }
          >
            {c.name}
          </Link>
        ))}
      </div>

      {products.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500">
          No products match those filters.
        </p>
      ) : (
        <Suspense fallback={<p className="text-sm text-gray-400">Loading…</p>}>
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </Suspense>
      )}

      {/* Pagination */}
      {pagination.pages > 1 && (
        <nav className="mt-10 flex flex-wrap items-center justify-center gap-2">
          {pagination.page > 1 && (
            <Link
              href={pageLink({ q, category, sort, page: pagination.page - 1 })}
              className="btn-outline"
            >
              ‹ Prev
            </Link>
          )}
          {Array.from({ length: pagination.pages }, (_, i) => i + 1)
            .filter((p) => Math.abs(p - pagination.page) <= 2 || p === 1 || p === pagination.pages)
            .reduce<number[]>((acc, p) => {
              if (acc.length && p - acc[acc.length - 1] > 1) acc.push(-1)
              acc.push(p)
              return acc
            }, [])
            .map((p) =>
              p === -1 ? (
                <span key={`e${p}`} className="px-1 text-gray-400">
                  …
                </span>
              ) : (
                <Link
                  key={p}
                  href={pageLink({ q, category, sort, page: p })}
                  className={
                    p === pagination.page
                      ? 'inline-flex h-10 min-w-10 items-center justify-center rounded-full bg-leaf px-3 text-sm font-semibold text-white'
                      : 'btn-outline'
                  }
                >
                  {p}
                </Link>
              ),
            )}
          {pagination.page < pagination.pages && (
            <Link
              href={pageLink({ q, category, sort, page: pagination.page + 1 })}
              className="btn-outline"
            >
              Next ›
            </Link>
          )}
        </nav>
      )}
    </div>
  )
}