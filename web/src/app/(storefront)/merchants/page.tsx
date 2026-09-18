import Link from 'next/link'

import { apiGet, apiPostServer } from '@/lib/api'
import type { ApiMerchant } from '@/lib/api'

/**
 * Stage 4 — Stripe Connect merchants (admin-only surface in this demo).
 * Shows each Custom Connected Account's status, drives the simulator
 * (verified | failed | restricted) and explains what each state means for
 * payouts.
 */
export const dynamic = 'force-dynamic'

const STATUS_HELP: Record<string, string> = {
  verified:
    'All requirements met. Can receive payouts via transfers / destination charges.',
  pending: 'Onboarding started; account requirements not yet collected.',
  restricted: 'Some requirements past due. Charges/payouts limited by Stripe.',
  failed: 'Requirements failed permanently. Charges and payouts disabled.',
}

async function refreshStatuses(id: number): Promise<ApiMerchant> {
  'use server'
  return id ? apiGet<{ data: ApiMerchant }>(`/api/merchants/${id}`).then((r) => r.data) : ({} as ApiMerchant)
}

export default async function MerchantsPage() {
  const { data: merchants } = await apiGet<{ data: ApiMerchant[] }>('/api/merchants')

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="border-b border-neutral-200 pb-6">
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Back to store
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Merchants — Stripe Connect (Stage 4)
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          Custom Connected Accounts are created and controlled programmatically by the
          platform. This read-only page shows their live status; payouts are prevented
          for anything that isn&apos;t <span className="font-mono">verified</span>.
        </p>
      </header>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Create a merchant
        </h2>
        <MerchantForm />
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          {merchants.length} merchant{merchants.length === 1 ? '' : 's'}
        </h2>
        {merchants.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500">
            No merchants yet. Create one to see its Connected Account + status.
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {merchants.map((m) => (
              <li
                key={m.id}
                className="rounded-xl border border-neutral-200 p-5 shadow-sm"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{m.name}</span>
                      <StatusBadge status={m.status} />
                    </div>
                    <p className="mt-1 text-sm text-neutral-500">{m.email}</p>
                    <p className="mt-1 font-mono text-xs text-neutral-400">
                      {m.stripeAccountId || 'no connected account (Stripe key not set)'}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-sm text-neutral-600">
                  {STATUS_HELP[m.status] || m.status}
                  {m.statusReason ? ` Reason: ${m.statusReason}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 rounded-xl bg-neutral-50 p-5 text-sm text-neutral-600">
        <h2 className="font-medium text-neutral-900">How status gates money</h2>
        <p className="mt-2">
          In <span className="font-mono">destination_charge</span> flows the platform
          fee and merchant share split automatically at capture. In{' '}
          <span className="font-mono">separate charges &amp; transfers</span> flows the
          platform collects the full amount and later issues a Transfer to the merchant
          (see <span className="font-mono">POST /api/orders/:sessionId/transfer</span>).
          Both are blocked while a merchant is <span className="font-mono">failed</span>{' '}
          or <span className="font-mono">restricted</span>.
        </p>
        <p className="mt-2 text-xs text-neutral-400">
          Data source:{' '}
          <code className="font-mono">GET /api/merchants</code>
        </p>
      </section>
    </main>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    verified: 'bg-emerald-100 text-emerald-800',
    pending: 'bg-amber-100 text-amber-800',
    restricted: 'bg-orange-100 text-orange-800',
    failed: 'bg-red-100 text-red-800',
  }
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[status] || 'bg-neutral-100 text-neutral-700'}`}
    >
      {status}
    </span>
  )
}

// Server-action form posts to the public API to create a merchant.
async function MerchantForm() {
  async function createMerchant(formData: FormData): Promise<void> {
    'use server'
    const name = String(formData.get('name') || '').trim()
    const email = String(formData.get('email') || '').trim()
    if (!name || !email) return
    await apiPostServer<{ data: ApiMerchant }>('/api/merchants', { name, email })
  }
  return (
    <form action={createMerchant} className="mt-3 flex flex-wrap items-end gap-3">
      <label className="flex flex-col text-xs text-neutral-600">
        Name
        <input
          name="name"
          required
          placeholder="Acme Farms"
          className="mt-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="flex flex-col text-xs text-neutral-600">
        Email
        <input
          name="email"
          type="email"
          required
          placeholder="accounts@acme.farm"
          className="mt-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>
      <button
        type="submit"
        className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
      >
        Create merchant
      </button>
    </form>
  )
}