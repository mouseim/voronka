import { describe, expect, it } from 'vitest'
import type { DirectPaymentGateway } from '../src/payments/yookassa'
import type { MediaBinding, OutgoingButton, PlatformProfile, RuntimeTransport } from '../src/domain/types'
import { telegramCapabilities, vkCapabilities } from '../src/runtime/capabilities'
import { FunnelEngine } from '../src/runtime/engine'
import { MemoryRuntimeStore } from '../src/runtime/memory-store'
import { loadDemo } from './helpers'

describe('единый direct-payment flow', () => {
  it.each(['telegram', 'vk'] as const)('показывает redirect и ровно один раз исполняет покупку в %s', async (platform) => {
    const document = await loadDemo()
    const start = document.nodes.find((node) => node.type === 'start')!
    const end = document.nodes.find((node) => node.type === 'end')!
    const product = document.products[0]!
    const productNode = { id: 'pay', type: 'product' as const, data: { title: 'Оплата', productId: product.id, headline: 'Курс', description: 'Доступ', price: product.price, payButtonText: 'Купить', allowSkip: false } }
    document.nodes = [start, productNode, end]
    document.edges = [
      { id: 'to-pay', source: start.id, target: productNode.id, sourceHandle: 'next' },
      { id: 'paid', source: productNode.id, target: end.id, sourceHandle: 'paid' },
    ]
    document.products = [product]
    document.assets = []
    document.tests = []
    const store = new MemoryRuntimeStore()
    const version = store.install(document, { productConfigs: [{
      productId: product.id, productType: 'service', provider: 'yookassa_api', currency: 'RUB', amountMinor: 19_900,
      deliveryAssetIds: [], deliveryByResult: {}, repeatPolicy: 'redeliver', afterPurchaseText: 'Оплата получена.',
    }] })
    let succeeded = false
    const gateway: DirectPaymentGateway = {
      async createCheckout(payment) {
        return store.attachProviderPayment(payment.id, 'provider-1', 'https://yookassa.test/checkout', 'pending')
      },
      async sync(payment) {
        if (!succeeded) return payment
        const updated = await store.updateProviderPaymentStatus(payment.id, 'succeeded')
        return { ...updated, status: 'paid' as const }
      },
    }
    const transport = new PaymentTransport(platform)
    const engine = new FunnelEngine(store, transport, { publicBaseUrl: 'https://runtime.test', directPayments: gateway })
    const profile: PlatformProfile = { platform, externalUserId: '42' }

    await engine.start(profile)
    const buy = [...store.callbacks.entries()].find(([, value]) => value.action.type === 'product_buy')!
    await engine.handleCallback(profile, buy[0])
    const payment = [...store.payments.values()][0]!
    expect(payment.versionId).toBe(version.id)
    expect(transport.texts.at(-1)?.buttons?.flat().map((button) => [button.text, button.url])).toContainEqual(['Оплатить', 'https://yookassa.test/checkout'])
    expect([...store.jobs.values()].some((job) => job.type === 'payment_reconcile')).toBe(true)

    const check = [...store.callbacks.entries()].reverse().find(([, value]) => value.action.type === 'check_payment')!
    await engine.handleCallback(profile, check[0])
    expect(transport.texts.at(-1)?.text).toContain('пока не подтверждён')

    succeeded = true
    const reconciliation = [...store.jobs.values()].find((job) => job.type === 'payment_reconcile')!
    await Promise.all([
      platform === 'vk' ? engine.handleJob(reconciliation) : engine.handleDirectPayment(payment.id),
      engine.handleDirectPayment(payment.id),
    ])

    expect(store.events.filter((event) => event.type === 'payment_succeeded')).toHaveLength(1)
    expect(store.purchases.size).toBe(1)
    expect([...store.sessions.values()][0]?.status).toBe('completed')
    expect((await store.getPayment(payment.id))?.fulfilledAt).toBeTruthy()
  })
})

class PaymentTransport implements RuntimeTransport {
  readonly capabilities
  readonly texts: Array<{ text: string; buttons?: OutgoingButton[][] }> = []
  constructor(readonly platform: 'telegram' | 'vk') {
    this.capabilities = platform === 'telegram' ? telegramCapabilities : vkCapabilities
  }
  async sendText(_recipientId: string, text: string, buttons?: OutgoingButton[][]) { this.texts.push({ text, buttons }) }
  async sendMedia(_recipientId: string, _type: MediaBinding['expectedType'], _binding: MediaBinding) {}
  async sendInvoice() { throw new Error('DIRECT_PAYMENT_MUST_NOT_SEND_INVOICE') }
  async sendDocument() {}
  async notifyAdministrators() {}
}
