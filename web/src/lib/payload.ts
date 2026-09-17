import { getPayload } from 'payload'
import config from '@payload-config'

/** Payload local API client (server-side only). */
export async function getPayloadClient() {
  return getPayload({ config })
}