import { describe, expect, it } from 'vitest'
import type { CallbackAction, ProductRuntimeConfig } from '../src/domain/types'
import { FunnelEngine } from '../src/runtime/engine'
import { MemoryRuntimeStore } from '../src/runtime/memory-store'
import { FakeTransport, loadDemo, profile } from './helpers'

describe('стабилизация настроек Telegram runtime', () => {
  it('исполняет настроенную opt-out команду активной версии', async () => {
    const document = await messageDocument()
    document.bot.optOut.command = 'leave'
    document.bot.optOut.confirmationText = 'Рассылка остановлена.'
    const store = new MemoryRuntimeStore()
    store.install(document)
    const transport = new FakeTransport()
    const engine = new FunnelEngine(store, transport)

    await engine.start(profile)
    expect(await engine.handleOptOutCommand(profile, '/LEAVE@funnel_bot')).toBe(true)

    expect([...store.sessions.values()][0]?.status).toBe('stopped')
    expect((await store.getUserByPlatformIdentity('telegram', profile.externalUserId))?.backgroundBlocked).toBe(true)
    expect(transport.texts.at(-1)?.text).toBe('Рассылка остановлена.')
  })

  it.each([true, false])('cancelAfterContinue=%s управляет отменой напоминания', async (cancelAfterContinue) => {
    const document = await messageDocument(true)
    document.bot.reminders.cancelAfterContinue = cancelAfterContinue
    const store = new MemoryRuntimeStore()
    store.install(document)
    const engine = new FunnelEngine(store, new FakeTransport())

    await engine.start(profile)
    const firstReminder = [...store.jobs.values()].find((job) => job.type === 'reminder' && job.payload.nodeId === 'first-message')!
    expect(firstReminder.status).toBe('pending')
    await click(store, engine, 'advance')

    expect(store.jobs.get(firstReminder.id)?.status).toBe(cancelAfterContinue ? 'cancelled' : 'pending')
  })

  it('обрабатывает первую успешную покупку и выдаёт материал', async () => {
    const scenario = await productScenario('redeliver')

    await buy(scenario)

    expect(scenario.store.payments.size).toBe(1)
    expect(scenario.store.purchases.size).toBe(1)
    expect(scenario.transport.media).toHaveLength(1)
    expect([...scenario.store.sessions.values()][0]?.status).toBe('completed')
  })

  it.each([
    ['deny', 1, 1, 'Повторная покупка отключена.'],
    ['redeliver', 1, 2, 'Отправляю его повторно.'],
    ['repurchase', 2, 2, null],
  ] as const)('исполняет repeatPolicy=%s при повторной покупке', async (repeatPolicy, paymentCount, deliveryCount, expectedText) => {
    const scenario = await productScenario(repeatPolicy)
    await buy(scenario)

    await scenario.engine.start(profile)
    if (repeatPolicy === 'repurchase') await click(scenario.store, scenario.engine, 'product_buy')

    expect(scenario.store.payments.size).toBe(paymentCount)
    expect(scenario.transport.media).toHaveLength(deliveryCount)
    expect([...scenario.store.sessions.values()].every((session) => session.status === 'completed')).toBe(true)
    if (expectedText) expect(scenario.transport.texts.some((message) => message.text.includes(expectedText))).toBe(true)
  })

  it('даёт ручное продолжение для external_link без автоперехода', async () => {
    const document = await loadDemo()
    const start = document.nodes.find((node) => node.type === 'start')!
    const end = document.nodes.find((node) => node.type === 'end')!
    document.nodes = [start, {
      id: 'external',
      type: 'external_link',
      data: {
        title: 'Внешняя ссылка',
        text: 'Откройте страницу',
        buttonText: 'Открыть',
        url: 'https://example.com/offer',
        continueAfterClick: false,
      },
    }, end]
    document.edges = [
      { id: 'to-external', source: start.id, target: 'external', sourceHandle: 'next' },
      { id: 'to-end', source: 'external', target: end.id, sourceHandle: 'next' },
    ]
    document.assets = []
    document.products = []
    document.tests = []
    const store = new MemoryRuntimeStore()
    store.install(document)
    const transport = new FakeTransport()
    const engine = new FunnelEngine(store, transport, { publicBaseUrl: 'https://bot.example.com' })

    await engine.start(profile)
    const buttons = transport.texts.at(-1)?.buttons?.flat() ?? []
    expect(buttons.some((button) => button.url?.startsWith('https://bot.example.com/r/'))).toBe(true)
    expect(buttons.some((button) => button.text === 'Продолжить' && button.callbackToken)).toBe(true)
    const redirectToken = [...store.redirects.keys()][0]!
    expect(await engine.handleRedirect(redirectToken)).toBe('https://example.com/offer')
    expect([...store.jobs.values()].some((job) => job.type === 'redirect_continue')).toBe(false)

    await click(store, engine, 'advance')
    expect([...store.sessions.values()][0]?.status).toBe('completed')
  })
})

