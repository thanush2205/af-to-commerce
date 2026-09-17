'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useCart, type CartItem } from '@/context/CartContext'
import { formatPrice } from '@/lib/api'

export default function CheckoutPage() {
  const { items, clearCart, totalPrice } = useCart()
  const [placed, setPlaced] = useState(false)

  const currency = useMemo(() => items[0]?.currency || 'CAD', [items])

  if (placed) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-leaf-light">
          <svg
            className="h-8 w-8 text-leaf"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-gray-900">
          Order confirmed
        </h1>
        <p className="mt-3 text-sm leading-6 text-gray-500">
          Thanks for your order. A confirmation has been sent to your email and your
          basket has been cleared. (Payment processing is wired up in the Stripe
          section.)
        </p>
        <Link href="/products" className="btn-primary mt-8 inline-block">
          Continue shopping
        </Link>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
        <h1 className="text-2xl font-bold text-gray-900">Nothing to check out</h1>
        <p className="mt-2 text-sm text-gray-500">
          Your cart is empty. Add some products first.
        </p>
        <Link href="/products" className="btn-primary mt-6 inline-block">
          Browse products
        </Link>
      </div>
    )
  }

  function placeOrder() {
    setPlaced(true)
    clearCart()
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="mb-8 text-3xl font-bold tracking-tight text-gray-900">Checkout</h1>

      <div className="grid gap-8 md:grid-cols-2">
        <section className="rounded-2xl border border-gray-200 bg-white p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Your items
          </h2>
          <ul className="mt-4 space-y-3">
            {items.map((item: CartItem) => (
              <li key={item.sku} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate text-gray-700">
                  {item.quantity} × {item.name}
                </span>
                <span className="shrink-0 font-medium text-gray-900">
                  {formatPrice(item.price * item.quantity, item.currency)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="h-fit rounded-2xl border border-gray-200 bg-white p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Summary
          </h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Subtotal</dt>
              <dd className="font-medium text-gray-900">{formatPrice(totalPrice, currency)}</dd>
            </div>
          </dl>
          <div className="mt-4 border-t border-gray-200 pt-4">
            <div className="flex justify-between">
              <span className="text-sm font-semibold text-gray-900">Total</span>
              <span className="text-lg font-bold text-leaf">{formatPrice(totalPrice, currency)}</span>
            </div>
          </div>
          <button type="button" onClick={placeOrder} className="btn-primary mt-5 block w-full text-center">
            Place order
          </button>
          <Link
            href="/cart"
            className="mt-3 block text-center text-sm text-gray-500 underline transition hover:text-leaf"
          >
            ← Back to cart
          </Link>
        </section>
      </div>
    </div>
  )
}