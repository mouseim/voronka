import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { AdminRepository } from '../src/admin/repository'
import { parseAndMigrateFunnelDocument } from '../src/core/shared'
import { createPool } from '../src/db/pool'
import { PostgresRuntimeStore } from '../src/db/postgres-store'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const filename = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(process.cwd(), '../public/demo-7-mehanizmov-v3.funnel')
const raw = JSON.parse(await readFile(filename, 'utf8')) as unknown
const parsed = parseAndMigrateFunnelDocument(raw)
if (!parsed.success) throw new Error(parsed.errors.join('; '))

const pool = createPool(databaseUrl)
const store = new PostgresRuntimeStore(pool)
const repository = new AdminRepository(pool, store)
try {
  const imported = await repository.importDocument(parsed.document, '0')
  for (const product of parsed.document.products) {
    await repository.configureProduct(imported.versionId, product.id, {
      productType: 'digital',
      provider: 'mock',
      currency: 'RUB',
      amountMinor: Math.round(product.price * 100),
      deliveryAssetIds: product.assetId ? [product.assetId] : [],
    }, '0')
  }
  const published = await repository.publish(imported.versionId, '0', true)
  if (!published.published) throw new Error(published.issues.map((issue) => issue.message).join('; '))
  await repository.setDefault(imported.funnelId, '0')
  process.stdout.write(`Demo готова: ${parsed.document.funnel.name} v${parsed.document.funnel.version}, versionId=${imported.versionId}\n`)
} finally {
  await pool.end()
}
