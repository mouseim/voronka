import { describe, expect, it } from 'vitest'
import {
  addMessageBranch,
  createEmptyFunnel,
  createNewVersion,
  createNode,
  nodeHandles,
  removeMessageButton,
  renameMessageButton,
  telegramDeepLink,
  trackingCodeBase,
  uniqueTrackingCode,
  vkDeepLink,
} from './funnel'
import { freshDemoFunnel } from './demo'
import { parseAndMigrateFunnelDocument } from './schema'
import type { ConsentData, MessageData, ProductBlockData } from './types'

describe('упрощённый граф', () => {
  it('сообщение без кнопок имеет один обычный выход', () => {
    const message = createNode('message')
    ;(message.data as MessageData).buttons = []
    expect(nodeHandles(message)).toEqual([{ id: 'next', label: 'Далее' }])
  })

  it('сообщение с тремя кнопками имеет три стабильных выхода', () => {
    const message = createNode('message')
    ;(message.data as MessageData).buttons = [
      { id: 'yes', text: 'Да', action: 'branch' },
      { id: 'later', text: 'Позже', action: 'branch' },
      { id: 'no', text: 'Нет', action: 'branch' },
    ]
    expect(nodeHandles(message).map((handle) => handle.id)).toEqual(['yes', 'later', 'no'])
  })

  it('добавление кнопки создаёт новый доступный выход', () => {
    const document = createEmptyFunnel()
    const message = createNode('message')
    ;(message.data as MessageData).buttons = []
    document.nodes.push(message)
    const result = addMessageBranch(document, message.id, 'Получить подарок')
    const updated = result.document.nodes.find((node) => node.id === message.id)!
    expect(nodeHandles(updated)).toContainEqual({ id: result.buttonId, label: 'Получить подарок' })
  })

  it('переименование кнопки сохраняет handle и связанную стрелку', () => {
    const document = createEmptyFunnel()
    const message = createNode('message')
    const end = createNode('end')
    ;(message.data as MessageData).buttons = [{ id: 'stable_button', text: 'Старое имя', action: 'branch' }]
    document.nodes.push(message, end)
    document.edges.push({ id: 'edge', source: message.id, target: end.id, sourceHandle: 'stable_button', label: 'Старое имя' })
    const renamed = renameMessageButton(document, message.id, 'stable_button', 'Новое имя')
    expect(renamed.edges[0]).toMatchObject({ sourceHandle: 'stable_button', label: 'Новое имя' })
  })

  it('удаление кнопки удаляет только связанную с ней стрелку', () => {
    const document = createEmptyFunnel()
    const message = createNode('message')
    const end = createNode('end')
    ;(message.data as MessageData).buttons = [{ id: 'remove', text: 'Удалить', action: 'branch' }, { id: 'keep', text: 'Оставить', action: 'branch' }]
    document.nodes.push(message, end)
    document.edges.push(
      { id: 'remove_edge', source: message.id, target: end.id, sourceHandle: 'remove' },
      { id: 'keep_edge', source: message.id, target: end.id, sourceHandle: 'keep' },
    )
    const result = removeMessageButton(document, message.id, 'remove')
    expect(result.edges.map((edge) => edge.id)).toEqual(['keep_edge'])
  })

  it('ветви согласия независимы', () => {
    const consent = createNode('consent')
    expect(nodeHandles(consent).map((handle) => handle.id)).toEqual(['accepted', 'declined'])
    ;(consent.data as ConsentData).declineEnabled = false
    expect(nodeHandles(consent).map((handle) => handle.id)).toEqual(['accepted'])
  })

  it('ветви оплаты независимы и skip зависит от настройки', () => {
    const product = createNode('product')
    expect(nodeHandles(product).map((handle) => handle.id)).toEqual(['paid', 'failed', 'already_purchased', 'skip'])
    ;(product.data as ProductBlockData).allowSkip = false
    expect(nodeHandles(product).map((handle) => handle.id)).toEqual(['paid', 'failed', 'already_purchased'])
  })
})

describe('формат, ссылки и версии', () => {
  it('создаёт новую воронку без демонстрационных tracking links', () => {
    expect(createEmptyFunnel().bot.trackingLinks).toEqual([])
  })

  it('старый расширенный файл отклоняется понятным сообщением', () => {
    const result = parseAndMigrateFunnelDocument({ documentType: 'funnel', schemaVersion: '1.0.0' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.errors[0]).toContain('старой расширенной версии')
  })

  it('создаёт уникальные стабильные tracking-коды', () => {
    const document = createEmptyFunnel()
    expect(trackingCodeBase('telegram', 'Instagram', 'Test July', 'Reels 15')).toBe('telegram_instagram_test_july_reels_15')
    expect(uniqueTrackingCode(document, 'telegram', 'Instagram', 'Test July')).toBe('telegram_instagram_test_july')
    document.bot.trackingLinks.push({ id: 'link', name: 'Первая', code: 'telegram_instagram_test_july', source: 'Instagram', campaign: 'Test July', active: true })
    expect(uniqueTrackingCode(document, 'telegram', 'Instagram', 'Test July')).toBe('telegram_instagram_test_july_2')
    expect(uniqueTrackingCode(document, 'telegram', 'Instagram', 'Test July', undefined, 'link')).toBe('telegram_instagram_test_july')
    expect(document.bot.trackingLinks[0].code).toBe('telegram_instagram_test_july')
  })

  it('строит Telegram и VK deep links', () => {
    expect(telegramDeepLink('@my_bot', 'instagram_test_july')).toBe('https://t.me/my_bot?start=instagram_test_july')
    expect(telegramDeepLink('', 'code')).toBeNull()
    expect(vkDeepLink('@my_group', 'vk_instagram_launch')).toBe('https://vk.me/my_group?ref=vk_instagram_launch')
    expect(vkDeepLink('123456', 'vk_ads')).toBe('https://vk.com/write-123456?ref=vk_ads')
    expect(vkDeepLink('https://vk.com/club123456', 'blogger_sep')).toBe('https://vk.com/write-123456?ref=blogger_sep')
    expect(vkDeepLink('https://vk.com/my_group', 'launch')).toBe('https://vk.me/my_group?ref=launch')
    expect(vkDeepLink('', 'code')).toBeNull()
  })

  it('считает старую tracking link без platform ссылкой Telegram', () => {
    const source = createEmptyFunnel()
    source.bot.trackingLinks.push({
      id: 'legacy_link',
      name: 'Legacy',
      code: 'legacy_code',
      source: 'legacy',
      campaign: 'legacy',
      active: true,
    })
    const parsed = parseAndMigrateFunnelDocument(JSON.parse(JSON.stringify(source)))
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.document.bot.trackingLinks).toHaveLength(1)
      expect(parsed.document.bot.trackingLinks[0]?.platform).toBe('telegram')
      expect(parsed.document.bot.trackingLinks[0]?.locked).toBe(true)
    }
  })

  it('новая версия сбрасывает только статистику', () => {
    const source = freshDemoFunnel()
    source.analytics.snapshotAt = '2026-01-01T00:00:00.000Z'
    source.analytics.summary.started = 42
    source.analytics.nodes.fixture = { entered: 42, completed: 10 }

    const next = createNewVersion(source)

    expect(next.funnel.version).toBe(source.funnel.version + 1)
    expect(next.analytics.snapshotAt).toBeNull()
    expect(next.analytics.summary.started).toBe(0)
    expect(next.nodes).toEqual(source.nodes)
    expect(source.analytics.summary.started).toBe(42)
  })
})
