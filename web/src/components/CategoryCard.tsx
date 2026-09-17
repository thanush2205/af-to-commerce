import Link from 'next/link'

export interface CategoryCardData {
  name: string
  slug: string
  icon?: string | null
  productCount?: number
}

export function CategoryCard({ name, slug, icon, productCount }: CategoryCardData) {
  return (
    <Link
      href={`/products?category=${encodeURIComponent(slug)}`}
      className="card group items-center gap-3 p-5 text-center"
    >
      <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-leaf-light">
        {icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={icon}
            alt={name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="text-xl font-bold text-leaf-dark">
            {name.charAt(0)}
          </span>
        )}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-gray-900 group-hover:text-leaf">
          {name}
        </h3>
        {typeof productCount === 'number' && (
          <p className="mt-1 text-xs text-gray-400">{productCount} products</p>
        )}
      </div>
    </Link>
  )
}