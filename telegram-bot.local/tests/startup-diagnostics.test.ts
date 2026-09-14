import { describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import { diagnoseActiveTelegramMediaBindings } from '../src/bot/media-diagnostics'
import { diagnoseVkLongPollSettings } from '../src/vk/long-poll'
import type { VkApi } from '../src/vk/api'

describe('startup diagnostics', () => {
  it('проверяет все active Telegram bindings и не пишет file_id в warning', async () => {
    const logger = fakeLogger()
    const api = {
      async getFile(fileId: string) {
        if (fileId === 'old-secret-file-id') throw new Error('Bad Request')
        return { file_id: fileId }
      },
    }
    const repository = {
      async listActiveTelegramMediaBindings() {
        return [
          { funnel_name: 'Рабочая', version: 3, asset_key: 'cover', telegram_file_id: 'valid-file-id' },
          { funnel_name: 'Рабочая', version: 3, asset_key: 'guide', telegram_file_id: 'old-secret-file-id' },
        ]
      },
    }

    await expect(diagnoseActiveTelegramMediaBindings(repository, api, logger.value)).resolves.toEqual({ checked: 2, invalid: 1 })
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('old-secret-file-id')
    expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({ funnel: 'Рабочая', version: 3, assetKey: 'guide' })
  })

  it('предупреждает, если VK message_event выключен', async () => {
    const logger = fakeLogger()
    const api = {
      async getLongPollSettings() {
        return { is_enabled: true, events: { message_new: 1, message_event: 0 } }
      },
    } as Pick<VkApi, 'getLongPollSettings'> as VkApi

    await expect(diagnoseVkLongPollSettings(api, logger.value)).resolves.toEqual({ checked: true, ready: false })
    expect(logger.warn).toHaveBeenCalledWith(
      { enabled: true, messageNew: true, messageEvent: false },
      expect.stringContaining('message_event=1'),
    )
  })

  it('читает фактическое VK поле is_enabled без ложного warning', async () => {
    const logger = fakeLogger()
    const api = {
      async getLongPollSettings() {
        return { is_enabled: true, events: { message_new: 1, message_event: 1 } }
      },
    } as Pick<VkApi, 'getLongPollSettings'> as VkApi

    await expect(diagnoseVkLongPollSettings(api, logger.value)).resolves.toEqual({ checked: true, ready: true })
    expect(logger.warn).not.toHaveBeenCalled()
  })
})

function fakeLogger() {
  const warn = vi.fn()
  const info = vi.fn()
  return { warn, info, value: { warn, info } as unknown as Logger }
}
