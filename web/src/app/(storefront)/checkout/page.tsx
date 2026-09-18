'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useCart, type CartItem } from '@/context/CartContext'
import { apiPost, formatPrice, type CheckoutSessionResponse } from '@/lib/api'

type SubmitState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }

export default function CheckoutPage() {
  const { items, totalPrice } = useCart()
  const [submit, setSubmit] = useState<SubmitState>({ status: 'idle' })

  const currency = useMemo(() => items[0]?.currency || 'CAD', [items])

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

  async function placeOrder() {
    setSubmit({ status: 'loading' })
    try {
      const body = {
        // The frontend ONLY sends sku + quantity. The backend re-fetches
        // authoritative prices from PostgreSQL — a tampered amount is ignored.
        items: items.map((item: CartItem) => ({
          sku: item.sku,
          quantity: item.quantity,
        })),
        successUrl: `${window.location.origin}/checkout/success`,
        cancelUrl: `${window.location.origin}/checkout/cancel`,
      }
      const session = await apiPost<CheckoutSessionResponse>('/api/checkout', body)
      window.location.assign(session.url)
    } catch (err) {
      setSubmit({
        status: 'error',
        message:
          err instanceof Error ? err.message : 'Could not start checkout. Try again.',
      })
    }
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
          <p className="mt-4 text-xs text-gray-400">
            Prices shown are indicative. The final amount is authoritative and
            re-calculated securely on the server before payment.
          </p>
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

          <button
            type="button"
            onClick={placeOrder}
            disabled={submit.status === 'loading'}
            className="btn-primary mt-5 block w-full text-center disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {submit.status === 'loading'
              ? 'Redirecting to secure checkout…'
              : 'Proceed to payment'}
          </button>

          {submit.status === 'error' && (
            <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs leading-5 text-red-700">
              {submit.message}
            </p>
          )}

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