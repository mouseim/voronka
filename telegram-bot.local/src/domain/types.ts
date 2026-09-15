import type { FunnelDocument, MediaType, VariableValue } from '../core/shared'

export type SessionStatus = 'active' | 'waiting' | 'completed' | 'abandoned' | 'stopped' | 'failed'
export type PaymentProviderName = 'unconfigured' | 'mock' | 'telegram_stars' | 'yookassa' | 'yookassa_api'
export type ProductType = 'digital' | 'service' | 'physical' | 'other'

export type Platform = 'telegram' | 'vk'

export interface PlatformProfile {
  platform: Platform
  externalUserId: string
  username?: string
  firstName?: string
  lastName?: string
  languageCode?: string
}

export type TelegramProfile = PlatformProfile & { platform: 'telegram' }
export type VkProfile = PlatformProfile & { platform: 'vk' }

export interface RuntimeUser {
  id: string
  platform: Platform
  externalUserId: string
  username?: string
  firstName?: string
  optedOutAt?: string | null
  backgroundBlocked: boolean
}

export interface FunnelVersionRecord {
  id: string
  funnelId: string
  document: FunnelDocument
  status: 'draft' | 'published' | 'archived'
  allowPlaceholders: boolean
  contentHash: string
}

export interface TestRunState {
  testId: string
  nodeId: string
  questionOrder: string[]
  answerOrder: Record<string, string[]>
  index: number
  answers: Record<string, string | string[] | number>
  selected: string[]
}

export interface FormRunState {
  nodeId: string
  index: number
  values: Record<string, string>
}

export interface TestResultDeliveryState {
  testId: string
  nodeId: string
  resultId: string
  textDelivered: boolean
  actionsDelivered: boolean
  mediaState: 'not_needed' | 'pending' | 'delivered' | 'skipped_optional' | 'failed_required'
}

export interface SessionState {
  platform?: Platform
  awaiting?: 'callback' | 'text' | 'timer' | 'payment'
  testRun?: TestRunState
  pendingTestResult?: TestResultDeliveryState
  formRun?: FormRunState
  pendingFormSubmission?: { values: Record<string, string> }
  lastResultId?: string
  lastResultName?: string
  lastTestId?: string
  lastNodeEntered?: string
  remindersSent?: number
  missingMediaNotified?: string[]
  variables?: Record<string, VariableValue>
}

export interface RuntimeSession {
  id: string
  userId: string
  funnelId: string
  versionId: string
  status: SessionStatus
  currentNodeId: string | null
  sourceTrackingId?: string
  sourceCode?: string
  state: SessionState
  revision: number
  startedAt: string
  lastActivityAt: string
}

export type CallbackAction =
  | { type: 'advance'; nodeId: string; handle: string; ab?: AbButtonAssignment }
  | { type: 'test_single'; nodeId: string; testId: string; questionId: string; answerId: string }
  | { type: 'test_toggle'; nodeId: string; testId: string; questionId: string; answerId: string }
  | { type: 'test_submit'; nodeId: string; testId: string; questionId: string }
  | { type: 'test_value'; nodeId: string; testId: string; questionId: string; value: number }
  | { type: 'test_skip'; nodeId: string; testId: string; questionId: string }
  | { type: 'retry_result_media'; nodeId: string; testId: string; resultId: string }
  | { type: 'consent'; nodeId: string; accepted: boolean }
  | { type: 'form_cancel'; nodeId: string }
  | { type: 'product_buy'; nodeId: string; productId: string; ab?: AbButtonAssignment }
  | { type: 'product_skip'; nodeId: string }
  | { type: 'mock_payment'; paymentId: string }
  | { type: 'check_payment'; paymentId: string }
  | { type: 'restart'; funnelId: string }

export interface AbButtonAssignment {
  buttonId: string
  resultId: string
  variant: 'A' | 'B'
  text: string
}

export interface CallbackRecord {
  token: string
  userId: string
  sessionId?: string
  action: CallbackAction
  expiresAt: string
  consumedAt?: string
}

export interface RedirectRecord {
  token: string
  userId: string
  sessionId: string
  targetUrl: string
  continueAfterClick: boolean
  expiresAt?: string
}

export interface ProductRuntimeConfig {
  productId: string
  productType: ProductType
  provider: PaymentProviderName
  currency: string
  amountMinor: number
  deliveryAssetIds: string[]
  deliveryByResult: Record<string, string[]>
  repeatPolicy: 'deny' | 'redeliver' | 'repurchase'
  afterPurchaseText: string
}

interface BaseMediaBinding {
  assetId: string
  assetKey: string
  expectedType: MediaType
  platform: Platform
}

export interface TelegramMediaBinding extends BaseMediaBinding {
  platform: 'telegram'
  telegramFileId: string
  telegramFileUniqueId?: string
  mimeType?: string
  fileSize?: number
}

export type VkAttachmentType = 'photo' | 'video' | 'doc' | 'audio_message'

export interface VkMediaAttachment {
  type: VkAttachmentType
  ownerId: number
  mediaId: number
  accessKey?: string
}

export interface VkMediaBinding extends BaseMediaBinding {
  platform: 'vk'
  attachment: VkMediaAttachment
}

export type MediaBinding = TelegramMediaBinding | VkMediaBinding

export interface PaymentRecord {
  id: string
  idempotencyKey: string
  userId: string
  sessionId: string
  versionId: string
  funnelId: string
  productId: string
  provider: PaymentProviderName
  invoicePayload: string
  amountMinor: number
  currency: string
  status: 'created' | 'pending' | 'paid' | 'failed' | 'refunded'
  providerPaymentId?: string
  confirmationUrl?: string
  providerStatus?: string
  fulfillmentStartedAt?: string
  fulfilledAt?: string
}

export interface AnalyticsEvent {
  idempotencyKey: string
  type: string
  userId?: string
  sessionId?: string
  funnelId?: string
  versionId?: string
  nodeId?: string
  trackingId?: string
  payload?: Record<string, unknown>
  occurredAt?: string
}

export interface DurableJob {
  id: string
  uniqueKey: string
  type: 'timer_continue' | 'reminder' | 'redirect_continue' | 'resume_session' | 'payment_reconcile'
  payload: Record<string, unknown>
  dueAt: string
  attempts: number
  maxAttempts: number
}

export interface OutgoingButton {
  text: string
  callbackToken?: string
  url?: string
}

export interface InvoiceSpec {
  title: string
  description: string
  payload: string
  provider: PaymentProviderName
  providerToken?: string
  currency: string
  amountMinor: number
}

export interface RuntimeTransport {
  readonly platform: Platform
  readonly capabilities: PlatformCapabilities
  sendText(recipientId: string, text: string, buttons?: OutgoingButton[][]): Promise<void>
  sendMedia(recipientId: string, type: MediaType, binding: MediaBinding, caption?: string): Promise<void>
  sendInvoice(recipientId: string, invoice: InvoiceSpec): Promise<void>
  sendDocument(recipientId: string, filename: string, content: Buffer, caption?: string): Promise<void>
  notifyAdministrators(text: string): Promise<void>
}

export interface PlatformCapabilities {
  text: boolean
  buttons: boolean
  urlButtons: boolean
  media: boolean
  mediaTypes: readonly MediaType[]
  payments: boolean
}
