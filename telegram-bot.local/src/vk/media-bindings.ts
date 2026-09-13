import type { MediaType } from '../core/shared'
import type { VkMediaAttachment, VkMediaBinding } from '../domain/types'
import type { AdminRepository } from '../admin/repository'
import type { VkApi, VkPhotoUploadResult, VkSavedAttachmentIdentity } from './api'
import { uploadVkMultipart } from './upload'

interface VkMediaFile {
  content: Buffer
  filename: string
  mimeType?: string
}

export class VkMediaBindingService {
  constructor(
    private readonly repository: Pick<AdminRepository, 'bindVkMedia'>,
    private readonly api: VkApi,
    private readonly uploader: typeof uploadVkMultipart = uploadVkMultipart,
  ) {}

  async uploadAndBind(input: {
    versionId: string
    assetId: string
    mediaType: MediaType
    peerId: string
    file: VkMediaFile
    adminTelegramId: string
  }): Promise<VkMediaAttachment> {
    let attachment: VkMediaAttachment
    if (input.mediaType === 'image') attachment = await this.uploadPhoto(input.peerId, input.file)
    else if (input.mediaType === 'voice') attachment = await this.uploadDocument(input.peerId, input.file, 'audio_message')
    else if (input.mediaType === 'document') attachment = await this.uploadDocument(input.peerId, input.file, 'doc')
    else throw new Error(`VK_MEDIA_UPLOAD_UNSUPPORTED:${input.mediaType}`)
    await this.repository.bindVkMedia(input.versionId, input.assetId, attachment, input.adminTelegramId)
    return attachment
  }

  async bindExisting(versionId: string, assetId: string, value: string, adminTelegramId: string) {
    const attachment = parseVkAttachment(value)
    await this.repository.bindVkMedia(versionId, assetId, attachment, adminTelegramId)
    return attachment
  }

  private async uploadPhoto(peerId: string, file: VkMediaFile): Promise<VkMediaAttachment> {
    const server = await this.api.getMessagesPhotoUploadServer(peerId)
    const raw = await this.uploader(server.upload_url, 'photo', file.content, file.filename, file.mimeType)
    const upload: VkPhotoUploadResult = {
      server: requiredInteger(raw.server, 'server'),
      photo: requiredString(raw.photo, 'photo'),
      hash: requiredString(raw.hash, 'hash'),
    }
    const saved = await this.api.saveMessagesPhoto(upload)
    if (!saved[0]) throw new Error('VK_PHOTO_SAVE_EMPTY')
    return toAttachment('photo', saved[0])
  }

  private async uploadDocument(peerId: string, file: VkMediaFile, type: 'doc' | 'audio_message'): Promise<VkMediaAttachment> {
    const server = await this.api.getMessagesDocumentUploadServer(peerId, type)
    const raw = await this.uploader(server.upload_url, 'file', file.content, file.filename, file.mimeType)
    const saved = await this.api.saveDocument(requiredString(raw.file, 'file'), type === 'doc' ? file.filename : undefined)
    const identity = type === 'doc' ? saved.doc : saved.audio_message
    if (!identity) throw new Error(`VK_DOC_SAVE_MISSING:${type}`)
    return toAttachment(type, identity)
  }
}

export function parseVkAttachment(value: string): VkMediaAttachment {
  const match = value.trim().match(/(?:https?:\/\/(?:m\.)?vk\.com\/)?(photo|video|doc)(-?\d+)_(\d+)(?:_([A-Za-z0-9_-]+))?$/)
  if (!match) throw new Error('VK_ATTACHMENT_INVALID')
  return {
    type: match[1] as VkMediaAttachment['type'],
    ownerId: Number(match[2]),
    mediaId: Number(match[3]),
    accessKey: match[4] || undefined,
  }
}

export function formatVkAttachment(binding: VkMediaBinding | VkMediaAttachment) {
  const attachment = 'attachment' in binding ? binding.attachment : binding
  return `${attachment.type}${attachment.ownerId}_${attachment.mediaId}${attachment.accessKey ? `_${attachment.accessKey}` : ''}`
}

function toAttachment(type: VkMediaAttachment['type'], identity: VkSavedAttachmentIdentity): VkMediaAttachment {
  if (!Number.isSafeInteger(identity.owner_id) || !Number.isSafeInteger(identity.id)) throw new Error('VK_SAVED_ATTACHMENT_INVALID')
  return { type, ownerId: identity.owner_id, mediaId: identity.id, accessKey: identity.access_key }
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== 'string' || !value) throw new Error(`VK_UPLOAD_MISSING_FIELD:${name}`)
  return value
}

function requiredInteger(value: unknown, name: string) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(number)) throw new Error(`VK_UPLOAD_MISSING_FIELD:${name}`)
  return number
}
