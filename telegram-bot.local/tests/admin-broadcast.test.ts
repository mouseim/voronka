import type { Bot, Context } from 'grammy'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { AdminController, parsePrintCommand } from '../src/admin/controller'
import type { AdminRepository } from '../src/admin/repository'
import { loadConfig } from '../src/config'
import type { VkApi } from '../src/vk/api'
import type { VkMediaBindingService } from '../src/vk/media-bindings'
import type { VkMediaAttachment } from '../src/domain/types'

describe('admin /print', () => {
  it('разбирает target и optional URL-кнопку строго и нормализует scheme', () => {
    expect(parsePrintCommand('tg')).toEqual({ target: 'tg' })
    expect(parsePrintCommand(' vk [Подпишитесь на канал!|vk.com/popa] ')).toEqual({
      target: 'vk', button: { text: 'Подпишитесь на канал!', url: 'https://vk.com/popa' },
    })
    expect(parsePrintCommand('all [Сайт|http://example.com/path]')).toEqual({
      target: 'all', button: { text: 'Сайт', url: 'http://example.com/path' },
    })
    expect(parsePrintCommand('users')).toBeNull()
    expect(parsePrintCommand('tg [broken]')).toBeNull()
    expect(parsePrintCommand('tg [File|ftp://example.com]')).toBeNull()
  })

  it('применяет admin guard, отменяет только print-state и обрабатывает TTL', async () => {
    const runtime = broadcastRuntime([])
    await runtime.controller.handleCommand(runtime.context({ text: '/print wrong' }), 'print', 'wrong')
    expect(runtime.replies.at(-1)).toContain('Формат: /print')
    expect(runtime.input()).toBeUndefined()
    await runtime.controller.handleCommand(runtime.context({ text: '/print vk' }), 'print', 'vk')
    expect(runtime.replies.at(-1)).toBe('VK runtime не настроен. Рассылка не запущена.')
    expect(runtime.input()).toBeUndefined()
    await runtime.controller.handleCommand(runtime.context({ text: '/print tg' }, 2), 'print', 'tg')
    expect(runtime.replies.at(-1)).toBe('Доступ к админке запрещён.')
    expect(runtime.input()).toBeUndefined()

    await runtime.arm('tg')
    await runtime.controller.handleCommand(runtime.context({ text: '/cancel' }), 'cancel', '')
    expect(runtime.replies.at(-1)).toBe('Рассылка отменена.')
    expect(runtime.input()).toBeUndefined()
    ;(runtime.inputMap as Map<string, unknown>).set('1', { type: 'import' })
    await runtime.controller.handleCommand(runtime.context({ text: '/cancel' }), 'cancel', '')
    expect(runtime.replies.at(-1)).toBe('Нет ожидающей рассылки.')
    expect(runtime.input()).toMatchObject({ type: 'import' })

    ;(runtime.inputMap as Map<string, unknown>).delete('1')
    await runtime.arm('tg')
    ;(runtime.input() as { expiresAt: number }).expiresAt = 0
    await runtime.controller.handleText(runtime.context({ text: 'Не отправлять' }))
    expect(runtime.replies.at(-1)).toBe('Ожидание рассылки истекло. Запустите /print снова.')
    expect(runtime.listRecipients).not.toHaveBeenCalled()
  })

  it('копирует исходное Telegram message, очищает state до отправки и продолжает после ошибки', async () => {
    const runtime = broadcastRuntime([
      { platform: 'telegram', external_user_id: '10' },
      { platform: 'telegram', external_user_id: '20' },
      { platform: 'telegram', external_user_id: '30' },
    ])
    runtime.copyMessage.mockImplementation(async (recipient: string) => {
      expect(runtime.input()).toBeUndefined()
      if (recipient === '20') throw new Error('blocked')
      return {} as never
    })
    await runtime.arm('tg [Открыть сайт|example.com]')
    await runtime.controller.handleText(runtime.context({ text: '  Исходный\n\nтекст  ', message_id: 77 }))

    expect(runtime.copyMessage).toHaveBeenCalledTimes(3)
    expect(runtime.copyMessage).toHaveBeenNthCalledWith(1, '10', 99, 77, expect.objectContaining({ reply_markup: expect.anything() }))
    expect(runtime.replies.at(-1)).toBe('Рассылка завершена.\n\nTG: 2/3\nОшибок: 1')
  })

  it('рассылает точный VK text с open_link и не останавливается на одном recipient', async () => {
    const runtime = broadcastRuntime([
      { platform: 'vk', external_user_id: '101' },
      { platform: 'vk', external_user_id: '202' },
    ], true)
    runtime.sendVk.mockImplementation(async (recipient: string) => {
      if (recipient === '101') throw new Error('blocked')
      return 1
    })
    await runtime.arm('vk [Канал|vk.com/popa]')
    await runtime.controller.handleText(runtime.context({ text: '  VK\n\nтекст  ' }))

    expect(runtime.sendVk).toHaveBeenCalledTimes(2)
    expect(runtime.sendVk.mock.calls[1]?.[1]).toBe('  VK\n\nтекст  ')
    expect(JSON.parse(String(runtime.sendVk.mock.calls[1]?.[2]))).toMatchObject({
      inline: true, buttons: [[{ action: { type: 'open_link', link: 'https://vk.com/popa', label: 'Канал' } }]],
    })
    expect(runtime.replies.at(-1)).toBe('Рассылка завершена.\n\nVK: 1/2\nОшибок: 1')
  })

  it.each([
    ['photo', { photo: [{ file_id: 'photo', file_unique_id: 'photo-u' }], caption: '  Фото\nподпись  ' }, 'image', 'photo-1_11'],
    ['document', { document: { file_id: 'doc', file_unique_id: 'doc-u', file_name: 'guide.pdf', mime_type: 'application/pdf' }, caption: '  Документ\nподпись  ' }, 'document', 'doc-1_12'],
  ] as const)('один раз загружает %s и переиспользует VK attachment', async (kind, message, mediaType, attachment) => {
    const runtime = broadcastRuntime([
      { platform: 'vk', external_user_id: '101' },
      { platform: 'vk', external_user_id: '202' },
    ], true)
    runtime.upload.mockResolvedValue(mediaType === 'image'
      ? { type: 'photo', ownerId: -1, mediaId: 11 }
      : { type: 'doc', ownerId: -1, mediaId: 12 })
    await runtime.arm('vk')
    if (kind === 'document') await runtime.controller.handleDocument(runtime.context(message))
    else await runtime.controller.handleMedia(runtime.context(message))

    expect(runtime.download).toHaveBeenCalledTimes(1)
    expect(runtime.upload).toHaveBeenCalledTimes(1)
    expect(runtime.upload).toHaveBeenCalledWith('101', mediaType, expect.objectContaining({ content: Buffer.from('file') }))
    expect(runtime.sendVk).toHaveBeenCalledTimes(2)
    expect(runtime.sendVk.mock.calls.every((call) => call[1] === message.caption && call[3] === attachment)).toBe(true)
  })
})

