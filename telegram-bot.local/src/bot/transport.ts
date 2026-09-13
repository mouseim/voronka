import { InlineKeyboard, InputFile, type Bot } from 'grammy'
import type { MediaType } from '../core/shared'
import type { InvoiceSpec, OutgoingButton, RuntimeTransport } from '../domain/types'
import { telegramCapabilities } from '../runtime/capabilities'

interface TelegramTransportOptions {
  administratorIds: Iterable<string>
  applicationsChatId?: string | null
}

export class GrammyTransport implements RuntimeTransport {
  readonly platform = 'telegram' as const
  readonly capabilities = telegramCapabilities
  private readonly notificationChats: string[]

  constructor(private readonly bot: Bot, options: TelegramTransportOptions) {
    this.notificationChats = [...new Set([
      ...options.administratorIds,
      ...(options.applicationsChatId ? [options.applicationsChatId] : []),
    ])]
  }

  async sendText(telegramId: string, text: string, buttons?: OutgoingButton[][]) {
    await this.bot.api.sendMessage(telegramId, text, buttons?.length ? {
      reply_markup: toKeyboard(buttons),
      link_preview_options: { is_disabled: true },
    } : { link_preview_options: { is_disabled: true } })
  }

  async sendMedia(telegramId: string, type: MediaType, fileId: string, caption?: string) {
    const options = caption ? { caption } : {}
    if (type === 'image') await this.bot.api.sendPhoto(telegramId, fileId, options)
    else if (type === 'video') await this.bot.api.sendVideo(telegramId, fileId, options)
    else if (type === 'audio') await this.bot.api.sendAudio(telegramId, fileId, options)
    else if (type === 'voice') await this.bot.api.sendVoice(telegramId, fileId, options)
    else if (type === 'video_note') {
      await this.bot.api.sendVideoNote(telegramId, fileId)
      if (caption) await this.sendText(telegramId, caption)
    } else if (type === 'animation') await this.bot.api.sendAnimation(telegramId, fileId, options)
    else await this.bot.api.sendDocument(telegramId, fileId, options)
  }

  async sendInvoice(telegramId: string, invoice: InvoiceSpec) {
    if (invoice.provider === 'yookassa' && !invoice.providerToken) {
      throw new Error('TELEGRAM_PAYMENT_PROVIDER_TOKEN_REQUIRED')
    }
    await this.bot.api.sendInvoice(
      telegramId,
      invoice.title,
      invoice.description,
      invoice.payload,
      invoice.currency,
      [{ label: invoice.title, amount: invoice.amountMinor }],
      { provider_token: invoice.provider === 'telegram_stars' ? '' : invoice.providerToken },
    )
  }

  async sendDocument(telegramId: string, filename: string, content: Buffer, caption?: string) {
    await this.bot.api.sendDocument(telegramId, new InputFile(content, filename), caption ? { caption } : {})
  }

  async notifyAdministrators(text: string) {
    await Promise.allSettled(this.notificationChats.map((chatId) => this.bot.api.sendMessage(chatId, text, {
      link_preview_options: { is_disabled: true },
    })))
  }
}

function toKeyboard(rows: OutgoingButton[][]) {
  const keyboard = new InlineKeyboard()
  rows.forEach((row, rowIndex) => {
    row.forEach((button) => {
      if (button.url) keyboard.url(button.text, button.url)
      else if (button.callbackToken) keyboard.text(button.text, button.callbackToken)
    })
    if (rowIndex < rows.length - 1) keyboard.row()
  })
  return keyboard
}
