import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { DatabasePool } from '../db/pool'
import type { PaymentRecord } from '../domain/types'
import type { RuntimeStore } from '../runtime/store'

export interface YooKassaCredentials {
  shopId: string
  secretKey: string
}

export interface YooKassaPayment {
  id: string
  status: 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled'
  paid: boolean
  amount: { value: string; currency: string }
  confirmation?: { type?: string; confirmation_url?: string }
  metadata?: Record<string, string>
}

export interface DirectPaymentGateway {
  createCheckout(payment: PaymentRecord, description: string, returnUrl: string): Promise<PaymentRecord>
  sync(payment: PaymentRecord): Promise<PaymentRecord>
}

export class SecretBox {
  private readonly key: Buffer

  constructor(encodedKey: string) {
    const trimmed = encodedKey.trim()
    const parsed = /^[a-f\d]{64}$/i.test(trimmed) ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64')
    if (parsed.length !== 32) throw new Error('INTEGRATION_ENCRYPTION_KEY_MUST_BE_32_BYTES')
    this.key = parsed
  }

  encrypt(value: string) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return { ciphertext, iv, authTag: cipher.getAuthTag() }
  }

  decrypt(value: { ciphertext: Buffer; iv: Buffer; authTag: Buffer }) {
    const decipher = createDecipheriv('aes-256-gcm', this.key, value.iv)
    decipher.setAuthTag(value.authTag)
    return Buffer.concat([decipher.update(value.ciphertext), decipher.final()]).toString('utf8')
  }
}

interface IntegrationRow {
  shop_id: string
  secret_ciphertext: Buffer
  secret_iv: Buffer
  secret_auth_tag: Buffer
  verified_at: Date | string | null
  updated_at: Date | string
}

export class YooKassaIntegrationRepository {
  constructor(private readonly pool: DatabasePool, private readonly secrets: SecretBox) {}

  async getCredentials(): Promise<YooKassaCredentials | null> {
    const result = await this.pool.query<IntegrationRow>('SELECT * FROM payment_integrations WHERE provider = $1', ['yookassa_api'])
    const row = result.rows[0]
    if (!row) return null
    return {
      shopId: row.shop_id,
      secretKey: this.secrets.decrypt({ ciphertext: row.secret_ciphertext, iv: row.secret_iv, authTag: row.secret_auth_tag }),
    }
  }

  async status() {
    const result = await this.pool.query<IntegrationRow>('SELECT * FROM payment_integrations WHERE provider = $1', ['yookassa_api'])
    const row = result.rows[0]
    return row ? {
      configured: true,
      shopIdMasked: maskShopId(row.shop_id),
      verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : null,
      updatedAt: new Date(row.updated_at).toISOString(),
    } : { configured: false, shopIdMasked: null, verifiedAt: null, updatedAt: null }
  }

  async save(credentials: YooKassaCredentials) {
    const encrypted = this.secrets.encrypt(credentials.secretKey)
    await this.pool.query(`
      INSERT INTO payment_integrations(provider, shop_id, secret_ciphertext, secret_iv, secret_auth_tag)
      VALUES ('yookassa_api', $1, $2, $3, $4)
      ON CONFLICT (provider) DO UPDATE SET shop_id = EXCLUDED.shop_id,
        secret_ciphertext = EXCLUDED.secret_ciphertext, secret_iv = EXCLUDED.secret_iv,
        secret_auth_tag = EXCLUDED.secret_auth_tag, verified_at = NULL, updated_at = now()
    `, [credentials.shopId, encrypted.ciphertext, encrypted.iv, encrypted.authTag])
  }

  async markVerified() {
    await this.pool.query("UPDATE payment_integrations SET verified_at = now(), updated_at = now() WHERE provider = 'yookassa_api'")
  }

  async markUnverified() {
    await this.pool.query("UPDATE payment_integrations SET verified_at = NULL, updated_at = now() WHERE provider = 'yookassa_api'")
  }
}

export class YooKassaClient {
  constructor(
    private readonly credentials: YooKassaCredentials,
    private readonly fetcher: typeof fetch = fetch,
    private readonly baseUrl = 'https://api.yookassa.ru/v3',
  ) {}

