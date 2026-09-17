import type { CollectionConfig } from 'payload'

/**
 * Admin users. Payload creates this collection automatically when you set
 * `admin.user`, but we declare it explicitly so the admin credentials are
 * obvious and the collection appears in the Admin navigation.
 */
export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  admin: {
    useAsTitle: 'email',
    group: 'System',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
    },
  ],
}