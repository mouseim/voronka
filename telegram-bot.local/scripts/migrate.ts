import 'dotenv/config'
import { migrate } from '../src/db/migrate'
import { createPool } from '../src/db/pool'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const pool = createPool(databaseUrl)
try {
  const files = await migrate(pool)
  process.stdout.write(`Миграции проверены: ${files.join(', ')}\n`)
} finally {
  await pool.end()
}
