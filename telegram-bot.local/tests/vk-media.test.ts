import { describe, expect, it, vi } from 'vitest'
import type { FunnelDocument, MediaType } from '../src/core/shared'
import type { TelegramMediaBinding, VkMediaAttachment, VkMediaBinding, VkProfile } from '../src/domain/types'
import { FunnelEngine } from '../src/runtime/engine'
import { MemoryRuntimeStore } from '../src/runtime/memory-store'
import type { VkApi, VkLongPollServer, VkPhotoUploadResult, VkSavedDocument } from '../src/vk/api'
import { VkMediaBindingService, parseVkAttachment } from '../src/vk/media-bindings'
import { VkTransport } from '../src/vk/transport'
import { uploadVkMultipart } from '../src/vk/upload'
import { FakeTransport, loadDemo, profile } from './helpers'

describe('VK media bindings', () => {
  it('отправляет binary один раз в указанном multipart field', async () => {
    let body: FormData | undefined
    const fetcher: typeof fetch = async (_input, init) => {
      body = init?.body as FormData
      return new Response(JSON.stringify({ file: 'upload-token' }), { status: 200 })
    }

    const result = await uploadVkMultipart('https://upload.example/path?private=value', 'file', Buffer.from('payload'), 'voice.ogg', 'audio/ogg', { fetcher })

    expect(result).toEqual({ file: 'upload-token' })
    const uploaded = body?.get('file')
    expect(uploaded).toBeInstanceOf(Blob)
    expect(await (uploaded as Blob).text()).toBe('payload')
  })

  it('загружает photo и сохраняет VK identity', async () => {
    const runtime = mediaService()
    runtime.api.photoSaved = [{ owner_id: -10, id: 101, access_key: 'photo-key' }]
    runtime.uploader.mockResolvedValue({ server: 7, photo: '[photo-json]', hash: 'hash' })

    const attachment = await runtime.service.uploadAndBind(uploadInput('image'))

    expect(runtime.api.photoServerPeers).toEqual(['321'])
    expect(runtime.uploader).toHaveBeenCalledWith('https://upload.example/photo', 'photo', expect.any(Buffer), 'asset.bin', 'application/octet-stream')
    expect(runtime.api.photoUploads).toEqual([{ server: 7, photo: '[photo-json]', hash: 'hash' }])
    expect(attachment).toEqual({ type: 'photo', ownerId: -10, mediaId: 101, accessKey: 'photo-key' })
    expect(runtime.repository.bindings[0]?.attachment).toEqual(attachment)

    expect(runtime.uploader).toHaveBeenCalledTimes(1)
  })

  it('доставляет photo из сохранённого binding без повторного upload', async () => {
    const api = new FakeVkMediaApi()
    const attachment: VkMediaAttachment = { type: 'photo', ownerId: -10, mediaId: 101, accessKey: 'photo-key' }

    await new VkTransport(api).sendMedia('321', 'image', vkBinding('image', attachment), 'Фото')

    expect(api.messages).toEqual([{ peerId: '321', message: 'Фото', attachment: 'photo-10_101_photo-key' }])
  })

  it('загружает voice как audio_message через docs flow', async () => {
    const runtime = mediaService()
    runtime.uploader.mockResolvedValue({ file: 'voice-upload-token' })
    runtime.api.documentSaved = { type: 'audio_message', audio_message: { owner_id: -10, id: 202, access_key: 'voice-key' } }

    const attachment = await runtime.service.uploadAndBind(uploadInput('voice'))

    expect(runtime.api.documentServers).toEqual([{ peerId: '321', type: 'audio_message' }])
    expect(runtime.uploader).toHaveBeenCalledWith('https://upload.example/audio_message', 'file', expect.any(Buffer), 'asset.bin', 'application/octet-stream')
    expect(runtime.api.savedFiles).toEqual([{ file: 'voice-upload-token', title: undefined }])
    expect(attachment).toEqual({ type: 'audio_message', ownerId: -10, mediaId: 202, accessKey: 'voice-key' })
  })

  it('загружает document через docs flow и сохраняет binding', async () => {
    const runtime = mediaService()
    runtime.uploader.mockResolvedValue({ file: 'doc-upload-token' })
    runtime.api.documentSaved = { type: 'doc', doc: { owner_id: -10, id: 303 } }

    const attachment = await runtime.service.uploadAndBind(uploadInput('document'))

    expect(runtime.api.documentServers).toEqual([{ peerId: '321', type: 'doc' }])
    expect(runtime.api.savedFiles).toEqual([{ file: 'doc-upload-token', title: 'asset.bin' }])
    expect(runtime.repository.bindings[0]?.attachment).toEqual({ type: 'doc', ownerId: -10, mediaId: 303 })
    expect(attachment.type).toBe('doc')
  })

  it('принимает pre-bound video ID и отправляет корректный attachment', async () => {
    const runtime = mediaService()
    const attachment = await runtime.service.bindExisting('version', 'asset', 'https://vk.com/video-10_404_video-key', '1')
    const api = new FakeVkMediaApi()

    await new VkTransport(api).sendMedia('321', 'video', vkBinding('video', attachment), '')

    expect(parseVkAttachment('video-10_404')).toEqual({ type: 'video', ownerId: -10, mediaId: 404, accessKey: undefined })
    expect(runtime.repository.bindings[0]?.attachment).toEqual(attachment)
    expect(api.messages[0]?.attachment).toBe('video-10_404_video-key')
  })

  it('использует единый parser для access key, voice и неверного VK attachment', () => {
    expect(parseVkAttachment('video-10_404_access-key')).toMatchObject({ type: 'video', accessKey: 'access-key' })
    expect(parseVkAttachment('audio_message-10_202_voice-key')).toMatchObject({ type: 'audio_message', mediaId: 202 })
    expect(() => parseVkAttachment('video-without-owner-and-id')).toThrow('VK_ATTACHMENT_INVALID')
  })

  it('даёт явную ошибку для обязательного asset без VK binding', async () => {
    const document = await mediaDocument('image')
    const store = new MemoryRuntimeStore()
    store.install(document, { allowPlaceholders: false })
    const api = new FakeVkMediaApi()
    const engine = new FunnelEngine(store, new VkTransport(api))

    await expect(engine.start(vkProfile)).rejects.toThrow('REQUIRED_MEDIA_MISSING:asset-media')
    expect(api.messages).toEqual([])
  })

  it('сохраняет прежнюю доставку Telegram media', async () => {
    const document = await mediaDocument('image')
    const store = new MemoryRuntimeStore()
    const version = store.install(document, { allowPlaceholders: false })
    store.bindMedia(version.id, telegramBinding('image'))
    const transport = new FakeTransport()

    await new FunnelEngine(store, transport).start(profile)

    expect(transport.media).toEqual([{ telegramId: profile.externalUserId, type: 'image', fileId: 'telegram-file', caption: 'Подпись' }])
  })

  it('хранит Telegram и VK bindings одной asset одновременно', async () => {
    const store = new MemoryRuntimeStore()
    store.bindMedia('version', telegramBinding('image'))
    store.bindMedia('version', vkBinding('image', { type: 'photo', ownerId: -10, mediaId: 101 }))

    expect(await store.getMediaBinding('version', 'asset-media', 'telegram')).toMatchObject({ platform: 'telegram', telegramFileId: 'telegram-file' })
    expect(await store.getMediaBinding('version', 'asset-media', 'vk')).toMatchObject({ platform: 'vk', attachment: { type: 'photo', mediaId: 101 } })
  })

  it('замена VK binding не перезаписывает Telegram binding', async () => {
    const store = new MemoryRuntimeStore()
    store.bindMedia('version', telegramBinding('image'))
    store.bindMedia('version', vkBinding('image', { type: 'photo', ownerId: -10, mediaId: 101 }))
    store.bindMedia('version', vkBinding('image', { type: 'photo', ownerId: -10, mediaId: 102 }))

    expect(await store.getMediaBinding('version', 'asset-media', 'telegram')).toMatchObject({ telegramFileId: 'telegram-file' })
    expect(await store.getMediaBinding('version', 'asset-media', 'vk')).toMatchObject({ attachment: { mediaId: 102 } })
  })
})

