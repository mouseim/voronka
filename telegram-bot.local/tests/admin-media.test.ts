import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { Bot, Context } from 'grammy'
import { AdminController } from '../src/admin/controller'
import type { AdminRepository } from '../src/admin/repository'
import { loadConfig } from '../src/config'
import type { MediaType } from '../src/core/shared'
import type { VkMediaAttachment } from '../src/domain/types'
import type { VkMediaBindingService } from '../src/vk/media-bindings'

describe('Telegram admin VK media UX', () => {
  it('показывает независимые TG/VK actions и выбор недавнего VK peer', async () => {
    const runtime = adminRuntime([{ peer_id: '101', first_name: 'Анна', username: null }, { peer_id: '202', first_name: null, username: 'boris' }])
    await runtime.execute({ type: 'media_info', versionId: 'version', assetId: 'asset' })
    expect(runtime.actionTypes()).toEqual(expect.arrayContaining(['media_upload', 'media_test', 'media_unbind', 'vk_media_upload', 'vk_media_unbind']))

    await runtime.execute({ type: 'vk_media_upload', versionId: 'version', assetId: 'asset', expectedType: 'image' })
    const peers = runtime.actions().filter((action) => action.type === 'vk_media_peer') as Array<{ type: string; peerId: string }>
    expect(peers.map((action) => action.peerId)).toEqual(['101', '202'])
    await runtime.execute(peers[1]!)
    expect(runtime.input()).toMatchObject({ type: 'vk_media', versionId: 'version', assetId: 'asset', expectedType: 'image', peerId: '202' })
  })

  it('объясняет отсутствие VK peer без ручного ввода ID', async () => {
    const runtime = adminRuntime([])
    await runtime.execute({ type: 'vk_media_upload', versionId: 'version', assetId: 'asset', expectedType: 'image' })
    expect(runtime.replies.at(-1)?.[0]).toContain('Сначала напишите VK-боту «Начать»')
    expect(runtime.input()).toBeUndefined()
  })

  it.each([
    ['image', { photo: [{ file_id: 'photo', file_unique_id: 'photo-u' }] }, { type: 'photo', ownerId: -1, mediaId: 11 }],
    ['document', { document: { file_id: 'doc', file_unique_id: 'doc-u', file_name: 'guide.pdf', mime_type: 'application/pdf' } }, { type: 'doc', ownerId: -1, mediaId: 12 }],
    ['voice', { voice: { file_id: 'voice', file_unique_id: 'voice-u', mime_type: 'audio/ogg' } }, { type: 'audio_message', ownerId: -1, mediaId: 13 }],
  ] as const)('загружает %s в VK и сразу обновляет карточку', async (expectedType, message, attachment) => {
    const runtime = adminRuntime([{ peer_id: '101', first_name: 'Анна', username: null }], expectedType, false)
    runtime.upload.mockResolvedValue(attachment)
    await runtime.execute({ type: 'vk_media_upload', versionId: 'version', assetId: 'asset', expectedType })
    const handled = await runtime.controller.handleMedia(runtime.context(message))

    expect(handled).toBe(true)
    expect(runtime.upload).toHaveBeenCalledWith(expect.objectContaining({
      versionId: 'version', assetId: 'asset', mediaType: expectedType, peerId: '101', adminTelegramId: '1',
      file: expect.objectContaining({ content: Buffer.from('file') }),
    }))
    expect(runtime.replies.at(-1)?.[0]).toContain('VK: ✅')
    expect(runtime.row.telegram_bound).toBe(true)
    expect(runtime.row.vk_bound).toBe(true)
  })

  it('удаляет только VK binding и сохраняет Telegram binding', async () => {
    const runtime = adminRuntime([])
    await runtime.execute({ type: 'vk_media_unbind', versionId: 'version', assetId: 'asset' })
    expect(runtime.unbind).toHaveBeenCalledWith('version', 'asset', '1', 'vk')
    expect(runtime.row.telegram_bound).toBe(true)
    expect(runtime.row.vk_bound).toBe(false)
    expect(runtime.replies.at(-1)?.[0]).toContain('VK: ❓ не привязан')
  })

  it('привязывает VK-видео текстовым шагом без UUID и peer ID', async () => {
    const runtime = adminRuntime([], 'video', false)
    runtime.bindExisting.mockResolvedValue({ type: 'video', ownerId: -237, mediaId: 456 })
    await runtime.execute({ type: 'vk_media_upload', versionId: 'version', assetId: 'asset', expectedType: 'video' })
    const handled = await runtime.controller.handleText(runtime.context({ text: 'https://vkvideo.ru/video-237_456' }))
    expect(handled).toBe(true)
    expect(runtime.bindExisting).toHaveBeenCalledWith('version', 'asset', 'https://vkvideo.ru/video-237_456', '1')
  })

  it('показывает понятную ошибку VK upload и сохраняет шаг для повтора', async () => {
    const runtime = adminRuntime([{ peer_id: '101', first_name: 'Анна', username: null }])
    runtime.upload.mockRejectedValue(new Error('VK_HTTP_ERROR:500'))
    await runtime.execute({ type: 'vk_media_upload', versionId: 'version', assetId: 'asset', expectedType: 'image' })
    await runtime.controller.handleMedia(runtime.context({ photo: [{ file_id: 'photo', file_unique_id: 'photo-u' }] }))
    expect(runtime.replies.at(-1)?.[0]).toContain('VK временно не принял загрузку')
    expect(runtime.replies.at(-1)?.[0]).not.toContain('VK_HTTP_ERROR')
    expect(runtime.input()).toMatchObject({ type: 'vk_media', assetId: 'asset' })
  })
})

