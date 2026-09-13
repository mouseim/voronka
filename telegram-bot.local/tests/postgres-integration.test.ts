import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { describe, expect, it } from 'vitest'
import { AdminRepository } from '../src/admin/repository'
import { parseAndMigrateFunnelDocument } from '../src/core/shared'
import type { DatabasePool } from '../src/db/pool'
import { PostgresRuntimeStore } from '../src/db/postgres-store'
import { loadDemo, profile } from './helpers'

describe('PostgreSQL import/publish/version integration', () => {
  it('хранит одинаковые external ID Telegram и VK как разные identities', async () => {
    const database = await PGlite.create({ extensions: { pgcrypto } })
    const pool = pglitePool(database)
    try {
      await applyMigration(database, '001_initial.sql')
      await applyMigration(database, '002_submission_idempotency.sql')
      await database.query("INSERT INTO telegram_users(telegram_id, username) VALUES (42, 'legacy')")
      await applyMigration(database, '003_platform_identity.sql')
      const store = new PostgresRuntimeStore(pool)
      expect(await store.getUserByPlatformIdentity('telegram', '42')).toMatchObject({ platform: 'telegram', username: 'legacy' })
      const telegram = await store.upsertUser({ platform: 'telegram', externalUserId: '42', username: 'legacy' })
      const vk = await store.upsertUser({ platform: 'vk', externalUserId: '42' })
      expect(telegram.id).not.toBe(vk.id)
      expect(await store.getUserByPlatformIdentity('telegram', '42')).toMatchObject({ platform: 'telegram' })
      expect(await store.getUserByPlatformIdentity('vk', '42')).toMatchObject({ platform: 'vk' })
    } finally {
      await database.close()
    }
  })

  it('публикует версии, копирует стабильные media bindings и не мигрирует старую сессию', async () => {
    const database = await PGlite.create({ extensions: { pgcrypto } })
    const pool = pglitePool(database)
    try {
      await applyMigrations(database)
      const store = new PostgresRuntimeStore(pool)
      const admin = new AdminRepository(pool, store)
      const v1Document = await loadDemo()
      const v1 = await admin.importDocument(v1Document, '1')
      await configureAndBind(admin, v1.versionId, v1Document)
      expect((await admin.publish(v1.versionId, '1')).published).toBe(true)
      await admin.setDefault(v1.funnelId, '1')

      const user = await store.upsertUser(profile)
      const oldSession = await store.createSession({
        userId: user.id,
        funnelId: v1.funnelId,
        versionId: v1.versionId,
        status: 'active',
        currentNodeId: v1Document.funnel.startNodeId,
        state: {},
      })

      const v2Document = structuredClone(v1Document)
      v2Document.funnel.version = 2
      v2Document.funnel.parentVersion = 1
      v2Document.funnel.status = 'draft'
      v2Document.funnel.updatedAt = new Date().toISOString()
      const v2 = await admin.importDocument(v2Document, '1')
      expect((await admin.listMedia(v2.versionId)).every((media) => media.bound)).toBe(true)
      await configureProducts(admin, v2.versionId, v2Document)
      expect((await admin.publish(v2.versionId, '1')).published).toBe(true)

      expect((await store.resolveVersion())?.version.id).toBe(v2.versionId)
      expect((await store.getSession(oldSession.id))?.versionId).toBe(v1.versionId)
      expect((await store.getVersion(v1.versionId))?.status).toBe('archived')

      const exported = await admin.exportFunnel(v2.versionId)
      const parsed = parseAndMigrateFunnelDocument(exported)
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.document.nodes).toEqual(v2Document.nodes)
        expect(parsed.document.editor).toEqual(v2Document.editor)
      }
    } finally {
      await database.close()
    }
  })
})

async function configureAndBind(admin: AdminRepository, versionId: string, document: Awaited<ReturnType<typeof loadDemo>>) {
  await configureProducts(admin, versionId, document)
  for (const asset of document.assets) {
    await admin.bindMedia(versionId, asset.id, {
      type: asset.type,
      fileId: `telegram-${asset.id}`,
      fileUniqueId: `unique-${asset.id}`,
      mimeType: asset.type === 'document' ? 'application/pdf' : 'image/jpeg',
      fileSize: 1_024,
    }, '1')
  }
}

async function configureProducts(admin: AdminRepository, versionId: string, document: Awaited<ReturnType<typeof loadDemo>>) {
  for (const product of document.products) {
    await admin.configureProduct(versionId, product.id, {
      productType: 'digital',
      provider: 'mock',
      currency: 'RUB',
      amountMinor: Math.round(product.price * 100),
      deliveryAssetIds: product.assetId ? [product.assetId] : [],
    }, '1')
  }
}

async function applyMigrations(database: PGlite) {
  const directory = path.resolve(process.cwd(), 'migrations')
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()
  for (const file of files) await database.exec(await readFile(path.join(directory, file), 'utf8'))
}

async function applyMigration(database: PGlite, filename: string) {
  await database.exec(await readFile(path.resolve(process.cwd(), 'migrations', filename), 'utf8'))
}

function pglitePool(database: PGlite): DatabasePool {
  const query = async (text: string, values?: unknown[]) => {
    const result = await database.query(text, values)
    return {
      ...result,
      rowCount: result.affectedRows ?? result.rows.length,
    }
  }
  return {
    query,
    async connect() {
      return { query, release() {} }
    },
  } as unknown as DatabasePool
}
