import type { Logger } from 'pino'
import type { MediaType } from '../core/shared'
import type { InvoiceSpec, OutgoingButton, RuntimeTransport } from '../domain/types'
import { vkCapabilities } from '../runtime/capabilities'
import type { VkApi } from './api'

export class VkTransport implements RuntimeTransport {
  readonly platform = 'vk' as const
  readonly capabilities = vkCapabilities

  constructor(private readonly api: VkApi, private readonly logger?: Logger) {}

  async sendText(recipientId: string, text: string, buttons?: OutgoingButton[][]) {
    await this.api.sendMessage(recipientId, text, buttons?.length ? JSON.stringify(toVkKeyboard(buttons)) : undefined)
  }

  async sendMedia(_recipientId: string, _type: MediaType, _fileId: string, _caption?: string) {
    throw new Error('UNSUPPORTED_PLATFORM_CAPABILITY:vk:media')
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
  return {
    one_time: false,
    inline: true,
    buttons: rows.map((row) => row.map((button): VkKeyboardButton | null => {
      if (button.url) return { action: { type: 'open_link', link: button.url, label: button.text } }
      if (button.callbackToken) return {
        action: {
          type: 'callback',
          label: button.text,
          payload: JSON.stringify({ callbackToken: button.callbackToken }),
        },
        color: 'primary',
      }
      return null
    }).filter((button): button is VkKeyboardButton => button !== null)).filter((row) => row.length),
  }
}

type VkKeyboardButton =
  | { action: { type: 'open_link'; link: string; label: string } }
  | { action: { type: 'callback'; label: string; payload: string }; color: 'primary' }
