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

export interface RuntimeStore {
  reserveUpdate(platform: Platform, updateId: string): Promise<boolean>
  upsertUser(profile: PlatformProfile): Promise<RuntimeUser>
  getUser(userId: string): Promise<RuntimeUser | null>
  getUserByPlatformIdentity(platform: Platform, externalUserId: string): Promise<RuntimeUser | null>
  setOptOut(userId: string, optedOut: boolean, blockBackground: boolean): Promise<void>
  stopUserSessions(userId: string): Promise<string[]>
  resolveVersion(trackingCode?: string): Promise<{ version: FunnelVersionRecord; trackingId?: string } | null>
  resolveVersionByFunnel(funnelId: string): Promise<FunnelVersionRecord | null>
  getVersion(versionId: string): Promise<FunnelVersionRecord | null>
  findActiveSession(userId: string, funnelId: string): Promise<RuntimeSession | null>
  findAnyActiveSession(userId: string): Promise<RuntimeSession | null>
  findLatestSession(userId: string, funnelId: string): Promise<RuntimeSession | null>
  getSession(sessionId: string): Promise<RuntimeSession | null>
  findBackgroundSession(jobKey: string): Promise<RuntimeSession | null>
  createSession(input: Omit<RuntimeSession, 'id' | 'revision' | 'startedAt' | 'lastActivityAt'>): Promise<RuntimeSession>
  saveSession(session: RuntimeSession, expectedRevision: number): Promise<RuntimeSession>
  abandonSession(sessionId: string): Promise<void>
  createCallback(userId: string, sessionId: string | undefined, action: CallbackAction, ttlSeconds?: number): Promise<string>
  consumeCallback(token: string, userId: string): Promise<CallbackRecord | null>
  createRedirect(userId: string, sessionId: string, targetUrl: string, continueAfterClick: boolean, ttlSeconds?: number): Promise<string>
  consumeRedirect(token: string): Promise<RedirectRecord | null>
  getMediaBinding(versionId: string, assetId: string, platform: Platform): Promise<MediaBinding | null>
  getProductConfig(versionId: string, productId: string): Promise<ProductRuntimeConfig | null>
  scheduleJob(job: Omit<DurableJob, 'id' | 'attempts'>): Promise<void>
  cancelSessionJobs(sessionId: string, types?: DurableJob['type'][]): Promise<number>
  claimDueJobs(workerId: string, limit?: number): Promise<DurableJob[]>
  completeJob(jobId: string): Promise<void>
  failJob(jobId: string, error: string): Promise<void>
  appendEvent(event: AnalyticsEvent): Promise<void>
  saveAnswer(sessionId: string, testId: string, questionId: string, value: unknown): Promise<void>
  saveConsent(session: RuntimeSession, nodeId: string, accepted: boolean, policyUrl: string, text: string): Promise<void>
  saveContactAndApplication(session: RuntimeSession, fields: Record<string, string>): Promise<{ contactId: string; applicationId: string }>
  hasPurchase(userId: string, versionId: string, productId: string): Promise<boolean>
  createPayment(input: Omit<PaymentRecord, 'id' | 'status'>): Promise<PaymentRecord>
  getPaymentByPayload(payload: string): Promise<PaymentRecord | null>
  getPayment(paymentId: string): Promise<PaymentRecord | null>
  getPaymentByProviderId(provider: PaymentRecord['provider'], providerPaymentId: string): Promise<PaymentRecord | null>
  attachProviderPayment(paymentId: string, providerPaymentId: string, confirmationUrl: string, providerStatus: string): Promise<PaymentRecord>
  updateProviderPaymentStatus(paymentId: string, providerStatus: string, failed?: boolean): Promise<PaymentRecord>
  markPaymentPaid(paymentId: string, telegramChargeId?: string, providerChargeId?: string): Promise<{ payment: PaymentRecord; firstSuccess: boolean }>
  claimPaymentFulfillment(paymentId: string): Promise<boolean>
  completePaymentFulfillment(paymentId: string): Promise<void>
  recordPurchase(payment: PaymentRecord): Promise<{ purchaseId: string; created: boolean }>
  isDelivered(purchaseId: string, assetId: string): Promise<boolean>
  markDelivered(purchaseId: string, assetId: string, deliveryKey: string): Promise<boolean>
}
