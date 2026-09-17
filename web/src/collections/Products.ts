import type { CollectionConfig } from 'payload'

/**
 * Products — assessment spec:
 *   Title, Slug, Description, Price, Image, Category, Stock Status
 *
 * Extra provenance + commerce fields (sku, brand, unit, featured) make the
 * admin usable for the storefront's rendered pages.
 */
export const Products: CollectionConfig = {
  slug: 'products',
  labels: { singular: 'Product', plural: 'Products' },
  admin: {
    useAsTitle: 'title',
    group: 'Catalog',
    defaultColumns: ['title', 'category', 'price', 'stockStatus', 'featured', 'updatedAt'],
    listSearchableFields: ['title', 'slug', 'sku'],
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      label: 'Title',
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'description',
      type: 'textarea',
      label: 'Description',
    },
    {
      name: 'price',
      type: 'number',
      required: true,
      label: 'Price',
      min: 0,
    },
    {
      name: 'currency',
      type: 'select',
      defaultValue: 'CAD',
      options: [
        { label: 'CAD', value: 'CAD' },
        { label: 'USD', value: 'USD' },
      ],
    },
    {
      name: 'image',
      type: 'text',
      label: 'Image',
      admin: {
        description: 'Remote image URL',
      },
    },
    {
      name: 'category',
      type: 'relationship',
      relationTo: 'categories',
      label: 'Category',
    },
    {
      name: 'stockStatus',
      type: 'select',
      label: 'Stock Status',
      required: true,
      defaultValue: 'in_stock',
      options: [
        { label: 'In stock', value: 'in_stock' },
        { label: 'Out of stock', value: 'out_of_stock' },
        { label: 'Unavailable', value: 'unavailable' },
      ],
    },
    {
      name: 'featured',
      type: 'checkbox',
      label: 'Featured on homepage',
      defaultValue: false,
    },
    {
      name: 'sku',
      type: 'text',
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'brand',
      type: 'text',
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'unit',
      type: 'text',
      admin: {
        position: 'sidebar',
      },
    },
  ],
}