const vkProfile: VkProfile = { platform: 'vk', externalUserId: '321' }

function mediaService() {
  const repository = {
    bindings: [] as Array<{ versionId: string; assetId: string; attachment: VkMediaAttachment; adminId: string }>,
    async bindVkMedia(versionId: string, assetId: string, attachment: VkMediaAttachment, adminId: string) {
      this.bindings.push({ versionId, assetId, attachment, adminId })
    },
  }
  const api = new FakeVkMediaApi()
  const uploader = vi.fn(async (..._args: Parameters<typeof uploadVkMultipart>): ReturnType<typeof uploadVkMultipart> => ({}))
  const service = new VkMediaBindingService(repository, api, uploader)
  return { repository, api, uploader, service }
}

function uploadInput(mediaType: MediaType) {
  return {
    versionId: 'version',
    assetId: 'asset',
    mediaType,
    peerId: '321',
    file: { content: Buffer.from('binary'), filename: 'asset.bin', mimeType: 'application/octet-stream' },
    adminTelegramId: '1',
  }
}

function telegramBinding(type: MediaType): TelegramMediaBinding {
  return { platform: 'telegram', assetId: 'asset-media', assetKey: 'media', expectedType: type, telegramFileId: 'telegram-file' }
}

function vkBinding(type: MediaType, attachment: VkMediaAttachment): VkMediaBinding {
  return { platform: 'vk', assetId: 'asset-media', assetKey: 'media', expectedType: type, attachment }
}

