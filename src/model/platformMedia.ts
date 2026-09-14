import type { MediaAsset, MediaType } from './types'

export type VkAttachmentType = 'photo' | 'video' | 'doc' | 'audio_message'

export interface VkAttachmentReference {
  type: VkAttachmentType
  ownerId: number
  mediaId: number
  accessKey?: string
}

export interface VkMediaCapability {
  supported: boolean
  attachmentType: VkAttachmentType | null
  uploadSupported: boolean
}

export interface PlatformReadiness {
  state: 'ready' | 'warning' | 'unsupported'
  label: string
}

const VK_MEDIA_CAPABILITIES: Record<MediaType, VkMediaCapability> = {
  image: { supported: true, attachmentType: 'photo', uploadSupported: true },
  video: { supported: true, attachmentType: 'video', uploadSupported: false },
  audio: { supported: false, attachmentType: null, uploadSupported: false },
  voice: { supported: true, attachmentType: 'audio_message', uploadSupported: true },
  video_note: { supported: false, attachmentType: null, uploadSupported: false },
  document: { supported: true, attachmentType: 'doc', uploadSupported: true },
  animation: { supported: false, attachmentType: null, uploadSupported: false },
}

export function vkMediaCapability(type: MediaType): VkMediaCapability {
  return VK_MEDIA_CAPABILITIES[type]
}

export function vkAttachmentTypeForMedia(type: MediaType): VkAttachmentType | null {
  return vkMediaCapability(type).attachmentType
}

export function parseVkAttachment(value: string): VkAttachmentReference {
  const match = value.trim().match(/^(?:https?:\/\/(?:(?:m\.)?vk\.com|vkvideo\.ru)\/)?(photo|video|doc|audio_message)(-?\d+)_(\d+)(?:_([A-Za-z0-9_-]+))?$/)
  if (!match) throw new Error('VK_ATTACHMENT_INVALID')
  const ownerId = Number(match[2])
  const mediaId = Number(match[3])
  if (!Number.isSafeInteger(ownerId) || !Number.isSafeInteger(mediaId)) throw new Error('VK_ATTACHMENT_INVALID')
  return {
    type: match[1] as VkAttachmentType,
    ownerId,
    mediaId,
    accessKey: match[4] || undefined,
  }
}

export function mediaPlatformReadiness(asset: MediaAsset): { telegram: PlatformReadiness; vk: PlatformReadiness } {
  const telegram: PlatformReadiness = asset.logicalRef.trim()
    ? { state: 'ready', label: 'используется общий источник' }
    : { state: 'warning', label: 'источник будет привязан через /admin' }
  const capability = vkMediaCapability(asset.type)
  if (!capability.supported) return {
    telegram,
    vk: { state: 'unsupported', label: 'этот тип пока не поддерживается' },
  }
  const value = asset.platformRefs?.vk?.trim()
  if (!value) return {
    telegram,
    vk: capability.uploadSupported
      ? { state: 'warning', label: 'нужна привязка через Telegram /admin' }
      : { state: 'warning', label: 'укажите готовый VK attachment' },
  }
  try {
    const attachment = parseVkAttachment(value)
    if (attachment.type !== capability.attachmentType) return {
      telegram,
      vk: { state: 'unsupported', label: `нужен attachment типа ${capability.attachmentType}` },
    }
    return { telegram, vk: { state: 'ready', label: 'отдельный attachment настроен' } }
  } catch {
    return { telegram, vk: { state: 'unsupported', label: 'неверный формат attachment' } }
  }
}