function adminRuntime(
  peers: Array<{ peer_id: string; first_name: string | null; username: string | null }>,
  expectedType: MediaType = 'image',
  initiallyVkBound = true,
) {
  const replies: unknown[][] = []
  const row = {
    asset_id: 'asset', asset_key: 'guide', expected_type: expectedType,
    bound: true, telegram_bound: true, vk_bound: initiallyVkBound,
    telegram_file_id: 'tg-file', file_size: '10', mime_type: 'application/octet-stream',
    vk_attachment_type: (initiallyVkBound ? (expectedType === 'video' ? 'video' : 'photo') : null) as string | null,
    vk_owner_id: (initiallyVkBound ? '-1' : null) as string | null,
    vk_media_id: (initiallyVkBound ? '10' : null) as string | null,
    vk_access_key: null,
  }
  const unbind = vi.fn(async (_version: string, _asset: string, _admin: string, platform: 'telegram' | 'vk') => {
    if (platform === 'vk') {
      row.vk_bound = false
      row.vk_attachment_type = null
      row.vk_owner_id = null
      row.vk_media_id = null
    }
  })
  const repository = {
    listMedia: async () => [row],
    recentVkPeers: async () => peers.map((peer) => ({ ...peer, last_seen_at: new Date() })),
    unbindMedia: unbind,
  }
  const upload = vi.fn(async (_input: unknown): Promise<VkMediaAttachment> => ({ type: 'photo', ownerId: -1, mediaId: 10 }))
  const bindExisting = vi.fn(async (_versionId: string, _assetId: string, _value: string, _adminId: string): Promise<VkMediaAttachment> => ({ type: 'video', ownerId: -1, mediaId: 10 }))
  const media = {
    async uploadAndBind(input: unknown) {
      const saved = await upload(input)
      row.vk_bound = true
      row.vk_attachment_type = saved.type
      row.vk_owner_id = String(saved.ownerId)
      row.vk_media_id = String(saved.mediaId)
      return saved
    },
    async bindExisting(versionId: string, assetId: string, value: string, adminId: string) {
      const saved = await bindExisting(versionId, assetId, value, adminId)
      row.vk_bound = true
      row.vk_attachment_type = saved.type
      row.vk_owner_id = String(saved.ownerId)
      row.vk_media_id = String(saved.mediaId)
      return saved
    },
  }
  const config = loadConfig({ TELEGRAM_BOT_TOKEN: 'token', DATABASE_URL: 'postgresql://localhost/test', ADMIN_TELEGRAM_IDS: '1' })
  const controller = new AdminController({} as Bot, repository as unknown as AdminRepository, config, pino({ level: 'silent' }), media as unknown as VkMediaBindingService)
  ;(controller as unknown as { downloadTelegramFile: () => Promise<Buffer> }).downloadTelegramFile = async () => Buffer.from('file')
  const probe = controller as unknown as {
    execute(ctx: Context, adminId: string, action: unknown): Promise<void>
    input: Map<string, unknown>
    actions: Map<string, { action: { type: string; [key: string]: unknown } }>
  }
  const context = (message: Record<string, unknown> = {}) => ({
    from: { id: 1 }, message, reply: vi.fn(async (...args: unknown[]) => { replies.push(args); return {} }),
  }) as unknown as Context
  return {
    controller, row, replies, upload, bindExisting, unbind, context,
    execute: (action: unknown) => probe.execute(context(), '1', action),
    input: () => probe.input.get('1'),
    actions: () => [...probe.actions.values()].map((record) => record.action),
    actionTypes: () => [...probe.actions.values()].map((record) => record.action.type),
  }
}
