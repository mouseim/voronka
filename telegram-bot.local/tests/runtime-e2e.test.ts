import { describe, expect, it } from 'vitest'
import type { CallbackAction } from '../src/domain/types'
import { FunnelEngine } from '../src/runtime/engine'
import { MemoryRuntimeStore } from '../src/runtime/memory-store'
import { FakeTransport, loadDemo, profile } from './helpers'

describe('E2E runtime с фальшивым Telegram transport', () => {
  it('применяет переменную, выбирает ветку условия и подставляет значение в текст', async () => {
    const document = await loadDemo()
    const start = document.nodes.find((node) => node.type === 'start')!
    document.variables = [{ id: 'score', key: 'score', name: 'Баллы', type: 'number', defaultValue: 0 }]
    document.nodes = [
      start,
      { id: 'set-score', type: 'variable', data: { title: 'Начислить баллы', operations: [{ id: 'set', variableId: 'score', operation: 'add', value: 3 }] } },
      { id: 'check-score', type: 'condition', data: { title: 'Проверить баллы', variableId: 'score', operator: 'greater_or_equal', value: 3 } },
      { id: 'yes', type: 'end', data: { title: 'Да', text: 'Подходит: {{score}}' } },
      { id: 'no', type: 'end', data: { title: 'Нет', text: 'Не подходит' } },
    ]
    document.edges = [
      { id: 'start-set', source: start.id, target: 'set-score', sourceHandle: 'next' },
      { id: 'set-check', source: 'set-score', target: 'check-score', sourceHandle: 'next' },
      { id: 'check-yes', source: 'check-score', target: 'yes', sourceHandle: 'true' },
      { id: 'check-no', source: 'check-score', target: 'no', sourceHandle: 'false' },
    ]
    document.assets = []
    document.products = []
    document.tests = []
    const store = new MemoryRuntimeStore()
    store.install(document)
    const transport = new FakeTransport()
    const engine = new FunnelEngine(store, transport)

    await engine.start(profile)

    const session = [...store.sessions.values()][0]!
    expect(session.status).toBe('completed')
    expect(session.state.variables).toEqual({ score: 3 })
    expect(transport.texts.at(-1)?.text).toBe('Подходит: 3')
    expect(store.events.map((event) => event.type)).toEqual(expect.arrayContaining(['variables_changed', 'condition_evaluated']))
  })

  it('проходит demo: tracking → test → form → consent → timer → mock payment → delivery', async () => {
    const document = await loadDemo()
    document.bot.quietHours.enabled = false
    const store = new MemoryRuntimeStore()
    const version = store.install(document, {
      default: true,
      allowPlaceholders: false,
      productConfigs: [{
        productId: 'product_report',
        productType: 'digital',
        provider: 'mock',
        currency: 'RUB',
        amountMinor: 149_000,
        deliveryAssetIds: ['asset_guide'],
        deliveryByResult: {},
        repeatPolicy: 'redeliver',
        afterPurchaseText: 'Оплата получена.',
      }],
    })
    store.bindMedia(version.id, { assetId: 'asset_cover', assetKey: 'test_cover', expectedType: 'image', telegramFileId: 'cover-file' })
    store.bindMedia(version.id, { assetId: 'asset_guide', assetKey: 'personal_guide', expectedType: 'document', telegramFileId: 'guide-file' })
    const transport = new FakeTransport()
    const engine = new FunnelEngine(store, transport, { now: () => new Date('2026-07-28T09:00:00.000Z') })

    await engine.start(profile, document.bot.trackingLinks[0]!.code)
    await click(store, engine, { type: 'advance', handle: 'button_test' })

    for (let index = 0; index < document.tests[0]!.questions.length; index += 1) {
      await click(store, engine, { type: 'test_single' })
    }
    await click(store, engine, { type: 'advance', handle: /^result_/ })
    await click(store, engine, { type: 'advance', handle: 'button_form' })

    await engine.handleText(profile, 'Анна')
    await engine.handleText(profile, 'anna@example.com')
    expect(store.contacts).toHaveLength(0)
    await click(store, engine, { type: 'consent', accepted: true })
    expect(store.contacts).toHaveLength(1)
    expect(store.applications).toHaveLength(1)

    const timer = [...store.jobs.values()].find((job) => job.type === 'timer_continue' && job.status === 'pending')
    expect(timer).toBeDefined()
    await engine.handleJob(timer!)
    await click(store, engine, { type: 'product_buy' })

    expect(store.purchases.size).toBe(1)
    expect(store.deliveries.size).toBe(1)
    expect(transport.media).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileId: 'cover-file', type: 'image' }),
      expect.objectContaining({ fileId: 'guide-file', type: 'document' }),
    ]))
    expect(transport.notifications.some((text) => text.includes('Новая заявка'))).toBe(true)
    const session = [...store.sessions.values()][0]!
    expect(session.status).toBe('completed')
    expect(store.events.some((event) => event.type === 'source_attributed')).toBe(true)
    expect(store.events.some((event) => event.type === 'payment_succeeded')).toBe(true)
  })

  it('дедуплицирует updates, callbacks и повторную оплату/выдачу', async () => {
    const document = await loadDemo()
    const store = new MemoryRuntimeStore()
    const version = store.install(document)
    const user = await store.upsertUser(profile)
    const session = await store.createSession({
      userId: user.id,
      funnelId: version.funnelId,
      versionId: version.id,
      status: 'waiting',
      currentNodeId: 'welcome',
      state: {},
    })
    const token = await store.createCallback(user.id, session.id, { type: 'advance', nodeId: 'welcome', handle: 'button_details' })
    expect(await store.consumeCallback(token, user.id)).not.toBeNull()
    expect(await store.consumeCallback(token, user.id)).toBeNull()
    expect(await store.reserveUpdate('telegram', '77')).toBe(true)
    expect(await store.reserveUpdate('telegram', '77')).toBe(false)

    const payment = await store.createPayment({
      idempotencyKey: 'one',
      userId: user.id,
      sessionId: session.id,
      versionId: version.id,
      funnelId: version.funnelId,
      productId: 'product_report',
      provider: 'mock',
      invoicePayload: 'mock:one',
      amountMinor: 100,
      currency: 'RUB',
    })
    expect((await store.markPaymentPaid(payment.id, 'charge')).firstSuccess).toBe(true)
    expect((await store.markPaymentPaid(payment.id, 'charge')).firstSuccess).toBe(false)
    const purchase = await store.recordPurchase({ ...payment, status: 'paid' })
    expect(await store.markDelivered(purchase.purchaseId, 'asset', 'once')).toBe(true)
    expect(await store.markDelivered(purchase.purchaseId, 'asset', 'once')).toBe(false)
  })

  it('исполняет single, multiple, scale, number и text вопросы', async () => {
    const document = await loadDemo()
    document.bot.quietHours.enabled = false
    const test = document.tests[0]!
    test.shuffleQuestions = false
    const [single, multiple] = test.questions
    test.questions = [
      { ...structuredClone(single!), id: 'q-single', type: 'single', shuffleAnswers: false },
      { ...structuredClone(multiple!), id: 'q-multiple', type: 'multiple', shuffleAnswers: false },
      { ...structuredClone(single!), id: 'q-scale', type: 'scale', answers: [], scaleMin: 1, scaleMax: 3 },
      { ...structuredClone(single!), id: 'q-number', type: 'number', answers: [] },
      { ...structuredClone(single!), id: 'q-text', type: 'text', answers: [] },
    ]
    const store = new MemoryRuntimeStore()
    store.install(document, { allowPlaceholders: true })
    const transport = new FakeTransport()
    const engine = new FunnelEngine(store, transport)
    await engine.start(profile)
    await click(store, engine, { type: 'advance', handle: 'button_test' })
    await click(store, engine, { type: 'test_single' })
    await click(store, engine, { type: 'test_toggle' })
    await click(store, engine, { type: 'test_submit' })
    await click(store, engine, { type: 'test_value' })
    await engine.handleText(profile, '7,5')
    await engine.handleText(profile, 'Свободный ответ')

    const byQuestion = Object.fromEntries(store.answers.map((answer) => [answer.questionId, answer.value]))
    expect(byQuestion['q-single']).toEqual(expect.any(String))
    expect(byQuestion['q-multiple']).toEqual(expect.any(Array))
    expect([1, 2, 3]).toContain(byQuestion['q-scale'])
    expect(byQuestion['q-number']).toBe(7.5)
    expect(byQuestion['q-text']).toBe('Свободный ответ')
    expect(store.events.some((event) => event.type === 'test_completed')).toBe(true)
  })

  it('разделяет воронки, tracking и версии для новых/старых пользователей', async () => {
    const first = await loadDemo()
    first.bot.quietHours.enabled = false
    const store = new MemoryRuntimeStore()
    const v1 = store.install(first, { default: true })
    const transport = new FakeTransport()
    const engine = new FunnelEngine(store, transport)
    await engine.start({ ...profile, externalUserId: 'old-user' })

    const second = structuredClone(first)
    second.funnel.version = 2
    second.funnel.parentVersion = 1
    const v2 = store.install(second, { default: true })

    const other = structuredClone(first)
    other.funnel.id = 'other-funnel'
    other.funnel.key = 'other_funnel'
    other.funnel.name = 'Другая воронка'
    other.bot.trackingLinks = [{
      id: 'other-source',
      name: 'Другая ссылка',
      code: 'other-code',
      source: 'telegram',
      campaign: 'parallel',
      active: true,
    }]
    const otherVersion = store.install(other, { default: false })

    await engine.start({ ...profile, externalUserId: 'old-user' })
    await engine.start({ ...profile, externalUserId: 'new-user' })
    await engine.start({ ...profile, externalUserId: 'tracked-user' }, 'other-code')

    const old = await store.getUserByPlatformIdentity('telegram', 'old-user')
    const fresh = await store.getUserByPlatformIdentity('telegram', 'new-user')
    const tracked = await store.getUserByPlatformIdentity('telegram', 'tracked-user')
    expect((await store.findActiveSession(old!.id, v1.funnelId))?.versionId).toBe(v1.id)
    expect((await store.findActiveSession(fresh!.id, v2.funnelId))?.versionId).toBe(v2.id)
    const trackedSession = await store.findActiveSession(tracked!.id, otherVersion.funnelId)
    expect(trackedSession?.versionId).toBe(otherVersion.id)
    expect(trackedSession?.sourceTrackingId).toBe('other-source')
  })

  it('исполняет внешний redirect и продолжает только после подтверждённого клика', async () => {
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
        continueAfterClick: true,
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
    expect([...store.sessions.values()][0]?.status).toBe('waiting')
    const [token, redirect] = [...store.redirects.entries()][0]!
    expect(redirect.targetUrl).toBe('https://example.com/offer')
    expect(await engine.handleRedirect(token)).toBe('https://example.com/offer')
    const job = [...store.jobs.values()].find((item) => item.type === 'redirect_continue')
    await engine.handleJob(job!)
    expect([...store.sessions.values()][0]?.status).toBe('completed')
  })

  it('/stop отменяет активные сессии и фоновые задачи', async () => {
    const store = new MemoryRuntimeStore()
    const document = await loadDemo()
    store.install(document)
    const transport = new FakeTransport()
    const engine = new FunnelEngine(store, transport)
    await engine.start(profile)
    await engine.stop(profile)
    expect([...store.sessions.values()].every((session) => session.status === 'stopped')).toBe(true)
    expect([...store.jobs.values()].filter((job) => job.status === 'pending')).toHaveLength(0)
    expect((await store.getUserByPlatformIdentity('telegram', profile.externalUserId))?.backgroundBlocked).toBe(true)
  })

  it('resume job восстанавливает отправку после временной ошибки Telegram', async () => {
    const store = new MemoryRuntimeStore()
    store.install(await loadDemo())
    const transport = new FakeTransport()
    const sendText = transport.sendText.bind(transport)
    let failOnce = true
    transport.sendText = async (...args) => {
      if (failOnce) {
        failOnce = false
        throw new Error('TEMPORARY_TELEGRAM_ERROR')
      }
      await sendText(...args)
    }
    const engine = new FunnelEngine(store, transport)
    await expect(engine.start(profile)).rejects.toThrow('TEMPORARY_TELEGRAM_ERROR')
    const recovery = [...store.jobs.values()].find((job) => job.type === 'resume_session' && job.status === 'pending')
    expect(recovery).toBeDefined()
    await engine.handleJob(recovery!)
    expect(transport.texts.some((message) => message.text.includes('Здравствуйте'))).toBe(true)
    expect([...store.sessions.values()][0]?.status).toBe('waiting')
  })
})

async function click(
  store: MemoryRuntimeStore,
  engine: FunnelEngine,
  expected: { type: CallbackAction['type']; handle?: string | RegExp; accepted?: boolean },
) {
  const entries = [...store.callbacks.entries()].reverse()
  const found = entries.find(([, callback]) => {
    if (callback.consumedAt || callback.action.type !== expected.type) return false
    if (expected.handle !== undefined && callback.action.type === 'advance') {
      return typeof expected.handle === 'string'
        ? callback.action.handle === expected.handle
        : expected.handle.test(callback.action.handle)
    }
    if (expected.accepted !== undefined && callback.action.type === 'consent') return callback.action.accepted === expected.accepted
    return true
  })
  expect(found, `Не найдена callback ${JSON.stringify(expected)}`).toBeDefined()
  await engine.handleCallback(profile, found![0])
}
