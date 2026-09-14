import { createHash } from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'
import { validateForRuntime } from '../core/runtime-validation'
import { emptyAnalytics, type FunnelDocument, type MediaType, type ValidationIssue } from '../core/shared'
import type { ProductRuntimeConfig, ProductType, PaymentProviderName, VkMediaAttachment } from '../domain/types'
import { buildAnalyticsSnapshot } from '../analytics/snapshot'
import { toCsv } from '../analytics/csv'
import type { DatabasePool } from '../db/pool'
import type { PostgresRuntimeStore } from '../db/postgres-store'
import { parseVkAttachment, vkAttachmentTypeForMedia } from '../../../src/model/platformMedia'

export interface ImportedVersion {
  versionId: string
  funnelId: string
  created: boolean
  document: FunnelDocument
}

export interface EditorPublishResult extends ImportedVersion {
  published: boolean
  issues: ValidationIssue[]
}

export class AdminRepository {
  constructor(private readonly pool: DatabasePool, private readonly runtimeStore: PostgresRuntimeStore) {}

  async importDocument(document: FunnelDocument, adminTelegramId: string, options: { autoVersion?: boolean } = {}): Promise<ImportedVersion> {
    const vkOverrides = new Map<string, VkMediaAttachment>()
    for (const asset of document.assets) {
      const value = asset.platformRefs?.vk?.trim()
      if (!value) continue
      const attachment = parseVkAttachment(value)
      if (vkAttachmentTypeForMedia(asset.type) !== attachment.type) throw new Error(`MEDIA_TYPE_MISMATCH:${asset.type}`)
      vkOverrides.set(asset.id, attachment)
    }
    return this.runtimeStore.transaction(async (client) => {
      let funnel = await client.query<{ id: string }>('SELECT id FROM funnels WHERE source_funnel_id = $1 FOR UPDATE', [document.funnel.id])
      if (!funnel.rows[0]) {
        funnel = await client.query<{ id: string }>(`
          INSERT INTO funnels(funnel_key, source_funnel_id, name)
          VALUES ($1, $2, $3)
          RETURNING id
        `, [document.funnel.key, document.funnel.id, document.funnel.name])
      } else {
        await client.query('UPDATE funnels SET name = $2, updated_at = now(), archived_at = NULL WHERE id = $1', [funnel.rows[0].id, document.funnel.name])
      }
      const funnelId = funnel.rows[0]!.id
      let candidate = document
      if (options.autoVersion) {
        const latest = await client.query<{ id: string; version: number; raw_document: FunnelDocument }>(`
          SELECT id, version, raw_document
          FROM funnel_versions
          WHERE funnel_id = $1
          ORDER BY version DESC
          LIMIT 1
        `, [funnelId])
        const previous = latest.rows[0]
        if (previous && semanticDocumentHash(previous.raw_document) === semanticDocumentHash(document)) {
          return { versionId: previous.id, funnelId, created: false, document: previous.raw_document }
        }
        const nextVersion = (previous?.version ?? 0) + 1
        candidate = structuredClone(document)
        candidate.funnel.version = nextVersion
        candidate.funnel.parentVersion = previous?.version
        candidate.funnel.status = 'draft'
        candidate.funnel.updatedAt = new Date().toISOString()
        candidate.analytics = emptyAnalytics(nextVersion)
      }
      const hash = createHash('sha256').update(JSON.stringify(candidate)).digest('hex')
      const existing = await client.query<{ id: string; content_hash: string; raw_document: FunnelDocument }>(
        'SELECT id, content_hash, raw_document FROM funnel_versions WHERE funnel_id = $1 AND version = $2',
        [funnelId, candidate.funnel.version],
      )
      if (existing.rows[0]) {
        if (existing.rows[0].content_hash !== hash) throw new Error('VERSION_NUMBER_ALREADY_HAS_DIFFERENT_CONTENT')
        return { versionId: existing.rows[0].id, funnelId, created: false, document: existing.rows[0].raw_document }
      }
      const inserted = await client.query<{ id: string }>(`
        INSERT INTO funnel_versions(funnel_id, version, schema_version, status, content_hash, raw_document, imported_by)
        VALUES ($1, $2, $3, 'draft', $4, $5, $6)
        RETURNING id
      `, [funnelId, candidate.funnel.version, candidate.schemaVersion, hash, JSON.stringify(candidate), adminTelegramId])
      const versionId = inserted.rows[0]!.id
      const previous = await client.query<{ id: string; raw_document: FunnelDocument }>(`
        SELECT id, raw_document FROM funnel_versions
        WHERE funnel_id = $1 AND version < $2
        ORDER BY version DESC LIMIT 1
      `, [funnelId, candidate.funnel.version])
      const previousAssets = new Map((previous.rows[0]?.raw_document.assets ?? []).map((asset) => [asset.id, asset]))

      for (const asset of candidate.assets) {
        const oldAsset = previousAssets.get(asset.id)
        const copyTelegramBinding = oldAsset
          && oldAsset.key === asset.key
          && oldAsset.type === asset.type
          && oldAsset.logicalRef === asset.logicalRef
        if (copyTelegramBinding && previous.rows[0]) {
          await client.query(`
            INSERT INTO version_media_bindings(
              version_id, asset_id, asset_key, expected_type, platform, resource_id, verified_at,
              vk_attachment_type, vk_owner_id, vk_media_id, vk_access_key
            )
            SELECT $1, asset_id, $3, $4, platform, resource_id, verified_at,
                   vk_attachment_type, vk_owner_id, vk_media_id, vk_access_key
            FROM version_media_bindings
            WHERE version_id = $2 AND asset_id = $5 AND platform = 'telegram'
            ON CONFLICT (version_id, asset_id, platform) DO NOTHING
          `, [versionId, previous.rows[0].id, asset.key, asset.type, asset.id])
        }
        await client.query(`
          INSERT INTO version_media_bindings(version_id, asset_id, asset_key, expected_type, platform)
          VALUES ($1, $2, $3, $4, 'telegram')
          ON CONFLICT (version_id, asset_id, platform) DO NOTHING
        `, [versionId, asset.id, asset.key, asset.type])
        const vkOverride = vkOverrides.get(asset.id)
        if (vkOverride) {
          await upsertVkMediaBinding(client, versionId, asset.id, asset.key, asset.type, vkOverride)
        } else if (copyTelegramBinding && !oldAsset?.platformRefs?.vk?.trim() && previous.rows[0]) {
          await client.query(`
            INSERT INTO version_media_bindings(
              version_id, asset_id, asset_key, expected_type, platform,
              vk_attachment_type, vk_owner_id, vk_media_id, vk_access_key, verified_at
            )
            SELECT $1, asset_id, $3, $4, platform,
                   vk_attachment_type, vk_owner_id, vk_media_id, vk_access_key, verified_at
            FROM version_media_bindings
            WHERE version_id = $2 AND asset_id = $5 AND platform = 'vk'
            ON CONFLICT (version_id, asset_id, platform) DO NOTHING
          `, [versionId, previous.rows[0].id, asset.key, asset.type, asset.id])
        }
      }
      for (const product of candidate.products) {
        await client.query(`
          INSERT INTO runtime_product_configs(
            version_id, product_id, product_type, provider, currency, amount_minor,
            delivery_asset_ids, repeat_policy, after_purchase_text
          )
          VALUES ($1, $2, 'other', $6, 'RUB', $3, $4, 'redeliver', $5)
        `, [
          versionId,
          product.id,
          Math.round(product.price * 100),
          JSON.stringify(product.assetId ? [product.assetId] : []),
          product.afterPurchaseText,
          product.paymentProvider ?? 'unconfigured',
        ])
      }
      await client.query(`
        INSERT INTO admin_audit_log(admin_telegram_id, action, funnel_id, version_id, details)
        VALUES ($1, 'import_version', $2, $3, $4)
      `, [adminTelegramId, funnelId, versionId, JSON.stringify({ version: candidate.funnel.version, hash })])
      return { versionId, funnelId, created: true, document: candidate }
    })
  }

