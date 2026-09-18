import Link from 'next/link'

export const metadata = { title: 'Checkout cancelled — Summerhill Market' }

export default function CheckoutCancelPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
        <svg
          className="h-8 w-8 text-gray-500"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
        </svg>
      </div>
      <h1 className="mt-6 text-3xl font-bold tracking-tight text-gray-900">
        Checkout cancelled
      </h1>
      <p className="mt-3 text-sm text-gray-500">
        No payment was taken. Your cart is still here if you want to try again.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/cart" className="btn-primary">
          Back to cart
        </Link>
        <Link href="/products" className="btn-outline">
          Continue shopping
        </Link>
      </div>
    </div>
  )
}