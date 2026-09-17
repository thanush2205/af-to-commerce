import type { GlobalConfig } from 'payload'

/**
 * Hero — the single homepage hero banner, editable in the Admin UI.
 */
export const Hero: GlobalConfig = {
  slug: 'hero',
  label: 'Hero',
  admin: {
    group: 'Content',
  },
  fields: [
    {
      name: 'headline',
      type: 'text',
      required: true,
      defaultValue: "Everyday essentials, straight from Summerhill",
    },
    {
      name: 'subheadline',
      type: 'textarea',
      defaultValue:
        'Farm-fresh produce, artisan bakery and pantry staples — delivered to your door.',
    },
    {
      name: 'imageUrl',
      type: 'text',
      admin: {
        description: 'Hero background image URL',
      },
    },
    {
      name: 'ctaLabel',
      type: 'text',
      defaultValue: 'Shop now',
    },
    {
      name: 'ctaHref',
      type: 'text',
      defaultValue: '/products',
    },
  ],
}