import { describe, expect, it } from 'vitest'
import type { FunnelDocument } from '../src/core/shared'
import { loadConfig } from '../src/config'
import type { PlatformProfile } from '../src/domain/types'
import { FunnelEngine } from '../src/runtime/engine'
import { MemoryRuntimeStore } from '../src/runtime/memory-store'
import { VkApiClient, type VkApi, type VkLongPollServer } from '../src/vk/api'
import { normalizeVkKeyboardRows, toVkKeyboard, VkTransport } from '../src/vk/transport'
import { VkUpdateAdapter, type VkLongPollUpdate } from '../src/vk/updates'
import { FakeTransport, loadDemo, profile } from './helpers'

describe('VK MVP', () => {
  it('разделяет одинаковые external ID Telegram и VK', async () => {
    const store = new MemoryRuntimeStore()
    const telegram: PlatformProfile = { platform: 'telegram', externalUserId: '42' }
    const vk: PlatformProfile = { platform: 'vk', externalUserId: '42' }

    const telegramUser = await store.upsertUser(telegram)
    const vkUser = await store.upsertUser(vk)

    expect(telegramUser.id).not.toBe(vkUser.id)
    expect(store.users).toHaveLength(2)
    expect(await store.getUserByPlatformIdentity('telegram', '42')).toMatchObject({ platform: 'telegram' })
    expect(await store.getUserByPlatformIdentity('vk', '42')).toMatchObject({ platform: 'vk' })
  })

  it('запускает default funnel, отправляет VK keyboard и исполняет branch payload', async () => {
    const document = await branchDocument()
    const runtime = vkRuntime(document)

    await runtime.adapter.handle(messageUpdate(101, 'Привет', 1))

    expect(runtime.api.messages).toHaveLength(1)
    expect(runtime.api.messages[0]).toMatchObject({ peerId: '101', message: 'Выберите путь' })
    const keyboard = JSON.parse(runtime.api.messages[0]!.keyboard!) as {
      inline: boolean
      buttons: Array<Array<{ action: { type: string; label: string; payload: string } }>>
    }
    expect(keyboard.inline).toBe(true)
    expect(keyboard.buttons[0]![0]!.action).toMatchObject({ type: 'callback', label: 'Продолжить' })
    const payload = JSON.parse(keyboard.buttons[0]![0]!.action.payload) as { callbackToken: string }

    await runtime.adapter.handle(buttonUpdate(101, payload, 'event-1'))

    expect(runtime.api.answers).toEqual([{ eventId: 'event-1', userId: '101', peerId: '101' }])
    expect(runtime.api.messages.at(-1)?.message).toBe('Готово')
    expect([...runtime.store.sessions.values()][0]?.status).toBe('completed')
  })

  it('преобразует URL button в официальный VK open_link action', async () => {
    const api = new FakeVkApi()
    const transport = new VkTransport(api)

    await transport.sendText('101', 'Ссылка', [[{ text: 'Открыть', url: 'https://example.com' }]])

    const keyboard = JSON.parse(api.messages[0]!.keyboard!) as { buttons: Array<Array<{ action: Record<string, string> }>> }
    expect(keyboard.buttons[0]![0]!.action).toEqual({ type: 'open_link', link: 'https://example.com', label: 'Открыть' })
  })

  it.each([1, 2, 3, 4, 5, 6])('сохраняет допустимую VK раскладку из %i строк', (count) => {
    const rows = Array.from({ length: count }, (_, index) => [{ text: String(index + 1), callbackToken: `cb-${index + 1}` }])
    expect(normalizeVkKeyboardRows(rows)).toEqual(rows)
  })

  it.each([7, 10, 13])('уплотняет %i VK кнопок до лимитов 6×5 с сохранением порядка', (count) => {
    const rows = Array.from({ length: count }, (_, index) => [{ text: String(index + 1), callbackToken: `cb-${index + 1}` }])
    const normalized = normalizeVkKeyboardRows(rows)
    expect(normalized.length).toBeLessThanOrEqual(6)
    expect(normalized.every((row) => row.length <= 5)).toBe(true)
    expect(normalized.flat().map((button) => button.text)).toEqual(Array.from({ length: count }, (_, index) => String(index + 1)))
  })

  it('сохраняет callback и URL actions при VK normalization', () => {
    const rows = Array.from({ length: 7 }, (_, index) => index % 2
      ? [{ text: `URL ${index}`, url: `https://example.com/${index}` }]
      : [{ text: `CB ${index}`, callbackToken: `cb-${index}` }])
    const keyboard = toVkKeyboard(rows)
    const actions = keyboard.buttons.flat().map((button) => button.action)
    expect(actions.map((action) => action.label)).toEqual(rows.flat().map((button) => button.text))
    expect(actions.some((action) => action.type === 'callback' && 'payload' in action)).toBe(true)
    expect(actions.some((action) => action.type === 'open_link' && 'link' in action)).toBe(true)
  })

  it('возвращает controlled error вместо обрезки переполненной VK keyboard', () => {
    const rows = Array.from({ length: 31 }, (_, index) => [{ text: String(index), callbackToken: `cb-${index}` }])
    expect(() => toVkKeyboard(rows)).toThrow('VK_KEYBOARD_OVERFLOW:31:MAX_30')
  })

  it('показывает VK single варианты полностью в тексте и связывает цифры с shuffled answer ID', async () => {
    const document = await testQuestionDocument('single', true)
    const runtime = vkRuntime(document)
    await runtime.adapter.handle(messageUpdate(505, 'Начать', 1))

    const session = [...runtime.store.sessions.values()][0]!
    const order = session.state.testRun!.answerOrder['question']!
    const question = document.tests[0]!.questions[0]!
    const message = runtime.api.messages.at(-1)!
    order.forEach((answerId, index) => {
      const answer = question.answers.find((item) => item.id === answerId)!
      expect(message.message).toContain(`${index + 1}. ${answer.text}`)
    })
    const keyboard = JSON.parse(message.keyboard!) as { buttons: Array<Array<{ action: { label: string; payload: string } }>> }
    const buttons = keyboard.buttons.flat()
    expect(buttons.map((button) => button.action.label)).toEqual(order.map((_, index) => String(index + 1)))
    buttons.forEach((button, index) => {
      const token = (JSON.parse(button.action.payload) as { callbackToken: string }).callbackToken
      expect(runtime.store.callbacks.get(token)?.action).toMatchObject({ type: 'test_single', answerId: order[index] })
    })
  })

  it('показывает VK multiple цифрами и отмечает выбранный номер', async () => {
    const document = await testQuestionDocument('multiple', false)
    const runtime = vkRuntime(document)
    await runtime.adapter.handle(messageUpdate(606, 'Начать', 1))
    const initial = JSON.parse(runtime.api.messages.at(-1)!.keyboard!) as { buttons: Array<Array<{ action: { label: string; payload: string } }>> }
    const first = initial.buttons.flat().find((button) => button.action.label === '▫️ 1')!
    await runtime.adapter.handle(buttonUpdate(606, JSON.parse(first.action.payload), 'multiple-1'))

    const updated = runtime.api.messages.at(-1)!
    expect(updated.message).toContain('1. Очень длинный и понятный вариант ответа номер один')
    const keyboard = JSON.parse(updated.keyboard!) as { buttons: Array<Array<{ action: { label: string } }>> }
    expect(keyboard.buttons.flat().map((button) => button.action.label)).toEqual(expect.arrayContaining(['✅ 1', '▫️ 2', '▫️ 3', 'Готово']))
  })

  it('не меняет полные Telegram labels вариантов теста', async () => {
    const document = await testQuestionDocument('single', false)
    const store = new MemoryRuntimeStore()
    store.install(document)
    const transport = new FakeTransport()
    await new FunnelEngine(store, transport).start(profile)

    const questionMessage = transport.texts.at(-1)!
    expect(questionMessage.text).not.toContain('\n\n1. Очень длинный')
    expect(questionMessage.buttons?.flat().map((button) => button.text)).toEqual(document.tests[0]!.questions[0]!.answers.map((answer) => answer.text))
  })

  it('исполняет variables и conditions тем же FunnelEngine', async () => {
    const document = await variableDocument()
    const runtime = vkRuntime(document)

    await runtime.adapter.handle(messageUpdate(202, 'Начать', 1))

    expect(runtime.api.messages.at(-1)?.message).toBe('Баллы: 2')
    expect([...runtime.store.sessions.values()][0]?.state.variables).toMatchObject({ score: 2 })
  })

  it('возобновляет сохранённую session после пересоздания VK adapter', async () => {
    const document = await branchDocument()
    const runtime = vkRuntime(document)
    await runtime.adapter.handle(messageUpdate(303, 'Привет', 1))
    const restartedAdapter = new VkUpdateAdapter(runtime.store, runtime.engine, runtime.api)

    await restartedAdapter.handle(messageUpdate(303, 'Начать', 2))

    expect(runtime.store.sessions).toHaveLength(1)
    expect(runtime.api.messages.filter((message) => message.message === 'Выберите путь')).toHaveLength(2)
  })

  it('передаёт message.ref как tracking code при старте VK', async () => {
    const document = await branchDocument()
    document.bot.trackingLinks = [{
      id: 'vk-link', name: 'VK реклама', code: 'vk_ads_launch', platform: 'vk',
      source: 'vk_ads', campaign: 'launch', active: true,
    }]
    const runtime = vkRuntime(document)

    await runtime.adapter.handle(messageUpdate(304, 'Начать', 1, 'vk_ads_launch'))

    expect([...runtime.store.sessions.values()][0]).toMatchObject({ sourceTrackingId: 'vk-link', sourceCode: 'vk_ads_launch' })
  })

  it('обрабатывает message_deny/message_allow без сообщений и новых сессий', async () => {
    const runtime = vkRuntime(await branchDocument())
    await runtime.adapter.handle(messageUpdate(305, 'Начать', 1))
    const session = [...runtime.store.sessions.values()][0]!
    await runtime.store.scheduleJob({
      uniqueKey: 'vk-deny-job', type: 'reminder', payload: { sessionId: session.id },
      dueAt: new Date().toISOString(), maxAttempts: 1,
    })
    const messagesBefore = runtime.api.messages.length

    await expect(runtime.adapter.handle(permissionUpdate('message_deny', 305, 'deny-1'))).resolves.toBe(true)
    expect(await runtime.store.getUserByPlatformIdentity('vk', '305')).toMatchObject({ optedOutAt: expect.any(String), backgroundBlocked: true })
    expect((await runtime.store.getSession(session.id))?.status).toBe('stopped')
    expect([...runtime.store.jobs.values()][0]?.status).toBe('cancelled')
    expect(runtime.api.messages).toHaveLength(messagesBefore)
    await expect(runtime.adapter.handle(permissionUpdate('message_deny', 305, 'deny-2'))).resolves.toBe(true)

    const sessionsBeforeAllow = runtime.store.sessions.size
    await expect(runtime.adapter.handle(permissionUpdate('message_allow', 305, 'allow-1'))).resolves.toBe(true)
    expect(await runtime.store.getUserByPlatformIdentity('vk', '305')).toMatchObject({ optedOutAt: null, backgroundBlocked: false })
    expect(runtime.store.sessions.size).toBe(sessionsBeforeAllow)
    expect(runtime.api.messages).toHaveLength(messagesBefore)
    await expect(runtime.adapter.handle(permissionUpdate('message_allow', 305, 'allow-2'))).resolves.toBe(true)
  })

  it('явно отклоняет достижимый VK product как unsupported capability', async () => {
    const document = await unsupportedProductDocument()
    const runtime = vkRuntime(document)

    await expect(runtime.engine.start({ platform: 'vk', externalUserId: '404' }))
      .rejects.toThrow('UNSUPPORTED_PLATFORM_CAPABILITY:vk:payments:product-node')
    expect(runtime.api.messages.at(-1)?.message).toContain('неподдерживаемую на vk возможность: payments:product-node')
    expect(runtime.store.sessions).toHaveLength(0)
  })

  it('не требует VK env для Telegram-only конфигурации', () => {
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'telegram-test-token',
      DATABASE_URL: 'postgresql://user:password@localhost:5432/voronka',
    })
    expect(config.vk).toBeNull()
  })

  it('VkApiClient отправляет messages.send по API 5.199 с random_id и keyboard', async () => {
    let request: { url: string; body: URLSearchParams } | undefined
    const fetcher: typeof fetch = async (input, init) => {
      request = { url: String(input), body: new URLSearchParams(String(init?.body)) }
      return new Response(JSON.stringify({ response: 77 }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const client = new VkApiClient('vk-test-token', '123', '5.199', fetcher, () => 456)

    expect(await client.sendMessage('101', 'Текст', '{"inline":true}')).toBe(77)
    expect(request?.url).toBe('https://api.vk.com/method/messages.send')
    expect(Object.fromEntries(request!.body)).toMatchObject({
      access_token: 'vk-test-token',
      v: '5.199',
      peer_id: '101',
      random_id: '456',
      message: 'Текст',
      keyboard: '{"inline":true}',
    })
  })

  it('ACK VK callback не отправляет пустой event_data', async () => {
    let request: { url: string; body: URLSearchParams } | undefined
    const fetcher: typeof fetch = async (input, init) => {
      request = { url: String(input), body: new URLSearchParams(String(init?.body)) }
      return new Response(JSON.stringify({ response: 1 }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const client = new VkApiClient('vk-test-token', '123', '5.199', fetcher)

    await client.answerMessageEvent('event-1', '101', '101')

    expect(request?.url).toBe('https://api.vk.com/method/messages.sendMessageEventAnswer')
    expect(Object.fromEntries(request!.body)).toMatchObject({ event_id: 'event-1', user_id: '101', peer_id: '101' })
    expect(request!.body.has('event_data')).toBe(false)
  })
})

class FakeVkApi implements VkApi {
  readonly messages: Array<{ peerId: string; message: string; keyboard?: string; attachment?: string }> = []
  readonly answers: Array<{ eventId: string; userId: string; peerId: string }> = []

  async sendMessage(peerId: string, message: string, keyboard?: string, attachment?: string) {
    this.messages.push({ peerId, message, keyboard, attachment })
    return this.messages.length
  }

  async getLongPollServer(): Promise<VkLongPollServer> {
    return { key: 'key', server: 'https://lp.vk.com', ts: '1' }
  }

  async answerMessageEvent(eventId: string, userId: string, peerId: string) {
    this.answers.push({ eventId, userId, peerId })
  }

  async getMessagesPhotoUploadServer() { return { upload_url: 'https://upload.example/photo' } }
  async saveMessagesPhoto() { return [] }
  async getMessagesDocumentUploadServer() { return { upload_url: 'https://upload.example/doc' } }
  async saveDocument() { return { type: 'doc' } }
}

function vkRuntime(document: FunnelDocument) {
  const store = new MemoryRuntimeStore()
  store.install(document)
  const api = new FakeVkApi()
  const engine = new FunnelEngine(store, new VkTransport(api))
  const adapter = new VkUpdateAdapter(store, engine, api)
  return { store, api, engine, adapter }
}

function messageUpdate(userId: number, text: string, id: number, ref?: string): VkLongPollUpdate {
  return {
    type: 'message_new',
    object: { message: { id, conversation_message_id: id, date: 1_800_000_000 + id, from_id: userId, peer_id: userId, text, ref } },
  }
}

function buttonUpdate(userId: number, payload: object, eventId: string): VkLongPollUpdate {
  return { type: 'message_event', object: { user_id: userId, peer_id: userId, event_id: eventId, payload } }
}

function permissionUpdate(type: 'message_deny' | 'message_allow', userId: number, eventId: string): VkLongPollUpdate {
  return { type, event_id: eventId, object: { user_id: userId } }
}

async function branchDocument() {
  const document = await loadDemo()
  const start = document.nodes.find((node) => node.type === 'start')!
  document.nodes = [
    start,
    { id: 'choice', type: 'message', data: { title: 'Выбор', text: 'Выберите путь', buttons: [{ id: 'continue', text: 'Продолжить', action: 'branch' }] } },
    { id: 'end', type: 'end', data: { title: 'Финиш', text: 'Готово' } },
  ]
  document.edges = [
    { id: 'start-choice', source: start.id, target: 'choice', sourceHandle: 'next' },
    { id: 'choice-end', source: 'choice', target: 'end', sourceHandle: 'continue' },
  ]
  document.assets = []
  document.products = []
  document.tests = []
  return document
}

async function variableDocument() {
  const document = await loadDemo()
  const start = document.nodes.find((node) => node.type === 'start')!
  document.variables = [{ id: 'score', key: 'score', name: 'Баллы', type: 'number', defaultValue: 0 }]
  document.nodes = [
    start,
    { id: 'set', type: 'variable', data: { title: 'Начислить', operations: [{ id: 'add', variableId: 'score', operation: 'add', value: 2 }] } },
    { id: 'condition', type: 'condition', data: { title: 'Проверить', variableId: 'score', operator: 'greater_or_equal', value: 2 } },
    { id: 'yes', type: 'message', data: { title: 'Да', text: 'Баллы: {{score}}', buttons: [] } },
    { id: 'no', type: 'end', data: { title: 'Нет', text: 'Ошибка' } },
  ]
  document.edges = [
    { id: 'start-set', source: start.id, target: 'set', sourceHandle: 'next' },
    { id: 'set-condition', source: 'set', target: 'condition', sourceHandle: 'next' },
    { id: 'condition-yes', source: 'condition', target: 'yes', sourceHandle: 'true' },
    { id: 'condition-no', source: 'condition', target: 'no', sourceHandle: 'false' },
  ]
  document.assets = []
  document.products = []
  document.tests = []
  return document
}

async function unsupportedProductDocument() {
  const document = await loadDemo()
  const start = document.nodes.find((node) => node.type === 'start')!
  const product = document.products[0]!
  document.nodes = [
    start,
    { id: 'product-node', type: 'product', data: { title: 'Продукт', productId: product.id, headline: product.name, description: '', price: product.price, payButtonText: 'Купить', allowSkip: false } },
    { id: 'end', type: 'end', data: { title: 'Финиш', text: 'Готово' } },
  ]
  document.edges = [
    { id: 'start-product', source: start.id, target: 'product-node', sourceHandle: 'next' },
    { id: 'product-end', source: 'product-node', target: 'end', sourceHandle: 'paid' },
  ]
  document.assets = []
  document.tests = []
  return document
}

async function testQuestionDocument(type: 'single' | 'multiple', shuffleAnswers: boolean) {
  const document = await loadDemo()
  const start = document.nodes.find((node) => node.type === 'start')!
  const sourceTest = structuredClone(document.tests[0]!)
  const question = structuredClone(sourceTest.questions[0]!)
  question.id = 'question'
  question.type = type
  question.shuffleAnswers = shuffleAnswers
  question.required = true
  question.answers = question.answers.slice(0, 3).map((answer, index) => ({
    ...answer,
    id: `answer-${index + 1}`,
    text: ['Очень длинный и понятный вариант ответа номер один', 'Второй полный вариант, который нельзя сокращать', 'Третий развёрнутый вариант ответа'][index]!,
  }))
  sourceTest.questions = [question]
  sourceTest.shuffleQuestions = false
  sourceTest.combinedResults = []
  sourceTest.results.forEach((result) => { result.assetId = undefined; result.buttons = [] })
  document.tests = [sourceTest]
  document.assets = []
  document.products = []
  document.nodes = [
    start,
    { id: 'test-node', type: 'test', data: { title: 'Тест', testId: sourceTest.id, welcomeText: '' } },
    { id: 'end', type: 'end', data: { title: 'Конец', text: 'Готово' } },
  ]
  document.edges = [
    { id: 'start-test', source: start.id, target: 'test-node', sourceHandle: 'next' },
    ...sourceTest.results.map((result) => ({ id: `result-${result.id}`, source: 'test-node', target: 'end', sourceHandle: result.id })),
  ]
  return document
}
