import type { CollectionConfig } from 'payload'

/**
 * Categories — assessment spec:
 *   Name, Slug, Icon/Image
 *
 * `icon` is a remote image URL (the catalog is sourced from the Homesome CDN,
 * so we store URLs rather than uploaded media).
 */
export const Categories: CollectionConfig = {
  slug: 'categories',
  labels: { singular: 'Category', plural: 'Categories' },
  admin: {
    useAsTitle: 'name',
    group: 'Catalog',
    defaultColumns: ['name', 'slug', 'icon'],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description: 'URL-safe identifier, e.g. "snacks-and-treats"',
      },
    },
    {
      name: 'description',
      type: 'textarea',
    },
    {
      name: 'icon',
      type: 'text',
      admin: {
        description: 'Remote image URL for the category icon/card',
      },
    },
  ],
}