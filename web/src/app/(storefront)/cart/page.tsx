'use client'

import Link from 'next/link'
import { useCart } from '@/context/CartContext'
import { formatPrice } from '@/lib/api'

export default function CartPage() {
  const {
    items,
    increaseQuantity,
    decreaseQuantity,
    removeItem,
    clearCart,
    totalItems,
    totalPrice,
  } = useCart()

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24 text-center sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Your cart is empty</h1>
        <p className="mt-2 text-sm text-gray-500">
          Add a few products and they&rsquo;ll show up here.
        </p>
        <Link href="/products" className="btn-primary mt-8 inline-block">
          Browse products
        </Link>
      </div>
    )
  }

  const currency = items[0]?.currency || 'CAD'

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex items-end justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Shopping cart</h1>
        <button
          type="button"
          onClick={clearCart}
          className="text-sm text-gray-500 underline transition hover:text-red-600"
        >
          Clear cart
        </button>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ul className="space-y-4">
            {items.map((item) => (
              <li
                key={item.sku}
                className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 sm:flex-row sm:items-center"
              >
                {item.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image}
                    alt={item.name}
                    className="h-20 w-20 shrink-0 rounded-xl border border-gray-200 object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-xs text-gray-400">
                    No image
                  </div>
                )}

                <div className="flex flex-1 flex-col sm:flex-row sm:items-center sm:justify-between">
                  <Link
                    href={`/products/${item.slug}`}
                    className="text-sm font-semibold text-gray-900 hover:text-leaf"
                  >
                    {item.name}
                  </Link>

                  <div className="mt-3 flex items-center justify-between gap-4 sm:mt-0 sm:justify-end">
                    <div className="flex items-center gap-1 rounded-full border border-gray-300">
                      <button
                        type="button"
                        onClick={() => decreaseQuantity(item.sku)}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-gray-600 transition hover:text-leaf"
                        aria-label={`Decrease quantity of ${item.name}`}
                      >
                        −
                      </button>
                      <span className="w-8 text-center text-sm font-semibold">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => increaseQuantity(item.sku)}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-gray-600 transition hover:text-leaf"
                        aria-label={`Increase quantity of ${item.name}`}
                      >
                        +
                      </button>
                    </div>

                    <div className="w-24 text-right">
                      <p className="text-sm font-bold text-gray-900">
                        {formatPrice(item.price * item.quantity, item.currency)}
                      </p>
                      {item.quantity > 1 && (
                        <p className="text-xs text-gray-400">
                          {formatPrice(item.price, item.currency)} each
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => removeItem(item.sku)}
                      className="rounded-full p-1 text-gray-400 transition hover:text-red-600"
                      aria-label={`Remove ${item.name} from cart`}
                    >
                      <svg
                        className="h-4 w-4"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <aside className="h-fit rounded-2xl border border-gray-200 bg-white p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Order summary
          </h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Items</dt>
              <dd className="font-medium text-gray-900">
                {totalItems} ({totalItems === 1 ? 'item' : 'items'})
              </dd>
            </div>
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
          <Link href="/checkout" className="btn-primary mt-5 block w-full text-center">
            Proceed to checkout
          </Link>
          <Link
            href="/products"
            className="mt-3 block text-center text-sm text-gray-500 underline transition hover:text-leaf"
          >
            Continue shopping
          </Link>
        </aside>
      </div>
    </div>
  )
}