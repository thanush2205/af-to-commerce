import Link from 'next/link'
import { notFound } from 'next/navigation'
import { apiGet, formatPrice, type OrderDetail, type SessionDetail } from '@/lib/api'
import { ClearCartOnMount } from '@/components/ClearCartOnMount'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Order confirmed — Summerhill Market' }

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>
}) {
  const { session_id } = await searchParams
  if (!session_id) notFound()

  let session: SessionDetail | null = null
  try {
    session = await apiGet<SessionDetail>(
      `/api/checkout/session/${encodeURIComponent(session_id)}`,
    )
  } catch {
    session = null
  }
  if (!session) notFound()

  // The order row is written by the Stripe webhook, which can arrive a moment
  // after the redirect — the split is shown when available, otherwise the page
  // still renders from the authoritative session data.
  let order: OrderDetail | null = null
  try {
    order = await apiGet<OrderDetail>(
      `/api/orders/${encodeURIComponent(session_id)}`,
    )
  } catch {
    order = null
  }

  const paid = session.paymentStatus === 'paid'

  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
      <ClearCartOnMount />

      <div
        className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${
          paid ? 'bg-leaf-light' : 'bg-amber-50'
        }`}
      >
        {paid ? (
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
        ) : (
          <svg
            className="h-8 w-8 text-amber-600"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-11a1 1 0 0 1 1 1v3a1 1 0 1 1-2 0V8a1 1 0 0 1 1-1Zm0 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </div>

      <h1 className="mt-6 text-3xl font-bold tracking-tight text-gray-900">
        {paid ? 'Order confirmed' : 'Payment pending'}
      </h1>
      <p className="mt-3 text-sm leading-6 text-gray-500">
        {paid
          ? 'Thanks for your order! Your basket has been cleared and a receipt is on the way.'
          : 'We received your checkout session, but the payment has not completed yet.'}
      </p>

      {session.amountTotal !== null && (
        <p className="mt-6 text-2xl font-bold text-leaf">
          {formatPrice(session.amountTotal / 100, session.currency || 'CAD')}
        </p>
      )}

      {session.lineItems.length > 0 && (
        <ul className="mx-auto mt-6 max-w-sm space-y-2 rounded-2xl border border-gray-200 bg-white p-5 text-left text-sm">
          {session.lineItems.map((item, i) => (
            <li key={`${item.name}-${i}`} className="flex justify-between gap-3">
              <span className="text-gray-700">
                {item.quantity} × {item.name}
              </span>
              <span className="font-medium text-gray-900">
                {formatPrice((item.amountTotal || 0) / 100, session.currency || 'CAD')}
              </span>
            </li>
          ))}
        </ul>
      )}

      {order && (
        <div className="mx-auto mt-8 max-w-sm rounded-2xl border border-gray-200 bg-white p-5 text-left text-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Revenue split
          </h2>
          <dl className="mt-3 space-y-2">
            <div className="flex justify-between">
              <dt className="text-gray-500">Order total</dt>
              <dd className="font-medium text-gray-900">
                {formatPrice(order.split.total / 100, order.order.currency)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Platform fee ({Math.round(order.split.rate * 100)}%)</dt>
              <dd className="font-medium text-gray-900">
                {formatPrice(order.split.platformFee / 100, order.order.currency)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Merchant share</dt>
              <dd className="font-medium text-leaf">
                {formatPrice(order.split.merchantShare / 100, order.order.currency)}
              </dd>
            </div>
          </dl>
          <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-400">
            Computed server-side by {`calculatePlatformFee()`} — the frontend
            never supplies an amount.
          </p>
        </div>
      )}

      {session.customerEmail && (
        <p className="mt-6 text-xs text-gray-400">
          Receipt sent to {session.customerEmail}
        </p>
      )}

      <Link href="/products" className="btn-primary mt-8 inline-block">
        Continue shopping
      </Link>
    </div>
  )
}