import { describe, expect, it, vi } from 'vitest'
import { SecretBox, YooKassaClient, YooKassaPaymentService, type YooKassaIntegrationRepository } from '../src/payments/yookassa'
import { MemoryRuntimeStore } from '../src/runtime/memory-store'

describe('YooKassa Server API', () => {
  it('создаёт redirect payment с Basic Auth, capture и стабильным Idempotence-Key', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
      id: 'provider-payment', status: 'pending', paid: false,
      amount: { value: '125.50', currency: 'RUB' },
      confirmation: { type: 'redirect', confirmation_url: 'https://yoomoney.ru/checkout/payments/v2/contract' },
      metadata: { internal_payment_id: 'internal-payment' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const client = new YooKassaClient({ shopId: 'shop-id', secretKey: 'super-secret' }, fetcher as typeof fetch, 'https://api.test/v3')

    await client.createPayment({ amountMinor: 12_550, currency: 'RUB', description: 'Курс', returnUrl: 'https://bot.test/payments/return', internalPaymentId: 'internal-payment', idempotencyKey: 'stable-key' })
    await client.createPayment({ amountMinor: 12_550, currency: 'RUB', description: 'Курс', returnUrl: 'https://bot.test/payments/return', internalPaymentId: 'internal-payment', idempotencyKey: 'stable-key' })

    const [, first] = fetcher.mock.calls[0]!
    const [, second] = fetcher.mock.calls[1]!
    expect(first?.headers).toMatchObject({ Authorization: `Basic ${Buffer.from('shop-id:super-secret').toString('base64')}` })
    expect((first?.headers as Record<string, string>)['Idempotence-Key']).toBe((second?.headers as Record<string, string>)['Idempotence-Key'])
    expect(JSON.parse(String(first?.body))).toMatchObject({ capture: true, confirmation: { type: 'redirect' }, metadata: { internal_payment_id: 'internal-payment' }, amount: { value: '125.50', currency: 'RUB' } })
    expect(String(first?.body)).not.toContain('super-secret')
  })

  it('шифрует секрет AES-GCM и отвергает изменённый auth tag', () => {
    const box = new SecretBox(Buffer.alloc(32, 7).toString('base64'))
    const encrypted = box.encrypt('merchant-secret')
    expect(encrypted.ciphertext.toString()).not.toContain('merchant-secret')
    expect(box.decrypt(encrypted)).toBe('merchant-secret')
    const tampered = { ...encrypted, authTag: Buffer.from(encrypted.authTag) }
    tampered.authTag[0] ^= 1
    expect(() => box.decrypt(tampered)).toThrow()
  })

  it('не принимает неуспешный ответ API как платёж', async () => {
    const client = new YooKassaClient({ shopId: 'shop', secretKey: 'secret' }, vi.fn(async () => new Response('{}', { status: 401 })) as typeof fetch)
    await expect(client.checkCredentials()).rejects.toThrow('YOOKASSA_HTTP_401')
  })

  it('перед сохранением checkout сверяет amount, currency и metadata', async () => {
    const store = new MemoryRuntimeStore()
    const payment = await store.createPayment({ idempotencyKey: 'key', userId: 'user', sessionId: 'session', versionId: 'version', funnelId: 'funnel', productId: 'product', provider: 'yookassa_api', invoicePayload: 'payload', amountMinor: 5000, currency: 'RUB' })
    const integrations = { getCredentials: async () => ({ shopId: 'shop', secretKey: 'secret' }) } as unknown as YooKassaIntegrationRepository
    const service = new YooKassaPaymentService(store, integrations, () => ({
      createPayment: async () => ({ id: 'provider', status: 'pending', paid: false, amount: { value: '49.99', currency: 'RUB' }, confirmation: { confirmation_url: 'https://checkout.test/pay' }, metadata: { internal_payment_id: payment.id } }),
      getPayment: async () => { throw new Error('unused') },
      checkCredentials: async () => undefined,
    }))
    await expect(service.createCheckout(payment, 'Товар', 'https://runtime.test/payments/return')).rejects.toThrow('YOOKASSA_AMOUNT_MISMATCH')
    expect((await store.getPayment(payment.id))?.providerPaymentId).toBeUndefined()
  })
})
