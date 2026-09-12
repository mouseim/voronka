import { describe, expect, it } from 'vitest'
import { paymentProviderFor } from '../src/payments/providers'
import type { ProductRuntimeConfig } from '../src/domain/types'

const base: ProductRuntimeConfig = {
  productId: 'product',
  productType: 'digital',
  provider: 'mock',
  currency: 'RUB',
  amountMinor: 10_000,
  deliveryAssetIds: [],
  deliveryByResult: {},
  repeatPolicy: 'redeliver',
  afterPurchaseText: '',
}

describe('изолированные payment provider adapters', () => {
  it('mock завершается сразу и не требует токен', () => {
    expect(paymentProviderFor(base).settlesImmediately).toBe(true)
  })

  it('Stars принудительно использует XTR', () => {
    expect(paymentProviderFor({ ...base, provider: 'telegram_stars', currency: 'XTR' }).currency(base)).toBe('XTR')
    expect(() => paymentProviderFor({ ...base, provider: 'telegram_stars', currency: 'RUB' })).toThrow('STARS_REQUIRES_XTR')
  })

  it('ЮKassa запрещена для digital и требует отдельный provider token', () => {
    expect(() => paymentProviderFor({ ...base, provider: 'yookassa' }, 'token')).toThrow('DIGITAL_REQUIRES_STARS')
    const service = { ...base, productType: 'service' as const, provider: 'yookassa' as const }
    expect(() => paymentProviderFor(service)).toThrow('TELEGRAM_PAYMENT_PROVIDER_TOKEN_REQUIRED')
    expect(paymentProviderFor(service, 'token').providerToken('token')).toBe('token')
  })
})
