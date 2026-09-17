import Link from 'next/link'
import { notFound } from 'next/navigation'
import { apiGet, formatPrice, type ApiProduct } from '@/lib/api'

export const dynamic = 'force-dynamic'

interface DetailResponse {
  data: ApiProduct
}

const STOCK_BADGE: Record<ApiProduct['availability'], { label: string; className: string }> = {
  in_stock: { label: 'In stock', className: 'bg-leaf-light text-leaf-dark' },
  out_of_stock: { label: 'Out of stock', className: 'bg-red-50 text-red-700' },
  unavailable: { label: 'Unavailable', className: 'bg-gray-100 text-gray-600' },
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  let data: DetailResponse | null = null
  try {
    data = await apiGet<DetailResponse>(`/api/products/${encodeURIComponent(slug)}`)
  } catch {
    data = null
  }
  if (!data) notFound()

  const product = data.data
  const images = [
    product.mainImage,
    ...(product.images ?? []).map((img) => img.url),
  ].filter((url): url is string => Boolean(url))
  const badge = STOCK_BADGE[product.availability] ?? STOCK_BADGE.in_stock

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      {/* Breadcrumbs */}
      <nav className="mb-6 flex flex-wrap items-center gap-1.5 text-sm text-gray-500">
        <Link href="/" className="hover:text-leaf">
          Home
        </Link>
        <span>/</span>
        <Link href="/products" className="hover:text-leaf">
          Shop
        </Link>
        <span>/</span>
        {product.category.name && (
          <>
            <Link
              href={`/products?category=${encodeURIComponent(product.category.slug)}`}
              className="hover:text-leaf"
            >
              {product.category.name}
            </Link>
            <span>/</span>
          </>
        )}
        <span className="text-gray-800">{product.name}</span>
      </nav>

      <div className="grid gap-10 lg:grid-cols-2">
        {/* Gallery */}
        <div>
          {images.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {images.map((url, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`${url}-${i}`}
                  src={url}
                  alt={`${product.name} — image ${i + 1}`}
                  className="aspect-square w-full rounded-2xl border border-gray-200 object-cover"
                  loading={i === 0 ? 'eager' : 'lazy'}
                />
              ))}
            </div>
          ) : (
            <div className="flex aspect-square w-full items-center justify-center rounded-2xl border border-gray-200 bg-gray-100 text-gray-400">
              No image
            </div>
          )}
        </div>

        {/* Details */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
            {product.brand || product.category.name || 'AF-TO Commerce'}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            {product.name}
          </h1>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-2xl font-bold text-leaf">
              {formatPrice(product.price, product.currency)}
            </span>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.className}`}>
              {badge.label}
            </span>
            {product.organic && (
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                Certified organic
              </span>
            )}
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
            {product.unit && (
              <>
                <dt className="font-medium text-gray-500">Unit</dt>
                <dd>{product.unit}</dd>
              </>
            )}
            <dt className="font-medium text-gray-500">SKU</dt>
            <dd className="font-mono text-xs leading-5">{product.sku}</dd>
            {product.subcategory.name && (
              <>
                <dt className="font-medium text-gray-500">Type</dt>
                <dd className="capitalize">{product.subcategory.name}</dd>
              </>
            )}
            {product.availability !== 'in_stock' && (
              <>
                <dt className="font-medium text-gray-500">Availability</dt>
                <dd>{product.availability.replace(/_/g, ' ')}</dd>
              </>
            )}
          </dl>

          {product.description && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                Description
              </h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-6 text-gray-700">
                {product.description}
              </p>
            </div>
          )}

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={`/products?category=${encodeURIComponent(product.category.slug)}`}
              className="btn-outline"
            >
              More {product.category.name.toLowerCase()}
            </a>
            <Link href="/products" className="btn-primary">
              Continue shopping
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}