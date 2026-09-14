import { createHash, randomBytes, randomUUID } from 'node:crypto'
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
} from '../domain/types'
import type { RuntimeStore } from './store'

export class MemoryRuntimeStore implements RuntimeStore {
  readonly users = new Map<string, RuntimeUser>()
  readonly versions = new Map<string, FunnelVersionRecord>()
  readonly sessions = new Map<string, RuntimeSession>()
  readonly callbacks = new Map<string, CallbackRecord>()
  readonly redirects = new Map<string, RedirectRecord>()
  readonly media = new Map<string, MediaBinding>()
  readonly productConfigs = new Map<string, ProductRuntimeConfig>()
  readonly jobs = new Map<string, DurableJob & { status: string }>()
  readonly events: AnalyticsEvent[] = []
  readonly answers: Array<{ sessionId: string; testId: string; questionId: string; value: unknown }> = []
  readonly consents: Array<Record<string, unknown>> = []
  readonly contacts: Array<Record<string, unknown>> = []
  readonly applications: Array<Record<string, unknown>> = []
  readonly payments = new Map<string, PaymentRecord>()
  readonly purchases = new Map<string, { id: string; paymentId: string }>()
  readonly deliveries = new Set<string>()
  private readonly deliveredAssets = new Set<string>()
  readonly processedUpdates = new Set<string>()
  private defaultVersionId: string | null = null
  private activeVersionByFunnel = new Map<string, string>()
  private tracking = new Map<string, { versionId: string; trackingId: string }>()

  install(document: FunnelDocument, options: { published?: boolean; default?: boolean; allowPlaceholders?: boolean; productConfigs?: ProductRuntimeConfig[] } = {}) {
    const id = `version_${document.funnel.id}_${document.funnel.version}`
    const record: FunnelVersionRecord = {
      id,
      funnelId: document.funnel.id,
      document: structuredClone(document),
      status: options.published === false ? 'draft' : 'published',
      allowPlaceholders: options.allowPlaceholders ?? true,
      contentHash: createHash('sha256').update(JSON.stringify(document)).digest('hex'),
    }
    this.versions.set(id, record)
    if (record.status === 'published') this.activeVersionByFunnel.set(record.funnelId, id)
    if (options.default !== false) this.defaultVersionId = id
    document.bot.trackingLinks.filter((link) => link.active).forEach((link) => this.tracking.set(link.code, { versionId: id, trackingId: link.id }))
    options.productConfigs?.forEach((config) => this.productConfigs.set(`${id}:${config.productId}`, structuredClone(config)))
    return record
  }

  bindMedia(versionId: string, binding: MediaBinding) {
    this.media.set(`${versionId}:${binding.assetId}:${binding.platform}`, structuredClone(binding))
  }

  async reserveUpdate(platform: Platform, updateId: string) {
    const key = `${platform}:${updateId}`
    if (this.processedUpdates.has(key)) return false
    this.processedUpdates.add(key)
    return true
  }

  async upsertUser(profile: PlatformProfile) {
    const existing = [...this.users.values()].find((user) => user.platform === profile.platform && user.externalUserId === profile.externalUserId)
    if (existing) {
      existing.username = profile.username
      existing.firstName = profile.firstName
      return structuredClone(existing)
    }
    const user: RuntimeUser = {
      id: randomUUID(),
      platform: profile.platform,
      externalUserId: profile.externalUserId,
      username: profile.username,
      firstName: profile.firstName,
      optedOutAt: null,
      backgroundBlocked: false,
    }
    this.users.set(user.id, user)
    return structuredClone(user)
  }

  async getUserByPlatformIdentity(platform: Platform, externalUserId: string) {
    const found = [...this.users.values()].find((user) => user.platform === platform && user.externalUserId === externalUserId)
    return found ? structuredClone(found) : null
  }

  async getUser(userId: string) {
    const found = this.users.get(userId)
    return found ? structuredClone(found) : null
  }

