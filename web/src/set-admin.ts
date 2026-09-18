import 'dotenv/config'
import { getPayload } from 'payload'
import config from './payload.config'

async function main(): Promise<void> {
  const email = process.env.PAYLOAD_ADMIN_EMAIL || 'admin@summerhill.demo'
  const password = process.env.PAYLOAD_ADMIN_PASSWORD || ''
  if (!password) {
    console.error('Set PAYLOAD_ADMIN_PASSWORD before running.')
    process.exit(1)
  }

  const payload = await getPayload({ config })
  const existing = await payload.find({ collection: 'users', limit: 1, depth: 0 })

  if (existing.totalDocs > 0) {
    await payload.update({
      collection: 'users',
      id: existing.docs[0].id,
      data: { email, password, name: 'Store Admin' },
    })
    console.log(`${email} / ${password.replace(/./g, '*')} (password masked) — updated.`)
  } else {
    await payload.create({
      collection: 'users',
      data: { email, password, name: 'Store Admin' },
    })
    console.log(`${email} — created.`)
  }

  await payload.db.destroy()
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed:', err)
    process.exit(1)
  })