'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

export interface CartItem {
  sku: string
  slug: string
  name: string
  price: number
  currency: string
  image: string | null
  quantity: number
}

export type NewCartItem = Omit<CartItem, 'quantity'> & { quantity?: number }

interface CartContextValue {
  items: CartItem[]
  addItem: (item: NewCartItem) => void
  increaseQuantity: (sku: string) => void
  decreaseQuantity: (sku: string) => void
  removeItem: (sku: string) => void
  clearCart: () => void
  totalItems: number
  totalPrice: number
}

const STORAGE_KEY = 'af-commerce-cart'

const CartContext = createContext<CartContextValue | null>(null)

function loadCart(): CartItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as CartItem[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([])

  useEffect(() => {
    setItems(loadCart())
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    } catch {
      /* storage unavailable — keep the cart in memory only */
    }
  }, [items])

  const addItem = useCallback((item: NewCartItem) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.sku === item.sku)
      if (existing) {
        return prev.map((i) =>
          i.sku === item.sku
            ? { ...i, quantity: i.quantity + (item.quantity ?? 1) }
            : i,
        )
      }
      return [...prev, { ...item, quantity: item.quantity ?? 1 }]
    })
  }, [])

  const increaseQuantity = useCallback((sku: string) => {
    setItems((prev) =>
      prev.map((i) => (i.sku === sku ? { ...i, quantity: i.quantity + 1 } : i)),
    )
  }, [])

  const decreaseQuantity = useCallback((sku: string) => {
    setItems((prev) =>
      prev
        .map((i) => (i.sku === sku ? { ...i, quantity: i.quantity - 1 } : i))
        .filter((i) => i.quantity > 0),
    )
  }, [])

  const removeItem = useCallback((sku: string) => {
    setItems((prev) => prev.filter((i) => i.sku !== sku))
  }, [])

  const clearCart = useCallback(() => {
    setItems([])
  }, [])

  const { totalItems, totalPrice } = useMemo(
    () =>
      items.reduce(
        (acc, i) => {
          acc.totalItems += i.quantity
          acc.totalPrice += i.quantity * i.price
          return acc
        },
        { totalItems: 0, totalPrice: 0 },
      ),
    [items],
  )

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      addItem,
      increaseQuantity,
      decreaseQuantity,
      removeItem,
      clearCart,
      totalItems,
      totalPrice,
    }),
    [
      items,
      addItem,
      increaseQuantity,
      decreaseQuantity,
      removeItem,
      clearCart,
      totalItems,
      totalPrice,
    ],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within a CartProvider')
  return ctx
}