  async createPayment(input: {
    amountMinor: number
    currency: string
    description: string
    returnUrl: string
    internalPaymentId: string
    idempotencyKey: string
  }) {
    return this.request<YooKassaPayment>('/payments', {
      method: 'POST',
      headers: { 'Idempotence-Key': stableIdempotenceKey(input.idempotencyKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: { value: minorValue(input.amountMinor), currency: input.currency },
        capture: true,
        confirmation: { type: 'redirect', return_url: input.returnUrl },
        description: input.description.slice(0, 128),
        metadata: { internal_payment_id: input.internalPaymentId },
      }),
    })
  }

  getPayment(id: string) {
    return this.request<YooKassaPayment>(`/payments/${encodeURIComponent(id)}`)
  }

  async checkCredentials() {
    await this.request('/payments?limit=1')
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const authorization = Buffer.from(`${this.credentials.shopId}:${this.credentials.secretKey}`).toString('base64')
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(10_000),
      headers: { ...init.headers, Authorization: `Basic ${authorization}`, Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`YOOKASSA_HTTP_${response.status}`)
    return await response.json() as T
  }
}

export class YooKassaPaymentService implements DirectPaymentGateway {
  constructor(
    private readonly store: RuntimeStore,
    private readonly integrations: YooKassaIntegrationRepository,
    private readonly clientFactory: (credentials: YooKassaCredentials) => Pick<YooKassaClient, 'createPayment' | 'getPayment' | 'checkCredentials'> = (credentials) => new YooKassaClient(credentials),
  ) {}

  async createCheckout(payment: PaymentRecord, description: string, returnUrl: string) {
    if (payment.provider !== 'yookassa_api') throw new Error('UNSUPPORTED_DIRECT_PAYMENT_PROVIDER')
    if (payment.providerPaymentId && payment.confirmationUrl) return payment
    const client = await this.client()
    const created = await client.createPayment({
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      description,
      returnUrl,
      internalPaymentId: payment.id,
      idempotencyKey: payment.idempotencyKey,
    })
    verifyProviderPayment(payment, created)
    const confirmationUrl = created.confirmation?.confirmation_url
    if (!confirmationUrl || !isHttpsUrl(confirmationUrl)) throw new Error('YOOKASSA_CONFIRMATION_URL_MISSING')
    return this.store.attachProviderPayment(payment.id, created.id, confirmationUrl, created.status)
  }

  async sync(payment: PaymentRecord) {
    if (!payment.providerPaymentId) throw new Error('YOOKASSA_PAYMENT_NOT_CREATED')
    const current = await (await this.client()).getPayment(payment.providerPaymentId)
    verifyProviderPayment(payment, current)
    if (current.status === 'succeeded' && current.paid) {
      const updated = await this.store.updateProviderPaymentStatus(payment.id, current.status)
      return { ...updated, status: 'paid' as const }
    }
    return this.store.updateProviderPaymentStatus(payment.id, current.status, current.status === 'canceled')
  }

  async checkCredentials() {
    try {
      await (await this.client()).checkCredentials()
      await this.integrations.markVerified()
    } catch (error) {
      await this.integrations.markUnverified()
      throw error
    }
  }

  private async client() {
    const credentials = await this.integrations.getCredentials()
    if (!credentials) throw new Error('YOOKASSA_API_NOT_CONFIGURED')
    return this.clientFactory(credentials)
  }
}

export function verifyAdminToken(actual: string | undefined, expected: string) {
  if (!actual?.startsWith('Bearer ') || !expected) return false
  const supplied = Buffer.from(actual.slice(7))
  const configured = Buffer.from(expected)
  return supplied.length === configured.length && timingSafeEqual(supplied, configured)
}

function verifyProviderPayment(payment: PaymentRecord, provider: YooKassaPayment) {
  if (!provider.id || !provider.amount || !provider.status) throw new Error('YOOKASSA_RESPONSE_INVALID')
  if (provider.amount.currency !== payment.currency || provider.amount.value !== minorValue(payment.amountMinor)) throw new Error('YOOKASSA_AMOUNT_MISMATCH')
  if (provider.metadata?.internal_payment_id !== payment.id) throw new Error('YOOKASSA_METADATA_MISMATCH')
}

function minorValue(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_PAYMENT_AMOUNT')
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`
}

function stableIdempotenceKey(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function maskShopId(value: string) {
  return value.length <= 4 ? '*'.repeat(value.length) : `${value.slice(0, 2)}${'*'.repeat(Math.min(8, value.length - 4))}${value.slice(-2)}`
}

function isHttpsUrl(value: string) {
  try { return new URL(value).protocol === 'https:' } catch { return false }
}
