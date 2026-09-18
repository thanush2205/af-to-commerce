import Link from 'next/link'
import type { ReactNode } from 'react'
import './globals.css'
import { CartProvider } from '@/context/CartContext'
import { CartIndicator } from '@/components/CartIndicator'

export const metadata = {
  title: 'Summerhill Market — Everyday essentials',
  description:
    'Farm-fresh produce, artisan bakery and pantry staples from Summerhill Market.',
}

export default function StorefrontLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <CartProvider>
          <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
            <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
              <Link href="/" className="text-lg font-bold tracking-tight text-leaf">
                Summerhill<span className="text-leaf-dark">.</span>
              </Link>
              <div className="flex items-center gap-5 text-sm font-medium text-gray-600">
                <Link href="/" className="hover:text-leaf">
                  Home
                </Link>
                <Link href="/products" className="hover:text-leaf">
                  Shop
                </Link>
                <Link href="/merchants" className="hover:text-leaf">
                  Merchants
                </Link>
                <Link href="/admin" className="hover:text-leaf">
                  Admin
                </Link>
                <CartIndicator />
              </div>
            </nav>
          </header>
          <main>{children}</main>
          <footer className="border-t border-gray-200 bg-white py-10">
            <div className="mx-auto max-w-7xl px-4 text-center text-sm text-gray-500 sm:px-6">
              <p>AF-TO Commerce — Stage 3 storefront</p>
              <p className="mt-1">
                Next.js App Router · Payload CMS · PostgreSQL · Tailwind CSS
              </p>
            </div>
          </footer>
        </CartProvider>
      </body>
    </html>
  )
}