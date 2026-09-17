import Link from 'next/link'
import { formatPrice, type ApiProduct } from '@/lib/api'

export function ProductCard({ product }: { product: ApiProduct }) {
  const { thumbnail, mainImage } = product
  const image = thumbnail || mainImage

  return (
    <Link href={`/products/${product.slug}`} className="card group">
      <div className="aspect-square w-full overflow-hidden bg-gray-100">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt={product.name}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
            {product.name}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        {product.category?.name && (
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
            {product.category.name}
          </p>
        )}
        <h3 className="line-clamp-2 text-sm font-semibold text-gray-900">
          {product.name}
        </h3>
        <p className="mt-auto pt-2 text-base font-bold text-leaf">
          {formatPrice(product.price, product.currency)}
          {product.availability === 'out_of_stock' && (
            <span className="ml-2 text-xs font-medium text-gray-400">
              Out of stock
            </span>
          )}
        </p>
      </div>
    </Link>
  )
}