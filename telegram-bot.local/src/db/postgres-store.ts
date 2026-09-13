import { createHash, randomBytes } from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'
import type { FunnelDocument } from '../core/shared'
import type {
  AnalyticsEvent,
  CallbackAction,
  CallbackRecord,
  DurableJob,
  FunnelVersionRecord,
  MediaBinding,
  PaymentRecord,
  ProductRuntimeConfig,
  RedirectRecord,
  RuntimeSession,
  RuntimeUser,
  Platform,
  PlatformProfile,
  VkAttachmentType,
} from '../domain/types'
import type { RuntimeStore } from '../runtime/store'
import type { DatabasePool } from './pool'

export class PostgresRuntimeStore implements RuntimeStore {
  constructor(readonly pool: DatabasePool) {}

  async reserveUpdate(platform: Platform, updateId: string) {
    const result = await this.pool.query('INSERT INTO processed_updates(platform, external_update_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [platform, updateId])
    return Boolean(result.rowCount)
  }

  async upsertUser(profile: PlatformProfile) {
    const result = await this.pool.query<UserRow>(`
      INSERT INTO telegram_users(platform, external_user_id, telegram_id, username, first_name, last_name, language_code)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (platform, external_user_id) DO UPDATE SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        language_code = EXCLUDED.language_code,
        last_seen_at = now()
      RETURNING *
    `, [profile.platform, profile.externalUserId, profile.platform === 'telegram' ? profile.externalUserId : null, profile.username ?? null, profile.firstName ?? null, profile.lastName ?? null, profile.languageCode ?? null])
    return mapUser(result.rows[0]!)
  }

  async getUser(userId: string) {
    const result = await this.pool.query<UserRow>('SELECT * FROM telegram_users WHERE id = $1', [userId])
    return result.rows[0] ? mapUser(result.rows[0]) : null
  }

  async getUserByPlatformIdentity(platform: Platform, externalUserId: string) {
    const result = await this.pool.query<UserRow>('SELECT * FROM telegram_users WHERE platform = $1 AND external_user_id = $2', [platform, externalUserId])
    return result.rows[0] ? mapUser(result.rows[0]) : null
  }

  async setOptOut(userId: string, optedOut: boolean, blockBackground: boolean) {
    await this.pool.query(`
      UPDATE telegram_users
      SET opted_out_at = CASE WHEN $2 THEN now() ELSE NULL END,
          background_blocked = $2 AND $3,
          last_seen_at = now()
      WHERE id = $1
    `, [userId, optedOut, blockBackground])
  }

  async stopUserSessions(userId: string) {
    const result = await this.pool.query<{ id: string }>(`
      UPDATE sessions
      SET status = 'stopped', stopped_at = now(), last_activity_at = now(), revision = revision + 1
      WHERE user_id = $1 AND status IN ('active', 'waiting')
      RETURNING id
    `, [userId])
    return result.rows.map((row) => row.id)
  }

  async resolveVersion(trackingCode?: string) {
    if (trackingCode) {
      const result = await this.pool.query<VersionRow & { tracking_id: string }>(`
        SELECT fv.*, f.id AS runtime_funnel_id, link->>'id' AS tracking_id
        FROM funnels f
        JOIN funnel_versions fv ON fv.id = f.active_version_id
        JOIN LATERAL jsonb_array_elements(fv.raw_document->'bot'->'trackingLinks') link ON true
        WHERE link->>'code' = $1
          AND COALESCE((link->>'active')::boolean, false) = true
        LIMIT 1
      `, [trackingCode])
      const row = result.rows[0]
      return row ? { version: mapVersion(row), trackingId: row.tracking_id } : null
    }
    const result = await this.pool.query<VersionRow>(`
      SELECT fv.*, f.id AS runtime_funnel_id
      FROM funnels f
      JOIN funnel_versions fv ON fv.id = f.active_version_id
      WHERE f.default_for_bot = true
      LIMIT 1
    `)
    return result.rows[0] ? { version: mapVersion(result.rows[0]) } : null
  }

  async getVersion(versionId: string) {
    const result = await this.pool.query<VersionRow>(`
      SELECT fv.*, f.id AS runtime_funnel_id
      FROM funnel_versions fv
      JOIN funnels f ON f.id = fv.funnel_id
      WHERE fv.id = $1
    `, [versionId])
    return result.rows[0] ? mapVersion(result.rows[0]) : null
  }

  async resolveVersionByFunnel(funnelId: string) {
    const result = await this.pool.query<VersionRow>(`
      SELECT fv.*, f.id AS runtime_funnel_id
      FROM funnels f
      JOIN funnel_versions fv ON fv.id = f.active_version_id
      WHERE f.id = $1
    `, [funnelId])
    return result.rows[0] ? mapVersion(result.rows[0]) : null
  }

  async findActiveSession(userId: string, funnelId: string) {
    const result = await this.pool.query<SessionRow>(`
      SELECT * FROM sessions
      WHERE user_id = $1 AND funnel_id = $2 AND status IN ('active', 'waiting')
      ORDER BY started_at DESC
      LIMIT 1
    `, [userId, funnelId])
    return result.rows[0] ? mapSession(result.rows[0]) : null
  }

  async findAnyActiveSession(userId: string) {
    const result = await this.pool.query<SessionRow>(`
      SELECT * FROM sessions
      WHERE user_id = $1 AND status IN ('active', 'waiting')
      ORDER BY last_activity_at DESC
      LIMIT 1
    `, [userId])
    return result.rows[0] ? mapSession(result.rows[0]) : null
  }

  async findLatestSession(userId: string, funnelId: string) {
    const result = await this.pool.query<SessionRow>(`
      SELECT * FROM sessions
      WHERE user_id = $1 AND funnel_id = $2
      ORDER BY last_activity_at DESC
      LIMIT 1
    `, [userId, funnelId])
    return result.rows[0] ? mapSession(result.rows[0]) : null
  }

  async getSession(sessionId: string) {
    const result = await this.pool.query<SessionRow>('SELECT * FROM sessions WHERE id = $1', [sessionId])
    return result.rows[0] ? mapSession(result.rows[0]) : null
  }

  async createSession(input: Omit<RuntimeSession, 'id' | 'revision' | 'startedAt' | 'lastActivityAt'>) {
    const result = await this.pool.query<SessionRow>(`
      INSERT INTO sessions(user_id, funnel_id, version_id, status, current_node_id, source_tracking_id, source_code, state)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [input.userId, input.funnelId, input.versionId, input.status, input.currentNodeId, input.sourceTrackingId ?? null, input.sourceCode ?? null, JSON.stringify(input.state)])
    return mapSession(result.rows[0]!)
  }

  async saveSession(session: RuntimeSession, expectedRevision: number) {
    const result = await this.pool.query<SessionRow>(`
      UPDATE sessions
      SET status = $2,
          current_node_id = $3,
          state = $4,
          revision = revision + 1,
          last_activity_at = now(),
          completed_at = CASE WHEN $2 = 'completed' THEN COALESCE(completed_at, now()) ELSE completed_at END
      WHERE id = $1 AND revision = $5
      RETURNING *
    `, [session.id, session.status, session.currentNodeId, JSON.stringify(session.state), expectedRevision])
    if (!result.rows[0]) throw new Error('SESSION_CONFLICT')
    return mapSession(result.rows[0])
  }

  async abandonSession(sessionId: string) {
    await this.pool.query(`
      UPDATE sessions SET status = 'abandoned', last_activity_at = now(), revision = revision + 1
      WHERE id = $1 AND status IN ('active', 'waiting')
    `, [sessionId])
  }

  async createCallback(userId: string, sessionId: string | undefined, action: CallbackAction, ttlSeconds = 86_400) {
    const token = randomBytes(12).toString('base64url')
    await this.pool.query(`
      INSERT INTO callback_tokens(token, user_id, session_id, action, expires_at)
      VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)
    `, [token, userId, sessionId ?? null, JSON.stringify(action), ttlSeconds])
    return token
  }

  async consumeCallback(token: string, userId: string) {
    const result = await this.pool.query<CallbackRow>(`
      UPDATE callback_tokens
      SET consumed_at = now()
      WHERE token = $1 AND user_id = $2 AND consumed_at IS NULL AND expires_at > now()
      RETURNING *
    `, [token, userId])
    return result.rows[0] ? mapCallback(result.rows[0]) : null
  }

  async createRedirect(userId: string, sessionId: string, targetUrl: string, continueAfterClick: boolean, ttlSeconds = 3600) {
    const parsed = new URL(targetUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('UNSAFE_REDIRECT')
    const token = randomBytes(18).toString('base64url')
    await this.pool.query(`
      INSERT INTO redirect_tokens(token, user_id, session_id, target_url, continue_after_click, expires_at)
      VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' seconds')::interval)
    `, [token, userId, sessionId, parsed.toString(), continueAfterClick, ttlSeconds])
    return token
  }

  async consumeRedirect(token: string) {
    const result = await this.pool.query<RedirectRow>(`
      UPDATE redirect_tokens
      SET click_count = click_count + 1,
          first_clicked_at = COALESCE(first_clicked_at, now())
      WHERE token = $1 AND expires_at > now() AND click_count < max_clicks
      RETURNING *
    `, [token])
    return result.rows[0] ? mapRedirect(result.rows[0]) : null
  }

  async getMediaBinding(versionId: string, assetId: string, platform: Platform) {
    const result = await this.pool.query<MediaRow>(`
      SELECT b.asset_id, b.asset_key, b.expected_type, b.platform,
             b.vk_attachment_type, b.vk_owner_id, b.vk_media_id, b.vk_access_key,
             r.telegram_file_id, r.telegram_file_unique_id, r.mime_type, r.file_size
      FROM version_media_bindings b
      LEFT JOIN media_resources r ON r.id = b.resource_id
      WHERE b.version_id = $1 AND b.asset_id = $2 AND b.platform = $3
        AND (b.platform <> 'telegram' OR r.telegram_file_id IS NOT NULL)
    `, [versionId, assetId, platform])
    return result.rows[0] ? mapMedia(result.rows[0]) : null
  }

  async getProductConfig(versionId: string, productId: string) {
    const result = await this.pool.query<ProductConfigRow>(`
      SELECT * FROM runtime_product_configs WHERE version_id = $1 AND product_id = $2
    `, [versionId, productId])
    return result.rows[0] ? mapProductConfig(result.rows[0]) : null
  }

  async scheduleJob(job: Omit<DurableJob, 'id' | 'attempts'>) {
    await this.pool.query(`
      INSERT INTO jobs(unique_key, job_type, payload, due_at, max_attempts)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (unique_key) DO NOTHING
    `, [job.uniqueKey, job.type, JSON.stringify(job.payload), job.dueAt, job.maxAttempts])
  }

  async cancelSessionJobs(sessionId: string, types?: DurableJob['type'][]) {
    const result = await this.pool.query(`
      UPDATE jobs SET status = 'cancelled', completed_at = now()
      WHERE status = 'pending'
        AND payload->>'sessionId' = $1
        AND ($2::text[] IS NULL OR job_type = ANY($2::text[]))
    `, [sessionId, types ?? null])
    return result.rowCount ?? 0
  }

  async claimDueJobs(workerId: string, limit = 20) {
    const result = await this.pool.query<JobRow>(`
      WITH due AS (
        SELECT id
        FROM jobs
        WHERE status = 'pending' AND due_at <= now()
        ORDER BY due_at
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      )
      UPDATE jobs j
      SET status = 'running', locked_at = now(), locked_by = $1, attempts = attempts + 1
      FROM due
      WHERE j.id = due.id
      RETURNING j.*
    `, [workerId, limit])
    return result.rows.map(mapJob)
  }

  async completeJob(jobId: string) {
    await this.pool.query(`UPDATE jobs SET status = 'completed', completed_at = now(), locked_at = NULL, locked_by = NULL WHERE id = $1`, [jobId])
  }

  async failJob(jobId: string, error: string) {
    await this.pool.query(`
      UPDATE jobs
      SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
          due_at = CASE WHEN attempts >= max_attempts THEN due_at ELSE now() + (LEAST(300, power(2, attempts)) || ' seconds')::interval END,
          last_error = left($2, 1000),
          locked_at = NULL,
          locked_by = NULL
      WHERE id = $1
    `, [jobId, error])
  }

  async appendEvent(event: AnalyticsEvent) {
    await this.pool.query(`
      INSERT INTO analytics_events(idempotency_key, event_type, user_id, session_id, funnel_id, version_id, node_id, tracking_id, payload, occurred_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, now()))
      ON CONFLICT (idempotency_key) DO NOTHING
    `, [
      event.idempotencyKey,
      event.type,
      event.userId ?? null,
      event.sessionId ?? null,
      event.funnelId ?? null,
      event.versionId ?? null,
      event.nodeId ?? null,
      event.trackingId ?? null,
      JSON.stringify(event.payload ?? {}),
      event.occurredAt ?? null,
    ])
  }

  async saveAnswer(sessionId: string, testId: string, questionId: string, value: unknown) {
    await this.pool.query(`
      INSERT INTO answers(session_id, test_id, question_id, value)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (session_id, test_id, question_id)
      DO UPDATE SET value = EXCLUDED.value, created_at = now()
    `, [sessionId, testId, questionId, JSON.stringify(value)])
  }

  async saveConsent(session: RuntimeSession, nodeId: string, accepted: boolean, policyUrl: string, text: string) {
    const version = await this.getVersion(session.versionId)
    await this.pool.query(`
      INSERT INTO consents(session_id, node_id, accepted, policy_url, consent_text, funnel_version)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (session_id, node_id)
      DO UPDATE SET accepted = EXCLUDED.accepted,
        policy_url = EXCLUDED.policy_url,
        consent_text = EXCLUDED.consent_text,
        funnel_version = EXCLUDED.funnel_version,
        created_at = now()
    `, [session.id, nodeId, accepted, policyUrl || null, text, version?.document.funnel.version ?? 1])
  }

  async saveContactAndApplication(session: RuntimeSession, fields: Record<string, string>) {
    return this.transaction(async (client) => {
      const contact = await client.query<{ id: string }>(`
        INSERT INTO contacts(session_id, user_id, funnel_id, version_id, source_tracking_id, result_id, fields)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (session_id)
        DO UPDATE SET fields = EXCLUDED.fields,
          source_tracking_id = EXCLUDED.source_tracking_id,
          result_id = EXCLUDED.result_id
        RETURNING id
      `, [session.id, session.userId, session.funnelId, session.versionId, session.sourceTrackingId ?? null, session.state.lastResultId ?? null, JSON.stringify(fields)])
      const application = await client.query<{ id: string }>(`
        INSERT INTO applications(contact_id, session_id, payload)
        VALUES ($1, $2, $3)
        ON CONFLICT (session_id)
        DO UPDATE SET contact_id = EXCLUDED.contact_id, payload = EXCLUDED.payload
        RETURNING id
      `, [contact.rows[0]!.id, session.id, JSON.stringify(fields)])
      return { contactId: contact.rows[0]!.id, applicationId: application.rows[0]!.id }
    })
  }

  async hasPurchase(userId: string, versionId: string, productId: string) {
    const result = await this.pool.query('SELECT 1 FROM purchases WHERE user_id = $1 AND version_id = $2 AND product_id = $3', [userId, versionId, productId])
    return Boolean(result.rowCount)
  }

  async createPayment(input: Omit<PaymentRecord, 'id' | 'status'>) {
    const result = await this.pool.query<PaymentRow>(`
      INSERT INTO payments(idempotency_key, user_id, session_id, funnel_id, version_id, product_id, provider, invoice_payload, amount_minor, currency, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
      ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
      RETURNING *
    `, [input.idempotencyKey, input.userId, input.sessionId, input.funnelId, input.versionId, input.productId, input.provider, input.invoicePayload, input.amountMinor, input.currency])
    return mapPayment(result.rows[0]!)
  }

  async getPaymentByPayload(payload: string) {
    const result = await this.pool.query<PaymentRow>('SELECT * FROM payments WHERE invoice_payload = $1', [payload])
    return result.rows[0] ? mapPayment(result.rows[0]) : null
  }

  async markPaymentPaid(paymentId: string, telegramChargeId: string, providerChargeId?: string) {
    return this.transaction(async (client) => {
      const locked = await client.query<PaymentRow>('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId])
      const current = locked.rows[0]
      if (!current) throw new Error('PAYMENT_NOT_FOUND')
      if (current.status === 'paid') return { payment: mapPayment(current), firstSuccess: false }
      const updated = await client.query<PaymentRow>(`
        UPDATE payments SET status = 'paid', telegram_payment_charge_id = $2,
          provider_payment_charge_id = $3, paid_at = now()
        WHERE id = $1
        RETURNING *
      `, [paymentId, telegramChargeId, providerChargeId ?? null])
      return { payment: mapPayment(updated.rows[0]!), firstSuccess: true }
    })
  }

  async recordPurchase(payment: PaymentRecord) {
    const result = await this.pool.query<{ id: string; inserted: boolean }>(`
      WITH inserted AS (
        INSERT INTO purchases(payment_id, user_id, version_id, product_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, version_id, product_id) DO NOTHING
        RETURNING id
      )
      SELECT id, true AS inserted FROM inserted
      UNION ALL
      SELECT id, false AS inserted FROM purchases
      WHERE user_id = $2 AND version_id = $3 AND product_id = $4
      LIMIT 1
    `, [payment.id, payment.userId, payment.versionId, payment.productId])
    return { purchaseId: result.rows[0]!.id, created: result.rows[0]!.inserted }
  }

  async isDelivered(purchaseId: string, assetId: string) {
    const result = await this.pool.query(
      'SELECT 1 FROM content_deliveries WHERE purchase_id = $1 AND asset_id = $2',
      [purchaseId, assetId],
    )
    return Boolean(result.rowCount)
  }

  async markDelivered(purchaseId: string, assetId: string, deliveryKey: string) {
    const result = await this.pool.query(`
      INSERT INTO content_deliveries(purchase_id, asset_id, delivery_key)
      VALUES ($1, $2, $3)
      ON CONFLICT (delivery_key) DO NOTHING
    `, [purchaseId, assetId, deliveryKey])
    return Boolean(result.rowCount)
  }

  async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await action(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}

interface UserRow extends QueryResultRow {
  id: string
  platform: Platform
  external_user_id: string
  telegram_id: string | null
  username: string | null
  first_name: string | null
  opted_out_at: Date | string | null
  background_blocked: boolean
}

interface VersionRow extends QueryResultRow {
  id: string
  runtime_funnel_id: string
  raw_document: FunnelDocument
  status: 'draft' | 'published' | 'archived'
  allow_placeholders: boolean
  content_hash: string
}

interface SessionRow extends QueryResultRow {
  id: string
  user_id: string
  funnel_id: string
  version_id: string
  status: RuntimeSession['status']
  current_node_id: string | null
  source_tracking_id: string | null
  source_code: string | null
  state: RuntimeSession['state']
  revision: number
  started_at: Date | string
  last_activity_at: Date | string
}

interface CallbackRow extends QueryResultRow {
  token: string
  user_id: string
  session_id: string | null
  action: CallbackAction
  expires_at: Date | string
  consumed_at: Date | string | null
}

interface RedirectRow extends QueryResultRow {
  token: string
  user_id: string
  session_id: string
  target_url: string
  continue_after_click: boolean
  expires_at: Date | string
}

interface MediaRow extends QueryResultRow {
  asset_id: string
  asset_key: string
  expected_type: MediaBinding['expectedType']
  platform: Platform
  telegram_file_id: string | null
  telegram_file_unique_id: string | null
  mime_type: string | null
  file_size: string | null
  vk_attachment_type: VkAttachmentType | null
  vk_owner_id: string | number | null
  vk_media_id: string | number | null
  vk_access_key: string | null
}

interface ProductConfigRow extends QueryResultRow {
  product_id: string
  product_type: ProductRuntimeConfig['productType']
  provider: ProductRuntimeConfig['provider']
  currency: string
  amount_minor: number
  delivery_asset_ids: string[]
  delivery_by_result: Record<string, string[]>
  repeat_policy: ProductRuntimeConfig['repeatPolicy']
  after_purchase_text: string
}

interface JobRow extends QueryResultRow {
  id: string
  unique_key: string
  job_type: DurableJob['type']
  payload: Record<string, unknown>
  due_at: Date | string
  attempts: number
  max_attempts: number
}

interface PaymentRow extends QueryResultRow {
  id: string
  idempotency_key: string
  user_id: string
  session_id: string
  version_id: string
  funnel_id: string
  product_id: string
  provider: PaymentRecord['provider']
  invoice_payload: string
  amount_minor: number
  currency: string
  status: PaymentRecord['status']
}

function mapUser(row: UserRow): RuntimeUser {
  return {
    id: row.id,
    platform: row.platform,
    externalUserId: row.external_user_id,
    username: row.username ?? undefined,
    firstName: row.first_name ?? undefined,
    optedOutAt: row.opted_out_at ? new Date(row.opted_out_at).toISOString() : null,
    backgroundBlocked: row.background_blocked,
  }
}

function mapVersion(row: VersionRow): FunnelVersionRecord {
  return {
    id: row.id,
    funnelId: row.runtime_funnel_id,
    document: row.raw_document,
    status: row.status,
    allowPlaceholders: row.allow_placeholders,
    contentHash: row.content_hash,
  }
}

function mapSession(row: SessionRow): RuntimeSession {
  return {
    id: row.id,
    userId: row.user_id,
    funnelId: row.funnel_id,
    versionId: row.version_id,
    status: row.status,
    currentNodeId: row.current_node_id,
    sourceTrackingId: row.source_tracking_id ?? undefined,
    sourceCode: row.source_code ?? undefined,
    state: row.state,
    revision: row.revision,
    startedAt: new Date(row.started_at).toISOString(),
    lastActivityAt: new Date(row.last_activity_at).toISOString(),
  }
}

function mapCallback(row: CallbackRow): CallbackRecord {
  return {
    token: row.token,
    userId: row.user_id,
    sessionId: row.session_id ?? undefined,
    action: row.action,
    expiresAt: new Date(row.expires_at).toISOString(),
    consumedAt: row.consumed_at ? new Date(row.consumed_at).toISOString() : undefined,
  }
}

function mapRedirect(row: RedirectRow): RedirectRecord {
  return {
    token: row.token,
    userId: row.user_id,
    sessionId: row.session_id,
    targetUrl: row.target_url,
    continueAfterClick: row.continue_after_click,
    expiresAt: new Date(row.expires_at).toISOString(),
  }
}

function mapMedia(row: MediaRow): MediaBinding {
  if (row.platform === 'vk') {
    if (!row.vk_attachment_type || row.vk_owner_id === null || row.vk_media_id === null) throw new Error('VK_MEDIA_BINDING_INVALID')
    return {
      assetId: row.asset_id,
      assetKey: row.asset_key,
      expectedType: row.expected_type,
      platform: 'vk',
      attachment: {
        type: row.vk_attachment_type,
        ownerId: Number(row.vk_owner_id),
        mediaId: Number(row.vk_media_id),
        accessKey: row.vk_access_key ?? undefined,
      },
    }
  }
  if (!row.telegram_file_id) throw new Error('TELEGRAM_MEDIA_BINDING_INVALID')
  return {
    assetId: row.asset_id,
    assetKey: row.asset_key,
    expectedType: row.expected_type,
    platform: 'telegram',
    telegramFileId: row.telegram_file_id,
    telegramFileUniqueId: row.telegram_file_unique_id ?? undefined,
    mimeType: row.mime_type ?? undefined,
    fileSize: row.file_size ? Number(row.file_size) : undefined,
  }
}

function mapProductConfig(row: ProductConfigRow): ProductRuntimeConfig {
  return {
    productId: row.product_id,
    productType: row.product_type,
    provider: row.provider,
    currency: row.currency,
    amountMinor: row.amount_minor,
    deliveryAssetIds: row.delivery_asset_ids ?? [],
    deliveryByResult: row.delivery_by_result ?? {},
    repeatPolicy: row.repeat_policy,
    afterPurchaseText: row.after_purchase_text,
  }
}

function mapJob(row: JobRow): DurableJob {
  return {
    id: row.id,
    uniqueKey: row.unique_key,
    type: row.job_type,
    payload: row.payload,
    dueAt: new Date(row.due_at).toISOString(),
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  }
}

function mapPayment(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    userId: row.user_id,
    sessionId: row.session_id,
    versionId: row.version_id,
    funnelId: row.funnel_id,
    productId: row.product_id,
    provider: row.provider,
    invoicePayload: row.invoice_payload,
    amountMinor: row.amount_minor,
    currency: row.currency,
    status: row.status,
  }
}

export function documentHash(document: FunnelDocument) {
  return createHash('sha256').update(JSON.stringify(document)).digest('hex')
}