  async setOptOut(userId: string, optedOut: boolean, blockBackground: boolean) {
    const user = this.users.get(userId)
    if (!user) return
    user.optedOutAt = optedOut ? new Date().toISOString() : null
    user.backgroundBlocked = optedOut && blockBackground
  }

  async stopUserSessions(userId: string) {
    const stopped: string[] = []
    this.sessions.forEach((session) => {
      if (session.userId === userId && ['active', 'waiting'].includes(session.status)) {
        session.status = 'stopped'
        stopped.push(session.id)
      }
    })
    return stopped
  }

  async resolveVersion(trackingCode?: string) {
    if (trackingCode) {
      const tracked = this.tracking.get(trackingCode)
      if (tracked) {
        const version = this.versions.get(tracked.versionId)
        return version ? { version: structuredClone(version), trackingId: tracked.trackingId } : null
      }
      return null
    }
    const version = this.defaultVersionId ? this.versions.get(this.defaultVersionId) : undefined
    return version ? { version: structuredClone(version) } : null
  }

  async getVersion(versionId: string) {
    const version = this.versions.get(versionId)
    return version ? structuredClone(version) : null
  }

  async resolveVersionByFunnel(funnelId: string) {
    const versionId = this.activeVersionByFunnel.get(funnelId)
    const version = versionId ? this.versions.get(versionId) : undefined
    return version ? structuredClone(version) : null
  }

  async findActiveSession(userId: string, funnelId: string) {
    const session = [...this.sessions.values()].find((item) => item.userId === userId && item.funnelId === funnelId && ['active', 'waiting'].includes(item.status))
    return session ? structuredClone(session) : null
  }

