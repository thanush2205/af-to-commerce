import Link from 'next/link'
import { getPayloadClient } from '@/lib/payload'
import { CategoryCard } from '@/components/CategoryCard'
import { ProductCard } from '@/components/ProductCard'
import type { ApiProduct } from '@/lib/api'

export const dynamic = 'force-dynamic'

interface HeroGlobal {
  headline?: string
  subheadline?: string
  imageUrl?: string
  ctaLabel?: string
  ctaHref?: string
}

interface FeaturedDoc {
  id: number
  title: string
  slug: string
  price?: number
  currency?: string
  image?: string
  category?: { id: number; name?: string; slug?: string } | number | null
  stockStatus?: string
}

function toApiProduct(doc: FeaturedDoc): ApiProduct {
  const category =
    doc.category && typeof doc.category === 'object'
      ? {
          name: doc.category.name ?? '',
          slug: doc.category.slug ?? '',
        }
      : { name: '', slug: '' }
  return {
    id: doc.id,
    sku: '',
    slug: doc.slug,
    name: doc.title,
    description: '',
    price: doc.price ?? 0,
    currency: doc.currency || 'CAD',
    brand: null,
    organic: false,
    availability: doc.stockStatus === 'out_of_stock' ? 'out_of_stock' : 'in_stock',
    unit: null,
    mainImage: doc.image || null,
    thumbnail: doc.image || null,
    category,
    subcategory: { name: '', slug: '' },
  }
}

export default async function HomePage() {
  const payload = await getPayloadClient()

  const [heroResult, categoriesResult, featuredResult] = await Promise.all([
    payload.findGlobal({ slug: 'hero' }),
    payload.find({
      collection: 'categories',
      sort: 'name',
      limit: 100,
      depth: 0,
    }),
    payload.find({
      collection: 'products',
      where: { featured: { equals: true } },
      sort: 'title',
      limit: 8,
      depth: 1,
    }),
  ])

  const hero = (heroResult ?? {}) as HeroGlobal
  const categories = (categoriesResult?.docs ?? []) as {
    id: number
    name: string
    slug: string
    icon?: string | null
  }[]
  const featured = ((featuredResult?.docs ?? []) as unknown as FeaturedDoc[]).map(toApiProduct)

  return (
    <div>
      {/* -------------------------------------------------------------
          HERO BANNER
          ------------------------------------------------------------- */}
      <section className="relative overflow-hidden bg-leaf-dark text-white">
        {hero.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={hero.imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-30"
          />
        )}
        <div className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:py-32">
          <h1 className="max-w-2xl text-4xl font-extrabold tracking-tight sm:text-5xl">
            {hero.headline || 'Everyday essentials, straight from Summerhill'}
          </h1>
          {hero.subheadline && (
            <p className="mt-4 max-w-xl text-lg text-white/85">
              {hero.subheadline}
            </p>
          )}
          <div className="mt-8">
            <Link
              href={hero.ctaHref || '/products'}
              className="inline-block rounded-full bg-white px-7 py-3 text-sm font-semibold text-leaf-dark shadow transition hover:bg-leaf-light"
            >
              {hero.ctaLabel || 'Shop now'}
            </Link>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------
          SHOP BY CATEGORY
          ------------------------------------------------------------- */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="mb-8 flex items-end justify-between">
          <h2 className="section-title">Shop by category</h2>
          <Link href="/products" className="btn-outline">
            View all
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {categories.map((category) => (
            <CategoryCard
              key={category.id}
              name={category.name}
              slug={category.slug}
              icon={category.icon}
            />
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------------
          FEATURED PRODUCTS
          ------------------------------------------------------------- */}
      <section className="border-t border-gray-200 bg-white py-14">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-8 flex items-end justify-between">
            <h2 className="section-title">Featured products</h2>
            <Link href="/products" className="btn-outline">
              Browse all
            </Link>
          </div>
          {featured.length === 0 ? (
            <p className="text-sm text-gray-500">
              No featured products yet — mark a few products as &ldquo;Featured
              on homepage&rdquo; in the{' '}
              <a className="text-leaf underline" href="/admin">
                Admin
              </a>{' '}
              panel, then refresh.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
              {featured.map((product) => (
                <ProductCard key={product.slug} product={product} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}