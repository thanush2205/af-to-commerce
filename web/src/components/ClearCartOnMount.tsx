'use client'

import { useEffect } from 'react'
import { useCart } from '@/context/CartContext'

/**
 * Clears the client-side cart once the Stripe success page mounts. The cart is
 * local state (localStorage) — after a completed payment the items are gone.
 */
export function ClearCartOnMount() {
  const { clearCart } = useCart()
  useEffect(() => {
    clearCart()
  }, [clearCart])
  return null
}