  async publishFromEditor(document: FunnelDocument, adminTelegramId: string): Promise<EditorPublishResult> {
    const imported = await this.importDocument(document, adminTelegramId, { autoVersion: true })
    const result = await this.publish(imported.versionId, adminTelegramId)
    if (!result.published) return { ...imported, published: false, issues: result.issues }
    await this.setDefault(imported.funnelId, adminTelegramId)
    const publishedDocument = structuredClone(imported.document)
    publishedDocument.funnel.status = 'published'
    return { ...imported, document: publishedDocument, published: true, issues: result.issues }
  }

  async publicationIssues(versionId: string, allowPlaceholders = false): Promise<ValidationIssue[]> {
    const version = await this.runtimeStore.getVersion(versionId)
    if (!version) throw new Error('VERSION_NOT_FOUND')
    const configs = await this.productConfigs(versionId)
    const trackingRows = await this.pool.query<{ code: string }>(`
      SELECT link->>'code' AS code
      FROM funnels f
      JOIN funnel_versions active ON active.id = f.active_version_id
      JOIN LATERAL jsonb_array_elements(active.raw_document->'bot'->'trackingLinks') link ON true
      WHERE f.id <> $1 AND COALESCE((link->>'active')::boolean, false) = true
    `, [version.funnelId])
    const issues = validateForRuntime(version.document, {
      productConfigs: configs,
      installedTrackingCodes: new Set(trackingRows.rows.map((row) => row.code)),
      allowPlaceholders,
    })
    if (Object.values(configs).some((config) => config.provider === 'yookassa_api')) {
      const integration = await this.pool.query<{ verified_at: Date | string | null }>("SELECT verified_at FROM payment_integrations WHERE provider = 'yookassa_api'")
      if (!integration.rows[0]) issues.push({
        severity: 'error', section: 'products', code: 'yookassa_api_unconfigured',
        message: 'Сначала подключите ЮKassa в разделе «Интеграции».',
      })
      else if (!integration.rows[0].verified_at) issues.push({
        severity: 'error', section: 'products', code: 'yookassa_api_unverified',
        message: 'Проверьте подключение ЮKassa в разделе «Интеграции».',
      })
    }
    if (!allowPlaceholders) {
      const missing = await this.pool.query<{ asset_name: string }>(`
        SELECT COALESCE(NULLIF(asset->>'name', ''), b.asset_key) AS asset_name
        FROM version_media_bindings b
        JOIN funnel_versions fv ON fv.id = b.version_id
        JOIN LATERAL jsonb_array_elements(fv.raw_document->'assets') asset ON asset->>'id' = b.asset_id
        WHERE b.version_id = $1
          AND COALESCE((asset->>'required')::boolean, false) = true
          AND b.platform = 'telegram'
          AND b.resource_id IS NULL
      `, [versionId])
      missing.rows.forEach((row) => issues.push({
        severity: 'error',
        section: 'media',
        code: 'runtime_media_binding_missing',
        message: `Не загружен обязательный файл «${row.asset_name}». Загрузите его через резервную Telegram-админку.`,
      }))
    }
    return issues
  }

