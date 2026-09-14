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
  it('migration 004 сохраняет существующий Telegram media binding', async () => {
    const database = await PGlite.create({ extensions: { pgcrypto } })
    const pool = pglitePool(database)
    try {
      await applyMigration(database, '001_initial.sql')
      await applyMigration(database, '002_submission_idempotency.sql')
      await applyMigration(database, '003_platform_identity.sql')
      const funnel = await database.query<{ id: string }>(`
        INSERT INTO funnels(funnel_key, source_funnel_id, name) VALUES ('legacy', 'legacy-source', 'Legacy') RETURNING id
      `)
      const version = await database.query<{ id: string }>(`
        INSERT INTO funnel_versions(funnel_id, version, schema_version, status, content_hash, raw_document)
        VALUES ($1, 1, '3.0', 'draft', 'legacy-hash', '{}'::jsonb) RETURNING id
      `, [funnel.rows[0]!.id])
      const resource = await database.query<{ id: string }>(`
        INSERT INTO media_resources(telegram_file_id, media_type) VALUES ('legacy-file', 'image') RETURNING id
      `)
      await database.query(`
        INSERT INTO version_media_bindings(version_id, asset_id, asset_key, expected_type, resource_id)
        VALUES ($1, 'legacy-asset', 'legacy', 'image', $2)
      `, [version.rows[0]!.id, resource.rows[0]!.id])

      await applyMigration(database, '004_platform_media_bindings.sql')

      const binding = await new PostgresRuntimeStore(pool).getMediaBinding(version.rows[0]!.id, 'legacy-asset', 'telegram')
      expect(binding).toMatchObject({ platform: 'telegram', telegramFileId: 'legacy-file' })
    } finally {
      await database.close()
    }
  })

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
      const sharedAsset = v1Document.assets[0]!
      await admin.bindVkMedia(v1.versionId, sharedAsset.id, {
        type: sharedAsset.type === 'image' ? 'photo' : 'doc',
        ownerId: -10,
        mediaId: 77,
      }, '1')
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
      expect(await store.getMediaBinding(v2.versionId, sharedAsset.id, 'telegram')).toMatchObject({ platform: 'telegram' })
      expect(await store.getMediaBinding(v2.versionId, sharedAsset.id, 'vk')).toMatchObject({ platform: 'vk', attachment: { mediaId: 77 } })
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

  it('создаёт VK binding из .funnel override и переносит Telegram binding независимо', async () => {
    const database = await PGlite.create({ extensions: { pgcrypto } })
    const pool = pglitePool(database)
    try {
      await applyMigrations(database)
      const store = new PostgresRuntimeStore(pool)
      const admin = new AdminRepository(pool, store)
      const firstDocument = await loadDemo()
      const asset = firstDocument.assets[0]!
      asset.type = 'video'
      asset.logicalRef = 'video.mp4'
      asset.platformRefs = { vk: 'video-10_401_first-key' }

      const first = await admin.importDocument(firstDocument, '1')
      await admin.bindMedia(first.versionId, asset.id, {
        type: 'video',
        fileId: 'telegram-video-file',
        fileUniqueId: 'telegram-video-unique',
        mimeType: 'video/mp4',
        fileSize: 2_048,
      }, '1')
      expect(await store.getMediaBinding(first.versionId, asset.id, 'telegram')).toMatchObject({ telegramFileId: 'telegram-video-file' })
      expect(await store.getMediaBinding(first.versionId, asset.id, 'vk')).toMatchObject({
        attachment: { type: 'video', ownerId: -10, mediaId: 401, accessKey: 'first-key' },
      })
      const exported = parseAndMigrateFunnelDocument(await admin.exportFunnel(first.versionId))
      expect(exported.success).toBe(true)
      if (exported.success) expect(exported.document.assets[0]!.platformRefs?.vk).toBe('video-10_401_first-key')

      const secondDocument = structuredClone(firstDocument)
      secondDocument.funnel.version += 1
      secondDocument.assets[0]!.platformRefs = { vk: 'video-10_402_second-key' }
      const second = await admin.importDocument(secondDocument, '1')

      expect(await store.getMediaBinding(second.versionId, asset.id, 'telegram')).toMatchObject({ telegramFileId: 'telegram-video-file' })
      expect(await store.getMediaBinding(second.versionId, asset.id, 'vk')).toMatchObject({
        attachment: { type: 'video', mediaId: 402, accessKey: 'second-key' },
      })

      const thirdDocument = structuredClone(secondDocument)
      thirdDocument.funnel.version += 1
      delete thirdDocument.assets[0]!.platformRefs
      const third = await admin.importDocument(thirdDocument, '1')

      expect(await store.getMediaBinding(third.versionId, asset.id, 'telegram')).toMatchObject({ telegramFileId: 'telegram-video-file' })
      expect(await store.getMediaBinding(third.versionId, asset.id, 'vk')).toBeNull()
    } finally {
      await database.close()
    }
  })

  it('публикует, физически удаляет target funnel и повторно освобождает её technical key', async () => {
    const database = await PGlite.create({ extensions: { pgcrypto } })
    const pool = pglitePool(database)
    try {
      await applyMigrations(database)
      await database.exec(`
        INSERT INTO payment_integrations(provider, shop_id, secret_ciphertext, secret_iv, secret_auth_tag, verified_at)
        VALUES ('yookassa_api', 'shop', decode('00', 'hex'), decode('00', 'hex'), decode('00', 'hex'), now())
      `)
      const store = new PostgresRuntimeStore(pool)
      const admin = new AdminRepository(pool, store)
      const document = await loadDemo()

      const blocked = await admin.publishFromEditor(document, '1')
      expect(blocked.published).toBe(false)
      expect(blocked.issues.some((issue) => issue.code === 'runtime_media_binding_missing')).toBe(true)
      for (const asset of document.assets) {
        await admin.bindMedia(blocked.versionId, asset.id, { type: asset.type, fileId: `file-${asset.id}` }, '1')
      }
      const sharedAsset = document.assets[0]!
      await admin.bindVkMedia(blocked.versionId, sharedAsset.id, {
        type: sharedAsset.type === 'image' ? 'photo' : 'doc', ownerId: -1, mediaId: 10,
      }, '1')

      const first = await admin.publishFromEditor(document, '1')
      expect(first).toMatchObject({ published: true, created: false })
      expect(first.document.funnel.version).toBe(1)
      const product = await database.query<{ provider: string; amount_minor: number }>(
        'SELECT provider, amount_minor FROM runtime_product_configs WHERE version_id = $1', [first.versionId],
      )
      expect(product.rows[0]).toMatchObject({ provider: 'yookassa_api', amount_minor: 149000 })

      const user = await store.upsertUser(profile)
      const oldSession = await store.createSession({
        userId: user.id, funnelId: first.funnelId, versionId: first.versionId,
        status: 'active', currentNodeId: document.funnel.startNodeId, state: {},
      })
      const oldPayment = await store.createPayment({
        idempotencyKey: 'delete-removes-payment', userId: user.id, sessionId: oldSession.id,
        funnelId: first.funnelId, versionId: first.versionId, productId: document.products[0]!.id,
        provider: 'yookassa_api', invoicePayload: 'delete-removes-payment', amountMinor: 149000, currency: 'RUB',
      })
      const paid = await store.markPaymentPaid(oldPayment.id, 'delete-charge')
      const purchase = await store.recordPurchase(paid.payment)
      await store.markDelivered(purchase.purchaseId, document.assets[0]!.id, 'delete-delivery')
      await store.saveAnswer(oldSession.id, document.tests[0]!.id, document.tests[0]!.questions[0]!.id, 'answer')
      await store.saveConsent(oldSession, 'consent-node', true, 'https://example.com/policy', 'Согласие')
      await store.saveContactAndApplication(oldSession, { email: 'delete@example.test' })
      await store.createCallback(user.id, oldSession.id, { type: 'advance', nodeId: document.funnel.startNodeId, handle: 'next' })
      await store.createRedirect(user.id, oldSession.id, 'https://example.com', false)
      await store.scheduleJob({ uniqueKey: 'delete-job', type: 'resume_session', payload: { sessionId: oldSession.id, nodeId: document.funnel.startNodeId }, dueAt: new Date().toISOString(), maxAttempts: 5 })
      await store.appendEvent({ idempotencyKey: 'delete-event', type: 'test', userId: user.id, sessionId: oldSession.id, funnelId: first.funnelId, versionId: first.versionId })
      const changed = structuredClone(first.document)
      const message = changed.nodes.find((node) => node.type === 'message')!
      message.data.title = `${message.data.title} — обновлено`
      changed.editor.nodePositions[message.id] = { x: 999, y: 999 }

      const second = await admin.publishFromEditor(changed, '1')
      expect(second).toMatchObject({ published: true, created: true })
      expect(second.document.funnel.version).toBe(2)
      expect(await store.getMediaBinding(second.versionId, sharedAsset.id, 'telegram')).not.toBeNull()
      expect(await store.getMediaBinding(second.versionId, sharedAsset.id, 'vk')).not.toBeNull()
      expect((await store.getSession(oldSession.id))?.versionId).toBe(first.versionId)

      const layoutOnly = structuredClone(second.document)
      layoutOnly.editor.nodePositions[message.id] = { x: 1, y: 2 }
      const repeated = await admin.publishFromEditor(layoutOnly, '1')
      expect(repeated).toMatchObject({ published: true, created: false, versionId: second.versionId })
      expect((await store.resolveVersion())?.version.id).toBe(second.versionId)

      const listed = await admin.listEditorFunnels()
      expect(listed).toEqual([expect.objectContaining({
        id: document.funnel.id, activeVersion: 2, isDefault: true, nodeCount: document.nodes.length,
      })])
      const downloaded = await admin.getEditorFunnel(document.funnel.id)
      expect(downloaded).toMatchObject({ funnel: { id: document.funnel.id, version: 2, status: 'published' } })
      expect(downloaded?.analytics.contacts).toEqual([])
      expect(downloaded?.analytics.applications).toEqual([])
      expect(await admin.getEditorFunnel('missing')).toBeNull()

      const draftOnly = structuredClone(second.document)
      draftOnly.funnel.version = 3
      draftOnly.funnel.status = 'draft'
      await database.query(`
        INSERT INTO funnel_versions(funnel_id, version, schema_version, status, content_hash, raw_document)
        VALUES ($1, 3, '3.0.0', 'draft', 'draft-only-hash', $2::jsonb)
      `, [first.funnelId, JSON.stringify(draftOnly)])
      expect(await admin.listEditorFunnelVersions(document.funnel.id)).toEqual([
        expect.objectContaining({ version: 2, active: true }),
        expect.objectContaining({ version: 1, active: false }),
      ])
      const versionOne = await admin.getEditorFunnelVersionAnalytics(document.funnel.id, 1)
      expect(versionOne).toMatchObject({ funnel: { id: document.funnel.id, version: 1 }, analytics: { funnelVersion: 1 } })
      expect(await admin.getEditorFunnelVersionAnalytics(document.funnel.id, 3)).toBeNull()
      const other = await database.query<{ id: string }>("INSERT INTO funnels(funnel_key, source_funnel_id, name) VALUES ('other-version-key', 'other-version-source', 'Other') RETURNING id")
      await database.query(`
        INSERT INTO funnel_versions(funnel_id, version, schema_version, status, content_hash, raw_document, published_at)
        VALUES ($1, 99, '3.0.0', 'published', 'other-version-hash', $2::jsonb, now())
      `, [other.rows[0]!.id, JSON.stringify(draftOnly)])
      expect(await admin.getEditorFunnelVersionAnalytics(document.funnel.id, 99)).toBeNull()
      await database.query('DELETE FROM funnel_versions WHERE funnel_id = $1', [other.rows[0]!.id])
      await database.query('DELETE FROM funnels WHERE id = $1', [other.rows[0]!.id])

      expect(await admin.deleteEditorFunnel(document.funnel.id, '1')).toEqual({ deleted: true, replacementSourceId: null })
      expect(await admin.listEditorFunnels()).toEqual([])
      expect(await admin.getEditorFunnel(document.funnel.id)).toBeNull()
      expect(await store.resolveVersion()).toBeNull()
      expect(await store.resolveVersion(document.bot.trackingLinks[0]?.code)).toBeNull()
      expect(await store.getSession(oldSession.id)).toBeNull()
      expect(await store.getPayment(oldPayment.id)).toBeNull()
      expect(await admin.deleteEditorFunnel(document.funnel.id, '1')).toBeNull()
      for (const table of ['funnels', 'funnel_versions', 'version_media_bindings', 'runtime_product_configs', 'sessions', 'test_runs', 'answers', 'consents', 'contacts', 'applications', 'payments', 'purchases', 'content_deliveries', 'analytics_events', 'callback_tokens', 'redirect_tokens', 'jobs', 'admin_audit_log']) {
        const count = await database.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`)
        expect(Number(count.rows[0]!.count), table).toBe(0)
      }
      expect(Number((await database.query<{ count: string }>('SELECT count(*)::text AS count FROM telegram_users')).rows[0]!.count)).toBe(1)
      expect(Number((await database.query<{ count: string }>('SELECT count(*)::text AS count FROM payment_integrations')).rows[0]!.count)).toBe(1)
      expect(Number((await database.query<{ count: string }>('SELECT count(*)::text AS count FROM media_resources')).rows[0]!.count)).toBe(0)

      const replacement = structuredClone(second.document)
      replacement.funnel.id = 'independent-replacement-funnel'
      replacement.funnel.version = 1
      replacement.funnel.parentVersion = undefined
      replacement.funnel.status = 'draft'
      const initialReplacement = await admin.publishFromEditor(replacement, '1')
      for (const asset of replacement.assets) {
        await admin.bindMedia(initialReplacement.versionId, asset.id, { type: asset.type, fileId: `replacement-${asset.id}` }, '1')
      }
      const recreated = await admin.publishFromEditor(replacement, '1')
      expect(recreated).toMatchObject({ published: true, document: { funnel: { id: replacement.funnel.id, key: document.funnel.key } } })
      expect(await admin.listEditorFunnels()).toEqual([expect.objectContaining({ id: replacement.funnel.id, activeVersion: 1, isDefault: true })])
    } finally {
      await database.close()
    }
  })

  it('назначает replacement default и скрывает legacy archived funnels в Telegram admin', async () => {
    const database = await PGlite.create({ extensions: { pgcrypto } })
    const pool = pglitePool(database)
    try {
      await applyMigrations(database)
      const target = await database.query<{ id: string }>("INSERT INTO funnels(funnel_key, source_funnel_id, name, default_for_bot) VALUES ('target', 'target-source', 'Target', true) RETURNING id")
      const replacement = await database.query<{ id: string }>("INSERT INTO funnels(funnel_key, source_funnel_id, name) VALUES ('replacement', 'replacement-source', 'Replacement') RETURNING id")
      await database.query("INSERT INTO funnels(funnel_key, source_funnel_id, name, archived_at) VALUES ('legacy', 'legacy-source', 'Legacy', now())")
      for (const [funnelId, hash] of [[target.rows[0]!.id, 'target-hash'], [replacement.rows[0]!.id, 'replacement-hash']] as const) {
        const version = await database.query<{ id: string }>(`
          INSERT INTO funnel_versions(funnel_id, version, schema_version, status, content_hash, raw_document, published_at)
          VALUES ($1, 1, '3.0.0', 'published', $2, '{}'::jsonb, now()) RETURNING id
        `, [funnelId, hash])
        await database.query('UPDATE funnels SET active_version_id = $2 WHERE id = $1', [funnelId, version.rows[0]!.id])
      }
      const admin = new AdminRepository(pool, new PostgresRuntimeStore(pool))

      await expect(admin.deleteEditorFunnel('target-source', '1')).resolves.toEqual({ deleted: true, replacementSourceId: 'replacement-source' })
      expect((await database.query<{ source_funnel_id: string }>('SELECT source_funnel_id FROM funnels WHERE default_for_bot = true')).rows).toEqual([{ source_funnel_id: 'replacement-source' }])
      expect((await admin.listFunnels()).map((row) => row.funnel_key)).toEqual(['replacement'])
    } finally {
      await database.close()
    }
  })

  it('исключает opted-out и background-blocked пользователей из рассылки', async () => {
    const database = await PGlite.create({ extensions: { pgcrypto } })
    const pool = pglitePool(database)
    try {
      await applyMigrations(database)
      const store = new PostgresRuntimeStore(pool)
      await store.upsertUser({ platform: 'telegram', externalUserId: '101' })
      await store.upsertUser({ platform: 'telegram', externalUserId: '102' })
      await store.upsertUser({ platform: 'vk', externalUserId: '201' })
      await store.upsertUser({ platform: 'vk', externalUserId: '202' })
      await database.query("UPDATE telegram_users SET opted_out_at = now() WHERE external_user_id = '102'")
      await database.query("UPDATE telegram_users SET background_blocked = true WHERE external_user_id = '202'")

      const admin = new AdminRepository(pool, store)
      expect(await admin.listBroadcastRecipients('all')).toEqual([
        { platform: 'telegram', external_user_id: '101' },
        { platform: 'vk', external_user_id: '201' },
      ])
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
