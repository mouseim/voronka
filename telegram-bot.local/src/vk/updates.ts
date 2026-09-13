import type { Logger } from 'pino'
import type { VkProfile } from '../domain/types'
import type { FunnelEngine } from '../runtime/engine'
import type { RuntimeStore } from '../runtime/store'
import type { VkApi } from './api'

export interface VkLongPollUpdate {
  type: string
  event_id?: string
  group_id?: number
  object?: {
    message?: {
      id?: number
      conversation_message_id?: number
      date?: number
      from_id?: number
      peer_id?: number
      out?: number
      text?: string
      payload?: unknown
    }
    user_id?: number
    peer_id?: number
    event_id?: string
    payload?: unknown
  }
}

export class VkUpdateAdapter {
  constructor(
    private readonly store: RuntimeStore,
    private readonly engine: FunnelEngine,
    private readonly api: VkApi,
    private readonly logger?: Logger,
  ) {}

  async handle(update: VkLongPollUpdate): Promise<boolean> {
    const updateId = vkUpdateId(update)
    if (!updateId || !await this.store.reserveUpdate('vk', updateId)) return false
    if (update.type === 'message_new') return this.handleMessage(update)
    if (update.type === 'message_event') return this.handleButton(update)
    return false
  }

  private async handleMessage(update: VkLongPollUpdate) {
    const message = update.object?.message
    if (!message || message.out || !isDirectUserDialog(message.from_id, message.peer_id)) return false
    const profile = vkProfile(message.from_id!)
    const callbackToken = readCallbackToken(message.payload)
    if (callbackToken) return this.engine.handleCallback(profile, callbackToken)
    const text = String(message.text ?? '').trim()
    if (text.startsWith('/') && await this.engine.handleOptOutCommand(profile, text)) return true
    const user = await this.store.getUserByPlatformIdentity('vk', profile.externalUserId)
    const active = user ? await this.store.findAnyActiveSession(user.id) : null
    if (!user || !active || isStartText(text)) {
      await this.engine.start(profile)
      return true
    }
    await this.engine.handleText(profile, text)
    return true
  }

  private async handleButton(update: VkLongPollUpdate) {
    const object = update.object
    if (!object || !isDirectUserDialog(object.user_id, object.peer_id)) return false
    const callbackToken = readCallbackToken(object.payload)
    if (!callbackToken) return false
    const handled = await this.engine.handleCallback(vkProfile(object.user_id!), callbackToken)
    const eventId = object.event_id ?? update.event_id
    if (eventId) {
      await this.api.answerMessageEvent(eventId, String(object.user_id), String(object.peer_id)).catch((error) => {
        this.logger?.warn({ err: error, eventId }, 'Не удалось подтвердить VK message_event')
      })
    }
    return handled
  }
}

function vkProfile(userId: number): VkProfile {
  return { platform: 'vk', externalUserId: String(userId) }
}

function isDirectUserDialog(userId?: number, peerId?: number) {
  return Boolean(userId && userId > 0 && peerId === userId)
}

function isStartText(text: string) {
  return /^(начать|start|\/start)$/iu.test(text)
}

function readCallbackToken(payload: unknown): string | null {
  let parsed = payload
  if (typeof payload === 'string') {
    try { parsed = JSON.parse(payload) } catch { return null }
  }
  if (!parsed || typeof parsed !== 'object') return null
  const token = (parsed as { callbackToken?: unknown }).callbackToken
  return typeof token === 'string' && token ? token : null
}

function vkUpdateId(update: VkLongPollUpdate) {
  if (update.type === 'message_event') return update.object?.event_id ?? update.event_id ?? null
  const message = update.object?.message
  if (update.type !== 'message_new' || !message) return null
  return [message.peer_id, message.from_id, message.id, message.conversation_message_id, message.date].join(':')
}
