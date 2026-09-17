import path from 'path'
import { fileURLToPath } from 'url'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import sharp from 'sharp'
import { buildConfig } from 'payload'

import { Users } from './collections/Users'
import { Categories } from './collections/Categories'
import { Products } from './collections/Products'
import { Hero } from './globals/Hero'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

const isDev = process.env.NODE_ENV === 'development'

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    // The storefront renders at "/" — keep the Admin reachable and obvious.
    meta: {
      titleSuffix: ' — AF-TO Commerce',
    },
  },
  collections: [Categories, Products, Users],
  globals: [Hero],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || 'dev-secret-change-me',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URI || process.env.DATABASE_URL || '',
    },
    // Dev-mode schema push keeps the demo stack turn-key. Use migrations in prod.
    push: isDev,
  }),
  sharp,
  plugins: [],
})