  async findAnyActiveSession(userId: string) {
    const session = [...this.sessions.values()]
      .filter((item) => item.userId === userId && ['active', 'waiting'].includes(item.status))
      .sort((left, right) => Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt))[0]
    return session ? structuredClone(session) : null
  }

  async findLatestSession(userId: string, funnelId: string) {
    const session = [...this.sessions.values()]
      .filter((item) => item.userId === userId && item.funnelId === funnelId)
      .sort((left, right) => Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt))[0]
    return session ? structuredClone(session) : null
  }

  async getSession(sessionId: string) {
    const found = this.sessions.get(sessionId)
    return found ? structuredClone(found) : null
  }

  async createSession(input: Omit<RuntimeSession, 'id' | 'revision' | 'startedAt' | 'lastActivityAt'>) {
    const now = new Date().toISOString()
    const session: RuntimeSession = { ...structuredClone(input), id: randomUUID(), revision: 0, startedAt: now, lastActivityAt: now }
    this.sessions.set(session.id, session)
    return structuredClone(session)
  }

  async saveSession(session: RuntimeSession, expectedRevision: number) {
    const current = this.sessions.get(session.id)
    if (!current || current.revision !== expectedRevision) throw new Error('SESSION_CONFLICT')
    const next = structuredClone(session)
    next.revision = expectedRevision + 1
    next.lastActivityAt = new Date().toISOString()
    this.sessions.set(next.id, next)
    return structuredClone(next)
  }

  async abandonSession(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (session) session.status = 'abandoned'
  }

  async createCallback(userId: string, sessionId: string | undefined, action: CallbackAction, ttlSeconds = 86_400) {
    const token = randomBytes(12).toString('base64url')
    this.callbacks.set(token, { token, userId, sessionId, action, expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString() })
    return token
  }

  async consumeCallback(token: string, userId: string) {
    const callback = this.callbacks.get(token)
    if (!callback || callback.userId !== userId || callback.consumedAt || Date.parse(callback.expiresAt) <= Date.now()) return null
    callback.consumedAt = new Date().toISOString()
    return structuredClone(callback)
  }

  async createRedirect(userId: string, sessionId: string, targetUrl: string, continueAfterClick: boolean, ttlSeconds = 3600) {
    const parsed = new URL(targetUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('UNSAFE_REDIRECT')
    const token = randomBytes(18).toString('base64url')
    this.redirects.set(token, { token, userId, sessionId, targetUrl: parsed.toString(), continueAfterClick })
    void ttlSeconds
    return token
  }

  async consumeRedirect(token: string) {
    const redirect = this.redirects.get(token)
    if (!redirect) return null
    this.redirects.delete(token)
    return structuredClone(redirect)
  }

  async getMediaBinding(versionId: string, assetId: string, platform: Platform) {
    const found = this.media.get(`${versionId}:${assetId}:${platform}`)
    return found ? structuredClone(found) : null
  }

  async getProductConfig(versionId: string, productId: string) {
    const found = this.productConfigs.get(`${versionId}:${productId}`)
    return found ? structuredClone(found) : null
  }

  async scheduleJob(job: Omit<DurableJob, 'id' | 'attempts'>) {
    if ([...this.jobs.values()].some((item) => item.uniqueKey === job.uniqueKey)) return
    const next = { ...structuredClone(job), id: randomUUID(), attempts: 0, status: 'pending' }
    this.jobs.set(next.id, next)
  }

  async cancelSessionJobs(sessionId: string, types?: DurableJob['type'][]) {
    let count = 0
    this.jobs.forEach((job) => {
      if (job.payload.sessionId === sessionId && job.status === 'pending' && (!types || types.includes(job.type))) {
        job.status = 'cancelled'
        count += 1
      }
    })
    return count
  }

  async claimDueJobs(_workerId: string, limit = 20) {
    return [...this.jobs.values()]
      .filter((job) => job.status === 'pending' && Date.parse(job.dueAt) <= Date.now())
      .slice(0, limit)
      .map((job) => {
        job.status = 'running'
        job.attempts += 1
        return structuredClone(job)
      })
  }

  async completeJob(jobId: string) {
    const job = this.jobs.get(jobId)
    if (job) job.status = 'completed'
  }

  async failJob(jobId: string, error: string) {
    const job = this.jobs.get(jobId)
    if (job) {
      job.status = job.attempts >= job.maxAttempts ? 'failed' : 'pending'
      void error
    }
  }

  async appendEvent(event: AnalyticsEvent) {
    if (this.events.some((item) => item.idempotencyKey === event.idempotencyKey)) return
    this.events.push(structuredClone(event))
  }

  async saveAnswer(sessionId: string, testId: string, questionId: string, value: unknown) {
    const existing = this.answers.find((answer) => answer.sessionId === sessionId && answer.testId === testId && answer.questionId === questionId)
    if (existing) existing.value = structuredClone(value)
    else this.answers.push({ sessionId, testId, questionId, value: structuredClone(value) })
  }

  async saveConsent(session: RuntimeSession, nodeId: string, accepted: boolean, policyUrl: string, text: string) {
    const existing = this.consents.find((item) => item.sessionId === session.id && item.nodeId === nodeId)
    if (existing) Object.assign(existing, { accepted, policyUrl, text })
    else this.consents.push({ sessionId: session.id, nodeId, accepted, policyUrl, text })
  }

  async saveContactAndApplication(session: RuntimeSession, fields: Record<string, string>) {
    const existingContact = this.contacts.find((item) => item.sessionId === session.id)
    const existingApplication = this.applications.find((item) => item.sessionId === session.id)
    if (existingContact && existingApplication) {
      existingContact.fields = structuredClone(fields)
      existingApplication.fields = structuredClone(fields)
      return { contactId: String(existingContact.id), applicationId: String(existingApplication.id) }
    }
    const contactId = randomUUID()
    const applicationId = randomUUID()
    this.contacts.push({ id: contactId, sessionId: session.id, fields: structuredClone(fields) })
    this.applications.push({ id: applicationId, contactId, sessionId: session.id, status: 'new', fields: structuredClone(fields) })
    return { contactId, applicationId }
  }

  async hasPurchase(userId: string, versionId: string, productId: string) {
    return this.purchases.has(`${userId}:${versionId}:${productId}`)
  }

  async createPayment(input: Omit<PaymentRecord, 'id' | 'status'>) {
    const existing = [...this.payments.values()].find((payment) => payment.idempotencyKey === input.idempotencyKey)
    if (existing) return structuredClone(existing)
    const payment: PaymentRecord = { ...structuredClone(input), id: randomUUID(), status: 'pending' }
    this.payments.set(payment.id, payment)
    return structuredClone(payment)
  }

  async getPaymentByPayload(payload: string) {
    const found = [...this.payments.values()].find((payment) => payment.invoicePayload === payload)
    return found ? structuredClone(found) : null
  }

  async getPayment(paymentId: string) {
    const found = this.payments.get(paymentId)
    return found ? structuredClone(found) : null
  }

  async getPaymentByProviderId(provider: PaymentRecord['provider'], providerPaymentId: string) {
    const found = [...this.payments.values()].find((payment) => payment.provider === provider && payment.providerPaymentId === providerPaymentId)
    return found ? structuredClone(found) : null
  }

  async attachProviderPayment(paymentId: string, providerPaymentId: string, confirmationUrl: string, providerStatus: string) {
    const payment = this.payments.get(paymentId)
    if (!payment) throw new Error('PAYMENT_NOT_FOUND')
    if (payment.providerPaymentId && payment.providerPaymentId !== providerPaymentId) throw new Error('PAYMENT_PROVIDER_ID_CONFLICT')
    Object.assign(payment, { providerPaymentId, confirmationUrl, providerStatus })
    return structuredClone(payment)
  }

  async updateProviderPaymentStatus(paymentId: string, providerStatus: string, failed = false) {
    const payment = this.payments.get(paymentId)
    if (!payment) throw new Error('PAYMENT_NOT_FOUND')
    payment.providerStatus = providerStatus
    if (failed && payment.status !== 'paid') payment.status = 'failed'
    return structuredClone(payment)
  }

  async markPaymentPaid(paymentId: string, _telegramChargeId?: string, _providerChargeId?: string) {
    const payment = this.payments.get(paymentId)
    if (!payment) throw new Error('PAYMENT_NOT_FOUND')
    const firstSuccess = payment.status !== 'paid'
    payment.status = 'paid'
    return { payment: structuredClone(payment), firstSuccess }
  }

  async claimPaymentFulfillment(paymentId: string) {
    const payment = this.payments.get(paymentId)
    if (!payment || payment.status !== 'paid' || payment.fulfillmentStartedAt) return false
    payment.fulfillmentStartedAt = new Date().toISOString()
    return true
  }

  async completePaymentFulfillment(paymentId: string) {
    const payment = this.payments.get(paymentId)
    if (payment && !payment.fulfilledAt) payment.fulfilledAt = new Date().toISOString()
  }

  async recordPurchase(payment: PaymentRecord) {
    const key = `${payment.userId}:${payment.versionId}:${payment.productId}`
    const existing = this.purchases.get(key)
    if (existing) return { purchaseId: existing.id, created: false }
    const purchase = { id: randomUUID(), paymentId: payment.id }
    this.purchases.set(key, purchase)
    return { purchaseId: purchase.id, created: true }
  }

  async isDelivered(purchaseId: string, assetId: string) {
    return this.deliveredAssets.has(`${purchaseId}:${assetId}`)
  }

  async markDelivered(purchaseId: string, assetId: string, deliveryKey: string) {
    if (this.deliveries.has(deliveryKey)) return false
    this.deliveries.add(deliveryKey)
    this.deliveredAssets.add(`${purchaseId}:${assetId}`)
    return true
  }
}
