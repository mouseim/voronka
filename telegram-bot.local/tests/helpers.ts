import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect } from 'vitest'
import { parseAndMigrateFunnelDocument, type FunnelDocument, type MediaType } from '../src/core/shared'
import type { InvoiceSpec, OutgoingButton, RuntimeTransport, TelegramProfile } from '../src/domain/types'
import { telegramCapabilities } from '../src/runtime/capabilities'

export const profile: TelegramProfile = {
  platform: 'telegram',
  externalUserId: '10001',
  username: 'runtime_test',
  firstName: 'Runtime',
  languageCode: 'ru',
}

export async function loadDemo(): Promise<FunnelDocument> {
  const content = await readFile(path.resolve(process.cwd(), '../public/demo-7-mehanizmov-v3.funnel'), 'utf8')
  const parsed = parseAndMigrateFunnelDocument(JSON.parse(content))
  expect(parsed.success).toBe(true)
  if (!parsed.success) throw new Error(parsed.errors.join('; '))
  return parsed.document
}

export class FakeTransport implements RuntimeTransport {
  readonly platform = 'telegram' as const
  readonly capabilities = telegramCapabilities
  readonly texts: Array<{ telegramId: string; text: string; buttons?: OutgoingButton[][] }> = []
  readonly media: Array<{ telegramId: string; type: MediaType; fileId: string; caption?: string }> = []
  readonly invoices: Array<{ telegramId: string; invoice: InvoiceSpec }> = []
  readonly documents: Array<{ telegramId: string; filename: string; content: Buffer; caption?: string }> = []
  readonly notifications: string[] = []

  async sendText(telegramId: string, text: string, buttons?: OutgoingButton[][]) {
    this.texts.push({ telegramId, text, buttons })
  }

  async sendMedia(telegramId: string, type: MediaType, fileId: string, caption?: string) {
    this.media.push({ telegramId, type, fileId, caption })
  }

  async sendInvoice(telegramId: string, invoice: InvoiceSpec) {
    this.invoices.push({ telegramId, invoice })
  }

  async sendDocument(telegramId: string, filename: string, content: Buffer, caption?: string) {
    this.documents.push({ telegramId, filename, content, caption })
  }

  async notifyAdministrators(text: string) {
    this.notifications.push(text)
  }
}