  async publish(versionId: string, adminTelegramId: string, allowPlaceholders = false) {
    const issues = await this.publicationIssues(versionId, allowPlaceholders)
    const errors = issues.filter((issue) => issue.severity === 'error')
    if (errors.length) return { published: false as const, issues }
    await this.runtimeStore.transaction(async (client) => {
      const target = await client.query<{ funnel_id: string }>('SELECT funnel_id FROM funnel_versions WHERE id = $1 FOR UPDATE', [versionId])
      if (!target.rows[0]) throw new Error('VERSION_NOT_FOUND')
      const funnelId = target.rows[0].funnel_id
      await client.query(`
        UPDATE funnel_versions SET status = 'archived', archived_at = COALESCE(archived_at, now())
        WHERE id = (SELECT active_version_id FROM funnels WHERE id = $1) AND id <> $2
      `, [funnelId, versionId])
      await client.query(`
        UPDATE funnel_versions
        SET status = 'published', published_at = COALESCE(published_at, now()),
            archived_at = NULL, allow_placeholders = $2
        WHERE id = $1
      `, [versionId, allowPlaceholders])
      await client.query('UPDATE funnels SET active_version_id = $2, updated_at = now() WHERE id = $1', [funnelId, versionId])
      await client.query(`
        INSERT INTO admin_audit_log(admin_telegram_id, action, funnel_id, version_id, details)
        VALUES ($1, 'publish_version', $2, $3, $4)
      `, [adminTelegramId, funnelId, versionId, JSON.stringify({ allowPlaceholders })])
    })
    return { published: true as const, issues }
  }

  async setDefault(funnelId: string, adminTelegramId: string) {
    await this.runtimeStore.transaction(async (client) => {
      await client.query('UPDATE funnels SET default_for_bot = false WHERE default_for_bot = true')
      const result = await client.query('UPDATE funnels SET default_for_bot = true WHERE id = $1 AND active_version_id IS NOT NULL', [funnelId])
      if (!result.rowCount) throw new Error('FUNNEL_NOT_PUBLISHED')
      await client.query(`
        INSERT INTO admin_audit_log(admin_telegram_id, action, funnel_id)
        VALUES ($1, 'set_default_funnel', $2)
      `, [adminTelegramId, funnelId])
    })
  }

  async rollback(funnelId: string, versionId: string, adminTelegramId: string) {
    await this.runtimeStore.transaction(async (client) => {
      const target = await client.query('SELECT 1 FROM funnel_versions WHERE id = $1 AND funnel_id = $2 FOR UPDATE', [versionId, funnelId])
      if (!target.rowCount) throw new Error('VERSION_NOT_FOUND')
      await client.query(`UPDATE funnel_versions SET status = 'archived' WHERE id = (SELECT active_version_id FROM funnels WHERE id = $1) AND id <> $2`, [funnelId, versionId])
      await client.query(`UPDATE funnel_versions SET status = 'published', archived_at = NULL WHERE id = $1`, [versionId])
      await client.query('UPDATE funnels SET active_version_id = $2, updated_at = now() WHERE id = $1', [funnelId, versionId])
      await client.query(`
        INSERT INTO admin_audit_log(admin_telegram_id, action, funnel_id, version_id)
        VALUES ($1, 'rollback_version', $2, $3)
      `, [adminTelegramId, funnelId, versionId])
    })
  }

  async configureProduct(versionId: string, productId: string, input: {
    productType: ProductType
    provider: PaymentProviderName
    currency: string
    amountMinor: number
    deliveryAssetIds?: string[]
  }, adminTelegramId: string) {
    if (input.productType === 'digital' && input.provider === 'yookassa') throw new Error('DIGITAL_REQUIRES_STARS')
    if (input.provider === 'telegram_stars' && input.currency !== 'XTR') throw new Error('STARS_REQUIRES_XTR')
    if (input.provider === 'yookassa_api' && input.currency !== 'RUB') throw new Error('YOOKASSA_API_REQUIRES_RUB')
    await this.pool.query(`
      UPDATE runtime_product_configs
      SET product_type = $3, provider = $4, currency = $5, amount_minor = $6,
          delivery_asset_ids = COALESCE($7, delivery_asset_ids), configured_at = now()
      WHERE version_id = $1 AND product_id = $2
    `, [versionId, productId, input.productType, input.provider, input.currency, input.amountMinor, input.deliveryAssetIds ? JSON.stringify(input.deliveryAssetIds) : null])
    await this.pool.query(`
      INSERT INTO admin_audit_log(admin_telegram_id, action, version_id, details)
      VALUES ($1, 'configure_product', $2, $3)
    `, [adminTelegramId, versionId, JSON.stringify({ productId, ...input })])
  }