async function mediaDocument(type: MediaType): Promise<FunnelDocument> {
  const document = await loadDemo()
  const start = document.nodes.find((node) => node.type === 'start')!
  document.assets = [{ id: 'asset-media', key: 'media', name: 'Media', type, required: true, logicalRef: 'media' }]
  document.nodes = [
    start,
    { id: 'media', type: 'media', data: { title: 'Media', assetId: 'asset-media', caption: 'Подпись', required: true } },
    { id: 'end', type: 'end', data: { title: 'Конец', text: 'Готово' } },
  ]
  document.edges = [
    { id: 'start-media', source: start.id, target: 'media', sourceHandle: 'next' },
    { id: 'media-end', source: 'media', target: 'end', sourceHandle: 'next' },
  ]
  document.tests = []
  document.products = []
  return document
}

class FakeVkMediaApi implements VkApi {
  readonly messages: Array<{ peerId: string; message: string; attachment?: string }> = []
  readonly photoServerPeers: string[] = []
  readonly photoUploads: VkPhotoUploadResult[] = []
  readonly documentServers: Array<{ peerId: string; type: 'doc' | 'audio_message' }> = []
  readonly savedFiles: Array<{ file: string; title?: string }> = []
  photoSaved: Array<{ owner_id: number; id: number; access_key?: string }> = []
  documentSaved: VkSavedDocument = { type: 'doc' }

  async sendMessage(peerId: string, message: string, _keyboard?: string, attachment?: string) {
    this.messages.push({ peerId, message, attachment })
    return this.messages.length
  }
  async getLongPollServer(): Promise<VkLongPollServer> { return { key: 'key', server: 'https://lp.example', ts: '1' } }
  async answerMessageEvent() {}
  async getMessagesPhotoUploadServer(peerId: string) {
    this.photoServerPeers.push(peerId)
    return { upload_url: 'https://upload.example/photo' }
  }
  async saveMessagesPhoto(upload: VkPhotoUploadResult) {
    this.photoUploads.push(upload)
    return this.photoSaved
  }
  async getMessagesDocumentUploadServer(peerId: string, type: 'doc' | 'audio_message') {
    this.documentServers.push({ peerId, type })
    return { upload_url: `https://upload.example/${type}` }
  }
  async saveDocument(file: string, title?: string) {
    this.savedFiles.push({ file, title })
    return this.documentSaved
  }
}
