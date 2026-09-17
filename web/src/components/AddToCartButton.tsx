'use client'

import { useState } from 'react'
import { useCart } from '@/context/CartContext'
import type { ApiProduct } from '@/lib/api'

export function AddToCartButton({ product }: { product: ApiProduct }) {
  const { addItem } = useCart()
  const [added, setAdded] = useState(false)

  const available = product.availability === 'in_stock'

  function handleAdd() {
    if (!available) return
    addItem({
      sku: product.sku,
      slug: product.slug,
      name: product.name,
      price: product.price,
      currency: product.currency || 'CAD',
      image: product.mainImage || product.thumbnail,
    })
    setAdded(true)
    window.setTimeout(() => setAdded(false), 1500)
  }

  return (
    <button
      type="button"
      onClick={handleAdd}
      disabled={!available}
      className={
        'btn-primary inline-flex min-w-44 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:hover:bg-gray-300 ' +
        (added ? '!bg-leaf-dark' : '')
      }
    >
      {added ? (
        <>
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z"
              clipRule="evenodd"
            />
          </svg>
          Added to cart
        </>
      ) : (
        <>
          <svg
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="8" cy="17" r="1.25" />
            <circle cx="15.5" cy="17" r="1.25" />
            <path d="M1.5 2.5h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h7.6a1.5 1.5 0 0 0 1.5-1.2l1.4-6.7H5" />
          </svg>
          Add to Cart
        </>
      )}
    </button>
  )
}