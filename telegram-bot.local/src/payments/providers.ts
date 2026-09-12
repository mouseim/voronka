import type { ProductRuntimeConfig } from '../domain/types'

export interface PaymentProviderAdapter {
  readonly name: ProductRuntimeConfig['provider']
  readonly settlesImmediately: boolean
  currency(config: ProductRuntimeConfig): string
  providerToken(configuredToken?: string): string | undefined
  assertAllowed(config: ProductRuntimeConfig, configuredToken?: string): void
}

const mock: PaymentProviderAdapter = {
  name: 'mock',
  settlesImmediately: true,
  currency: (config) => config.currency,
  providerToken: () => undefined,
  assertAllowed: () => undefined,
}

const telegramStars: PaymentProviderAdapter = {
  name: 'telegram_stars',
  settlesImmediately: false,
  currency: () => 'XTR',
  providerToken: () => undefined,
  assertAllowed(config) {
    if (config.currency !== 'XTR') throw new Error('STARS_REQUIRES_XTR')
    if (!Number.isInteger(config.amountMinor)) throw new Error('STARS_AMOUNT_MUST_BE_INTEGER')
  },
}

const yookassa: PaymentProviderAdapter = {
  name: 'yookassa',
  settlesImmediately: false,
  currency: (config) => config.currency,
  providerToken: (configuredToken) => configuredToken,
  assertAllowed(config, configuredToken) {
    if (config.productType === 'digital') throw new Error('DIGITAL_REQUIRES_STARS')
    if (!configuredToken) throw new Error('TELEGRAM_PAYMENT_PROVIDER_TOKEN_REQUIRED')
  },
}

const adapters = { mock, telegram_stars: telegramStars, yookassa }

export function paymentProviderFor(
  config: ProductRuntimeConfig,
  configuredToken?: string,
): PaymentProviderAdapter {
  if (config.provider === 'unconfigured') throw new Error('PAYMENT_PROVIDER_UNCONFIGURED')
  const adapter = adapters[config.provider]
  adapter.assertAllowed(config, configuredToken)
  return adapter
}