async function messageDocument(twoMessages = false) {
  const document = await loadDemo()
  const start = document.nodes.find((node) => node.type === 'start')!
  const end = document.nodes.find((node) => node.type === 'end')!
  const first = { id: 'first-message', type: 'message' as const, data: { title: 'Первое сообщение', text: 'Первое', buttons: [] } }
  const second = { id: 'second-message', type: 'message' as const, data: { title: 'Второе сообщение', text: 'Второе', buttons: [] } }
  document.nodes = twoMessages ? [start, first, second, end] : [start, first, end]
  document.edges = [
    { id: 'to-first', source: start.id, target: first.id, sourceHandle: 'next' },
    { id: 'from-first', source: first.id, target: twoMessages ? second.id : end.id, sourceHandle: 'next' },
    ...(twoMessages ? [{ id: 'from-second', source: second.id, target: end.id, sourceHandle: 'next' }] : []),
  ]
  document.assets = []
  document.products = []
  document.tests = []
  document.bot.quietHours.enabled = false
  return document
}

async function productScenario(repeatPolicy: ProductRuntimeConfig['repeatPolicy']) {
  const document = await loadDemo()
  const start = document.nodes.find((node) => node.type === 'start')!
  const end = document.nodes.find((node) => node.type === 'end')!
  const product = document.products.find((item) => item.id === 'product_report')!
  const asset = document.assets.find((item) => item.id === 'asset_guide')!
  const productNode = {
    id: 'product-node',
    type: 'product' as const,
    data: {
      title: 'Продукт',
      productId: product.id,
      headline: 'Материал',
      description: 'Описание',
      price: product.price,
      payButtonText: 'Купить',
      allowSkip: false,
    },
  }
  document.nodes = [start, productNode, end]
  document.edges = [
    { id: 'to-product', source: start.id, target: productNode.id, sourceHandle: 'next' },
    { id: 'paid', source: productNode.id, target: end.id, sourceHandle: 'paid' },
    { id: 'failed', source: productNode.id, target: end.id, sourceHandle: 'failed' },
    { id: 'already', source: productNode.id, target: end.id, sourceHandle: 'already_purchased' },
  ]
  document.assets = [asset]
  document.products = [product]
  document.tests = []
  const store = new MemoryRuntimeStore()
  const version = store.install(document, {
    productConfigs: [{
      productId: product.id,
      productType: 'digital',
      provider: 'mock',
      currency: 'RUB',
      amountMinor: Math.round(product.price * 100),
      deliveryAssetIds: [asset.id],
      deliveryByResult: {},
      repeatPolicy,
      afterPurchaseText: 'Оплата получена.',
    }],
  })
  store.bindMedia(version.id, { assetId: asset.id, assetKey: asset.key, expectedType: asset.type, telegramFileId: 'guide-file' })
  const transport = new FakeTransport()
  const engine = new FunnelEngine(store, transport)
  return { store, transport, engine }
}

async function buy(scenario: Awaited<ReturnType<typeof productScenario>>) {
  await scenario.engine.start(profile)
  await click(scenario.store, scenario.engine, 'product_buy')
}

async function click(store: MemoryRuntimeStore, engine: FunnelEngine, type: CallbackAction['type']) {
  const found = [...store.callbacks.entries()].reverse().find(([, callback]) => !callback.consumedAt && callback.action.type === type)
  expect(found, `Не найдена callback ${type}`).toBeDefined()
  await engine.handleCallback(profile, found![0])
}