function broadcastRuntime(
  recipients: Array<{ platform: 'telegram' | 'vk'; external_user_id: string }>,
  withVk = false,
) {
  const replies: string[] = []
  const copyMessage = vi.fn(async (_recipient: string, _fromChatId: number, _messageId: number, _options: unknown) => ({}))
  const listRecipients = vi.fn(async () => recipients)
  const repository = { listBroadcastRecipients: listRecipients }
  const upload = vi.fn(async (_peerId: string, _mediaType: 'image' | 'document', _file: unknown): Promise<VkMediaAttachment> => ({ type: 'photo', ownerId: -1, mediaId: 11 }))
  const sendVk = vi.fn(async (_recipient: string, _message: string, _keyboard?: string, _attachment?: string) => 1)
  const bot = { api: { copyMessage } } as unknown as Bot
  const config = loadConfig({ TELEGRAM_BOT_TOKEN: 'token', DATABASE_URL: 'postgresql://localhost/test', ADMIN_TELEGRAM_IDS: '1' })
  const controller = new AdminController(
    bot,
    repository as unknown as AdminRepository,
    config,
    pino({ level: 'silent' }),
    withVk ? ({ uploadForBroadcast: upload } as unknown as VkMediaBindingService) : undefined,
    withVk ? ({ sendMessage: sendVk } as unknown as VkApi) : undefined,
  )
  const inputMap = (controller as unknown as { input: Map<string, unknown> }).input
  const download = vi.fn(async () => Buffer.from('file'))
  ;(controller as unknown as { downloadTelegramFile: typeof download }).downloadTelegramFile = download
  const context = (message: Record<string, unknown>, adminId = 1) => ({
    from: { id: adminId },
    chat: { id: 99 },
    message: { message_id: 7, ...message },
    reply: vi.fn(async (text: string) => { replies.push(text); return {} }),
  }) as unknown as Context
  return {
    controller, replies, copyMessage, listRecipients, upload, sendVk, download, inputMap, context,
    arm: (args: string) => controller.handleCommand(context({ text: `/print ${args}` }), 'print', args),
    input: () => inputMap.get('1'),
  }
}
