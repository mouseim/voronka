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
  uniqueTrackingCode,
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
  it('старый расширенный файл отклоняется понятным сообщением', () => {
    const result = parseAndMigrateFunnelDocument({ documentType: 'funnel', schemaVersion: '1.0.0' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.errors[0]).toContain('старой расширенной версии')
  })

  it('создаёт уникальные стабильные tracking-коды', () => {
    const document = createEmptyFunnel()
    expect(uniqueTrackingCode(document, 'Instagram', 'Test July')).toBe('instagram_test_july')
    document.bot.trackingLinks.push({ id: 'link', name: 'Первая', code: 'instagram_test_july', source: 'Instagram', campaign: 'Test July', active: true })
    expect(uniqueTrackingCode(document, 'Instagram', 'Test July')).toBe('instagram_test_july_2')
    expect(document.bot.trackingLinks[0].code).toBe('instagram_test_july')
  })

  it('строит Telegram deep link из username и кода', () => {
    expect(telegramDeepLink('@my_bot', 'instagram_test_july')).toBe('https://t.me/my_bot?start=instagram_test_july')
    expect(telegramDeepLink('', 'code')).toBeNull()
  })

  it('новая версия сбрасывает только статистику', () => {
    const source = freshDemoFunnel()
    const next = createNewVersion(source)
    expect(next.funnel.version).toBe(2)
    expect(next.analytics.snapshotAt).toBeNull()
    expect(next.analytics.summary.started).toBe(0)
    expect(next.nodes).toEqual(source.nodes)
    expect(source.analytics.summary.started).toBeGreaterThan(0)
  })
})
