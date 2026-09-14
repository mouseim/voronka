import type { Logger } from 'pino'
import type { MediaType } from '../core/shared'
import type { InvoiceSpec, MediaBinding, OutgoingButton, RuntimeTransport } from '../domain/types'
import { vkCapabilities } from '../runtime/capabilities'
import type { VkApi } from './api'
import { formatVkAttachment } from './media-bindings'

export class VkTransport implements RuntimeTransport {
  readonly platform = 'vk' as const
  readonly capabilities = vkCapabilities

  constructor(private readonly api: VkApi, private readonly logger?: Logger) {}

  async sendText(recipientId: string, text: string, buttons?: OutgoingButton[][]) {
    await this.api.sendMessage(recipientId, text, buttons?.length ? JSON.stringify(toVkKeyboard(buttons)) : undefined)
  }

  async sendMedia(recipientId: string, type: MediaType, binding: MediaBinding, caption?: string) {
    if (binding.platform !== 'vk') throw new Error(`MEDIA_BINDING_PLATFORM_MISMATCH:${binding.platform}:vk`)
    if (!this.capabilities.mediaTypes.includes(type)) throw new Error(`UNSUPPORTED_PLATFORM_CAPABILITY:vk:media:${type}`)
    await this.api.sendMessage(recipientId, caption ?? '', undefined, formatVkAttachment(binding))
  }

  async sendInvoice(_recipientId: string, _invoice: InvoiceSpec) {
    throw new Error('UNSUPPORTED_PLATFORM_CAPABILITY:vk:payments')
  }

  async sendDocument(_recipientId: string, _filename: string, _content: Buffer, _caption?: string) {
    throw new Error('UNSUPPORTED_PLATFORM_CAPABILITY:vk:media')
  }

  async notifyAdministrators(text: string) {
    this.logger?.warn({ notification: text }, 'VK runtime пока не доставляет административные уведомления')
  }
}

export function toVkKeyboard(rows: OutgoingButton[][]) {
  const normalized = normalizeVkKeyboardRows(rows)
  return {
    one_time: false,
    inline: true,
    buttons: normalized.map((row) => row.map((button): VkKeyboardButton => {
      if (button.url) return { action: { type: 'open_link', link: button.url, label: button.text } }
      if (button.callbackToken) return {
        action: {
          type: 'callback',
          label: button.text,
          payload: JSON.stringify({ callbackToken: button.callbackToken }),
        },
        color: 'primary',
      }
      throw new Error('VK_KEYBOARD_BUTTON_ACTION_REQUIRED')
    })),
  }
}

export function normalizeVkKeyboardRows(rows: OutgoingButton[][]): OutgoingButton[][] {
  const nonEmptyRows = rows.filter((row) => row.length)
  const buttons = nonEmptyRows.flat()
  if (buttons.length > 30) throw new Error(`VK_KEYBOARD_OVERFLOW:${buttons.length}:MAX_30`)
  if (nonEmptyRows.length <= 6 && nonEmptyRows.every((row) => row.length <= 5)) return nonEmptyRows
  const normalized: OutgoingButton[][] = []
  for (let index = 0; index < buttons.length; index += 5) normalized.push(buttons.slice(index, index + 5))
  return normalized
}

type VkKeyboardButton =
  | { action: { type: 'open_link'; link: string; label: string } }
  | { action: { type: 'callback'; label: string; payload: string }; color: 'primary' }
