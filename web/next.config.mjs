import { withPayload } from '@payloadcms/next/withPayload'

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // The storefront fetches from the Node API (compose-internal host).
    serverActions: { bodySizeLimit: '2mb' },
  },
}

export default withPayload(nextConfig)