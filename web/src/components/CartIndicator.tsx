'use client'

import Link from 'next/link'
import { useCart } from '@/context/CartContext'

export function CartIndicator() {
  const { totalItems } = useCart()

  return (
    <Link
      href="/cart"
      className="relative inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:border-leaf hover:text-leaf"
      aria-label={`Cart with ${totalItems} item${totalItems === 1 ? '' : 's'}`}
    >
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
      {totalItems > 0 && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-leaf px-1 text-xs font-bold text-white">
          {totalItems}
        </span>
      )}
    </Link>
  )
}