  async bindMedia(versionId: string, assetId: string, media: {
    type: MediaType
    fileId: string
    fileUniqueId?: string
    mimeType?: string
    fileSize?: number
  }, adminTelegramId: string) {
    const expected = await this.pool.query<{ expected_type: MediaType }>(
      "SELECT expected_type FROM version_media_bindings WHERE version_id = $1 AND asset_id = $2 AND platform = 'telegram'",
      [versionId, assetId],
    )
    if (!expected.rows[0]) throw new Error('ASSET_NOT_FOUND')
    if (expected.rows[0].expected_type !== media.type) throw new Error(`MEDIA_TYPE_MISMATCH:${expected.rows[0].expected_type}`)
    await this.runtimeStore.transaction(async (client) => {
      const resource = await client.query<{ id: string }>(`
        INSERT INTO media_resources(telegram_file_id, telegram_file_unique_id, media_type, mime_type, file_size, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, [media.fileId, media.fileUniqueId ?? null, media.type, media.mimeType ?? null, media.fileSize ?? null, adminTelegramId])
      await client.query(`
        UPDATE version_media_bindings
        SET resource_id = $3, verified_at = now(), updated_at = now()
        WHERE version_id = $1 AND asset_id = $2 AND platform = 'telegram'
      `, [versionId, assetId, resource.rows[0]!.id])
      await client.query(`
        INSERT INTO admin_audit_log(admin_telegram_id, action, version_id, details)
        VALUES ($1, 'bind_media', $2, $3)
      `, [adminTelegramId, versionId, JSON.stringify({ assetId, type: media.type, fileUniqueId: media.fileUniqueId })])
    })
  }

  async bindVkMedia(versionId: string, assetId: string, attachment: VkMediaAttachment, adminTelegramId: string) {
    const expected = await this.pool.query<{ asset_key: string; expected_type: MediaType }>(`
      SELECT asset_key, expected_type
      FROM version_media_bindings
      WHERE version_id = $1 AND asset_id = $2 AND platform = 'telegram'
    `, [versionId, assetId])
    const asset = expected.rows[0]
    if (!asset) throw new Error('ASSET_NOT_FOUND')
    if (vkAttachmentTypeForMedia(asset.expected_type) !== attachment.type) throw new Error(`MEDIA_TYPE_MISMATCH:${asset.expected_type}`)
    await this.runtimeStore.transaction(async (client) => {
      await upsertVkMediaBinding(client, versionId, assetId, asset.asset_key, asset.expected_type, attachment)
      await client.query(`
        INSERT INTO admin_audit_log(admin_telegram_id, action, version_id, details)
        VALUES ($1, 'bind_vk_media', $2, $3)
      `, [adminTelegramId, versionId, JSON.stringify({ assetId, type: attachment.type, ownerId: attachment.ownerId, mediaId: attachment.mediaId })])
    })
  }

  async unbindMedia(versionId: string, assetId: string, adminTelegramId: string, platform: 'telegram' | 'vk' = 'telegram') {
    if (platform === 'vk') {
      await this.pool.query("DELETE FROM version_media_bindings WHERE version_id = $1 AND asset_id = $2 AND platform = 'vk'", [versionId, assetId])
    } else {
      await this.pool.query("UPDATE version_media_bindings SET resource_id = NULL, verified_at = NULL, updated_at = now() WHERE version_id = $1 AND asset_id = $2 AND platform = 'telegram'", [versionId, assetId])
    }
    await this.pool.query(`
      INSERT INTO admin_audit_log(admin_telegram_id, action, version_id, details)
      VALUES ($1, 'unbind_media', $2, $3)
    `, [adminTelegramId, versionId, JSON.stringify({ assetId, platform })])
  }

  async listFunnels() {
    const result = await this.pool.query<FunnelListRow>(`
      SELECT f.id, f.name, f.funnel_key, f.default_for_bot, f.active_version_id,
             active.version AS active_version,
             count(DISTINCT fv.id)::int AS versions,
             count(DISTINCT s.id) FILTER (WHERE s.status IN ('active', 'waiting'))::int AS active_sessions
      FROM funnels f
      LEFT JOIN funnel_versions active ON active.id = f.active_version_id
      LEFT JOIN funnel_versions fv ON fv.funnel_id = f.id
      LEFT JOIN sessions s ON s.funnel_id = f.id
      WHERE f.archived_at IS NULL
      GROUP BY f.id, active.version
      ORDER BY f.created_at
    `)
    return result.rows
  }

  async listEditorFunnels() {
    const result = await this.pool.query<EditorFunnelRow>(`
      SELECT f.source_funnel_id, f.name, f.default_for_bot, f.updated_at,
             fv.version AS active_version, fv.published_at,
             jsonb_array_length(fv.raw_document->'nodes')::int AS node_count
      FROM funnels f
      JOIN funnel_versions fv ON fv.id = f.active_version_id
      WHERE fv.status = 'published' AND f.archived_at IS NULL
      ORDER BY f.updated_at DESC
    `)
    return result.rows.map((row) => ({
      id: row.source_funnel_id,
      name: row.name,
      activeVersion: row.active_version,
      updatedAt: new Date(row.updated_at).toISOString(),
      publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
      isDefault: row.default_for_bot,
      nodeCount: row.node_count,
    }))
  }

  async getEditorFunnel(sourceFunnelId: string) {
    const result = await this.pool.query<{ raw_document: FunnelDocument; version: number }>(`
      SELECT fv.raw_document, fv.version
      FROM funnels f
      JOIN funnel_versions fv ON fv.id = f.active_version_id
      WHERE f.source_funnel_id = $1 AND fv.status = 'published' AND f.archived_at IS NULL
    `, [sourceFunnelId])
    const row = result.rows[0]
    if (!row) return null
    const document = structuredClone(row.raw_document)
    document.funnel.version = row.version
    document.funnel.status = 'published'
    document.analytics = emptyAnalytics(row.version)
    return document
  }

  async deleteEditorFunnel(sourceFunnelId: string, _adminTelegramId: string) {
    return this.runtimeStore.transaction(async (client) => {
      const result = await client.query<{ id: string; default_for_bot: boolean }>(`
        SELECT id, default_for_bot
        FROM funnels
        WHERE source_funnel_id = $1
        FOR UPDATE
      `, [sourceFunnelId])
      const funnel = result.rows[0]
      if (!funnel) return null

      const media = await client.query<{ resource_id: string }>(`
        SELECT DISTINCT resource_id
        FROM version_media_bindings
        WHERE version_id IN (SELECT id FROM funnel_versions WHERE funnel_id = $1)
          AND resource_id IS NOT NULL
      `, [funnel.id])

      await client.query('UPDATE funnels SET default_for_bot = false, active_version_id = NULL WHERE id = $1', [funnel.id])

      let replacementSourceId: string | null = null
      if (funnel.default_for_bot) {
        const replacement = await client.query<{ id: string; source_funnel_id: string }>(`
          SELECT funnel.id, funnel.source_funnel_id
          FROM funnels funnel
          JOIN funnel_versions active ON active.id = funnel.active_version_id AND active.status = 'published'
          WHERE funnel.archived_at IS NULL AND funnel.id <> $1
          ORDER BY funnel.updated_at DESC
          LIMIT 1
          FOR UPDATE
        `, [funnel.id])
        if (replacement.rows[0]) {
          await client.query('UPDATE funnels SET default_for_bot = true WHERE id = $1', [replacement.rows[0].id])
          replacementSourceId = replacement.rows[0].source_funnel_id
        }
      }

      await client.query("DELETE FROM jobs WHERE payload->>'sessionId' IN (SELECT id::text FROM sessions WHERE funnel_id = $1)", [funnel.id])
      await client.query(`
        DELETE FROM content_deliveries
        WHERE purchase_id IN (
          SELECT purchase.id
          FROM purchases purchase
          JOIN payments payment ON payment.id = purchase.payment_id
          WHERE payment.funnel_id = $1
             OR payment.version_id IN (SELECT id FROM funnel_versions WHERE funnel_id = $1)
             OR payment.session_id IN (SELECT id FROM sessions WHERE funnel_id = $1)
             OR purchase.version_id IN (SELECT id FROM funnel_versions WHERE funnel_id = $1)
        )
      `, [funnel.id])
      await client.query(`
        DELETE FROM purchases
        WHERE payment_id IN (
          SELECT id FROM payments
          WHERE funnel_id = $1
             OR version_id IN (SELECT id FROM funnel_versions WHERE funnel_id = $1)
             OR session_id IN (SELECT id FROM sessions WHERE funnel_id = $1)
        )
           OR version_id IN (SELECT id FROM funnel_versions WHERE funnel_id = $1)
      `, [funnel.id])
      await client.query('DELETE FROM payments WHERE funnel_id = $1 OR version_id IN (SELECT id FROM funnel_versions WHERE funnel_id = $1) OR session_id IN (SELECT id FROM sessions WHERE funnel_id = $1)', [funnel.id])
      await client.query('DELETE FROM applications WHERE session_id IN (SELECT id FROM sessions WHERE funnel_id = $1)', [funnel.id])
      await client.query('DELETE FROM contacts WHERE funnel_id = $1 OR version_id IN (SELECT id FROM funnel_versions WHERE funnel_id = $1) OR session_id IN (SELECT id FROM sessions WHERE funnel_id = $1)', [funnel.id])
      await client.query('DELETE FROM consents WHERE session_id IN (SELECT id FROM sessions WHERE funnel_id = $1)', [funnel.id])
      await client.query('DELETE FROM answers WHERE session_id IN (SELECT id FROM sessions WHERE funnel_id = $1)', [funnel.id])
      await client.query('DELETE FROM test_runs WHERE session_id IN (SELECT id FROM sessions WHERE funnel_id = $1)', [funnel.id])
      await client.query('DELETE FROM callback_tokens WHERE session_id IN (SELECT id FROM sessions WHERE funnel_id = $1)', [funnel.id])
      await client.query('DELETE FROM redirect_tokens WHERE session_id IN (SELECT id FROM sessions WHERE funnel_id = $1)', [funnel.id])
      await client.query('DELETE FROM analytics_events WHERE funnel_id = $1 OR version_id IN (SELECT id FROM funnel_versions WHERE funnel_id = $1) OR session_id IN (SELECT id FROM sessions WHERE funnel_id = $1)', [funnel.id])
      await client.query('DELETE FROM sessions WHERE funnel_id = $1', [funnel.id])
      await client.query('DELETE FROM admin_audit_log WHERE funnel_id = $1 OR version_id IN (SELECT id FROM funnel_versions WHERE funnel_id = $1)', [funnel.id])
      await client.query('DELETE FROM runtime_product_configs WHERE version_id IN (SELECT id FROM funnel_versions WHERE funnel_id = $1)', [funnel.id])
      await client.query('DELETE FROM version_media_bindings WHERE version_id IN (SELECT id FROM funnel_versions WHERE funnel_id = $1)', [funnel.id])
      await client.query('DELETE FROM funnel_versions WHERE funnel_id = $1', [funnel.id])
      await client.query('DELETE FROM funnels WHERE id = $1', [funnel.id])

      const resourceIds = media.rows.map((row) => row.resource_id)
      if (resourceIds.length) {
        await client.query(`
          DELETE FROM media_resources resource
          WHERE resource.id = ANY($1::uuid[])
            AND NOT EXISTS (SELECT 1 FROM version_media_bindings binding WHERE binding.resource_id = resource.id)
        `, [resourceIds])
      }
      return { deleted: true as const, replacementSourceId }
    })
  }

  async listVersions(funnelId: string) {
    const result = await this.pool.query<VersionListRow>(`
      SELECT fv.id, fv.version, fv.status, fv.content_hash, fv.imported_at, fv.published_at,
             count(DISTINCT s.id) FILTER (WHERE s.status IN ('active', 'waiting'))::int AS active_sessions,
             count(DISTINCT b.asset_id) FILTER (WHERE b.platform = 'telegram' AND b.resource_id IS NULL)::int AS missing_media
      FROM funnel_versions fv
      LEFT JOIN sessions s ON s.version_id = fv.id
      LEFT JOIN version_media_bindings b ON b.version_id = fv.id
      WHERE fv.funnel_id = $1
      GROUP BY fv.id
      ORDER BY fv.version DESC
    `, [funnelId])
    return result.rows
  }

  async versionDetails(versionId: string) {
    const result = await this.pool.query<VersionDetailsRow>(`
      SELECT fv.id, fv.funnel_id, f.name AS funnel_name, fv.version, fv.status,
             fv.schema_version, fv.allow_placeholders, fv.imported_at, fv.published_at,
             f.default_for_bot, f.active_version_id = fv.id AS active
      FROM funnel_versions fv
      JOIN funnels f ON f.id = fv.funnel_id
      WHERE fv.id = $1
    `, [versionId])
    return result.rows[0] ?? null
  }

  async listMedia(versionId: string) {
    const result = await this.pool.query<MediaListRow>(`
      SELECT tg.asset_id, tg.asset_key, tg.expected_type,
             tg.resource_id IS NOT NULL AS bound,
             tg.resource_id IS NOT NULL AS telegram_bound,
             vk.vk_media_id IS NOT NULL AS vk_bound,
             r.telegram_file_id, r.file_size, r.mime_type,
             vk.vk_attachment_type, vk.vk_owner_id, vk.vk_media_id, vk.vk_access_key
      FROM version_media_bindings tg
      LEFT JOIN media_resources r ON r.id = tg.resource_id
      LEFT JOIN version_media_bindings vk
        ON vk.version_id = tg.version_id AND vk.asset_id = tg.asset_id AND vk.platform = 'vk'
      WHERE tg.version_id = $1 AND tg.platform = 'telegram'
      ORDER BY tg.asset_key
    `, [versionId])
    return result.rows
  }

  async listActiveTelegramMediaBindings() {
    const result = await this.pool.query<{
      funnel_name: string
      version: number
      asset_key: string
      telegram_file_id: string
    }>(`
      SELECT f.name AS funnel_name, fv.version, b.asset_key, r.telegram_file_id
      FROM funnels f
      JOIN funnel_versions fv ON fv.id = f.active_version_id
      JOIN version_media_bindings b ON b.version_id = fv.id AND b.platform = 'telegram'
      JOIN media_resources r ON r.id = b.resource_id
      WHERE f.archived_at IS NULL AND fv.status = 'published'
      ORDER BY f.name, b.asset_key
    `)
    return result.rows
  }

  async recentVkPeers(limit = 8) {
    const result = await this.pool.query<{
      peer_id: string
      first_name: string | null
      username: string | null
      last_seen_at: Date | string
    }>(`
      SELECT external_user_id AS peer_id, first_name, username, last_seen_at
      FROM telegram_users
      WHERE platform = 'vk'
      ORDER BY last_seen_at DESC
      LIMIT $1
    `, [Math.min(20, Math.max(1, limit))])
    return result.rows
  }

  async productConfigs(versionId: string) {
    const result = await this.pool.query<ProductConfigRow>('SELECT * FROM runtime_product_configs WHERE version_id = $1', [versionId])
    return Object.fromEntries(result.rows.map((row) => [row.product_id, {
      productId: row.product_id,
      productType: row.product_type,
      provider: row.provider,
      currency: row.currency,
      amountMinor: row.amount_minor,
      deliveryAssetIds: row.delivery_asset_ids,
      deliveryByResult: row.delivery_by_result,
      repeatPolicy: row.repeat_policy,
      afterPurchaseText: row.after_purchase_text,
    } satisfies ProductRuntimeConfig]))
  }

  async versionStats(versionId: string) {
    const result = await this.pool.query<{
      users: string
      active: string
      completed: string
      applications: string
      paid: string
    }>(`
      SELECT
        (SELECT count(DISTINCT user_id) FROM sessions WHERE version_id = $1)::text AS users,
        (SELECT count(*) FROM sessions WHERE version_id = $1 AND status IN ('active','waiting'))::text AS active,
        (SELECT count(*) FROM sessions WHERE version_id = $1 AND status = 'completed')::text AS completed,
        (SELECT count(*) FROM contacts WHERE version_id = $1)::text AS applications,
        (SELECT count(*) FROM payments WHERE version_id = $1 AND status = 'paid')::text AS paid
    `, [versionId])
    return result.rows[0]!
  }

  async overallStats() {
    const result = await this.pool.query<{
      users: string
      sessions: string
      active: string
      applications: string
      paid: string
      revenue_by_currency: Record<string, number>
    }>(`
      SELECT
        (SELECT count(*) FROM telegram_users)::text AS users,
        (SELECT count(*) FROM sessions)::text AS sessions,
        (SELECT count(*) FROM sessions WHERE status IN ('active','waiting'))::text AS active,
        (SELECT count(*) FROM applications)::text AS applications,
        (SELECT count(*) FROM payments WHERE status = 'paid')::text AS paid,
        (
          SELECT COALESCE(jsonb_object_agg(currency, amount_minor), '{}'::jsonb)
          FROM (
            SELECT currency, sum(amount_minor)::bigint AS amount_minor
            FROM payments WHERE status = 'paid'
            GROUP BY currency
          ) totals
        ) AS revenue_by_currency
    `)
    return result.rows[0]!
  }

  async recentContacts(limit = 10) {
    const result = await this.pool.query<{
      id: string
      telegram_id: string
      funnel_name: string
      version: number
      result_id: string | null
      fields: Record<string, string>
      created_at: Date
    }>(`
      SELECT c.id, u.telegram_id, f.name AS funnel_name, fv.version, c.result_id, c.fields, c.created_at
      FROM contacts c
      JOIN telegram_users u ON u.id = c.user_id
      JOIN funnels f ON f.id = c.funnel_id
      JOIN funnel_versions fv ON fv.id = c.version_id
      ORDER BY c.created_at DESC
      LIMIT $1
    `, [Math.min(50, Math.max(1, limit))])
    return result.rows
  }

  async recentApplications(limit = 10) {
    const result = await this.pool.query<{
      id: string
      telegram_id: string
      status: string
      payload: Record<string, string>
      created_at: Date
    }>(`
      SELECT a.id, u.telegram_id, a.status, a.payload, a.created_at
      FROM applications a
      JOIN contacts c ON c.id = a.contact_id
      JOIN telegram_users u ON u.id = c.user_id
      ORDER BY a.created_at DESC
      LIMIT $1
    `, [Math.min(50, Math.max(1, limit))])
    return result.rows
  }

  async recentPayments(limit = 10) {
    const result = await this.pool.query<{
      id: string
      telegram_id: string
      product_id: string
      provider: string
      amount_minor: number
      currency: string
      status: string
      created_at: Date
    }>(`
      SELECT p.id, u.telegram_id, p.product_id, p.provider, p.amount_minor, p.currency, p.status, p.created_at
      FROM payments p
      JOIN telegram_users u ON u.id = p.user_id
      ORDER BY p.created_at DESC
      LIMIT $1
    `, [Math.min(50, Math.max(1, limit))])
    return result.rows
  }

  async exportFunnel(versionId: string) {
    return buildAnalyticsSnapshot(this.pool, versionId)
  }

  async exportCsv(kind: 'contacts' | 'applications' | 'payments' | 'sources' | 'nodes' | 'tests', versionId?: string) {
    const filter = versionId ? 'WHERE version_id = $1' : ''
    const params = versionId ? [versionId] : []
    if (kind === 'contacts') {
      const result = await this.pool.query(`SELECT id, version_id, source_tracking_id, result_id, fields, created_at FROM contacts ${filter} ORDER BY created_at`, params)
      return toCsv(result.rows)
    }
    if (kind === 'applications') {
      const result = await this.pool.query(`
        SELECT a.id, c.version_id, a.status, a.payload, a.created_at
        FROM applications a JOIN contacts c ON c.id = a.contact_id
        ${versionId ? 'WHERE c.version_id = $1' : ''} ORDER BY a.created_at
      `, params)
      return toCsv(result.rows)
    }
    if (kind === 'payments') {
      const result = await this.pool.query(`SELECT id, version_id, product_id, provider, amount_minor, currency, status, created_at, paid_at, refunded_at FROM payments ${filter} ORDER BY created_at`, params)
      return toCsv(result.rows)
    }
    const eventTypes = kind === 'sources' ? ['source_attributed', 'session_started', 'session_completed', 'application_created', 'payment_succeeded']
      : kind === 'nodes' ? ['node_entered', 'node_completed', 'branch_selected']
        : ['test_started', 'question_viewed', 'question_answered', 'test_completed', 'result_viewed']
    const result = await this.pool.query(`
      SELECT version_id, event_type, node_id, tracking_id, payload, occurred_at
      FROM analytics_events
      WHERE event_type = ANY($1::text[])
        AND ($2::uuid IS NULL OR version_id = $2)
      ORDER BY occurred_at
    `, [eventTypes, versionId ?? null])
    return toCsv(result.rows)
  }

  async diagnostics() {
    const [failedJobs, pendingJobs, versions, sessions] = await Promise.all([
      this.pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM jobs WHERE status = 'failed'`),
      this.pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM jobs WHERE status = 'pending'`),
      this.pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM funnel_versions`),
      this.pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM sessions WHERE status IN ('active','waiting')`),
    ])
    return {
      failedJobs: Number(failedJobs.rows[0]!.count),
      pendingJobs: Number(pendingJobs.rows[0]!.count),
      versions: Number(versions.rows[0]!.count),
      activeSessions: Number(sessions.rows[0]!.count),
    }
  }
}

interface FunnelListRow extends QueryResultRow {
  id: string
  name: string
  funnel_key: string
  default_for_bot: boolean
  active_version_id: string | null
  active_version: number | null
  versions: number
  active_sessions: number
}

interface EditorFunnelRow extends QueryResultRow {
  source_funnel_id: string
  name: string
  default_for_bot: boolean
  updated_at: Date | string
  active_version: number
  published_at: Date | string | null
  node_count: number
}

interface VersionListRow extends QueryResultRow {
  id: string
  version: number
  status: string
  content_hash: string
  imported_at: Date
  published_at: Date | null
  active_sessions: number
  missing_media: number
}

interface VersionDetailsRow extends QueryResultRow {
  id: string
  funnel_id: string
  funnel_name: string
  version: number
  status: string
  schema_version: string
  allow_placeholders: boolean
  imported_at: Date
  published_at: Date | null
  default_for_bot: boolean
  active: boolean
}

interface MediaListRow extends QueryResultRow {
  asset_id: string
  asset_key: string
  expected_type: MediaType
  bound: boolean
  telegram_bound: boolean
  vk_bound: boolean
  telegram_file_id: string | null
  file_size: string | null
  mime_type: string | null
  vk_attachment_type: string | null
  vk_owner_id: string | null
  vk_media_id: string | null
  vk_access_key: string | null
}

async function upsertVkMediaBinding(
  client: Pick<PoolClient, 'query'>,
  versionId: string,
  assetId: string,
  assetKey: string,
  expectedType: MediaType,
  attachment: VkMediaAttachment,
) {
  await client.query(`
    INSERT INTO version_media_bindings(
      version_id, asset_id, asset_key, expected_type, platform,
      vk_attachment_type, vk_owner_id, vk_media_id, vk_access_key, verified_at
    )
    VALUES ($1, $2, $3, $4, 'vk', $5, $6, $7, $8, now())
    ON CONFLICT (version_id, asset_id, platform) DO UPDATE SET
      asset_key = EXCLUDED.asset_key,
      expected_type = EXCLUDED.expected_type,
      vk_attachment_type = EXCLUDED.vk_attachment_type,
      vk_owner_id = EXCLUDED.vk_owner_id,
      vk_media_id = EXCLUDED.vk_media_id,
      vk_access_key = EXCLUDED.vk_access_key,
      verified_at = now(), updated_at = now()
  `, [versionId, assetId, assetKey, expectedType, attachment.type, attachment.ownerId, attachment.mediaId, attachment.accessKey ?? null])
}

interface ProductConfigRow extends QueryResultRow {
  product_id: string
  product_type: ProductType
  provider: PaymentProviderName
  currency: string
  amount_minor: number
  delivery_asset_ids: string[]
  delivery_by_result: Record<string, string[]>
  repeat_policy: ProductRuntimeConfig['repeatPolicy']
  after_purchase_text: string
}

function semanticDocumentHash(document: FunnelDocument) {
  const comparable = structuredClone(document) as FunnelDocument
  delete comparable.funnel.parentVersion
  delete comparable.funnel.changeComment
  comparable.funnel.version = 1
  comparable.funnel.status = 'draft'
  comparable.funnel.createdAt = ''
  comparable.funnel.updatedAt = ''
  comparable.analytics = emptyAnalytics(1)
  comparable.editor = { nodePositions: {}, collapsedNodeIds: [] }
  return createHash('sha256').update(canonicalJson(comparable)).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
