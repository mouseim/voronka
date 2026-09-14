import type { Logger } from 'pino'
import type { VkApi, VkLongPollServer } from './api'
import type { VkLongPollUpdate, VkUpdateAdapter } from './updates'

export class VkLongPollRunner {
  private stopped = true
  private active?: Promise<void>
  private controller?: AbortController

  constructor(
    private readonly api: VkApi,
    private readonly adapter: VkUpdateAdapter,
    private readonly logger: Logger,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  start() {
    if (!this.stopped) return
    this.stopped = false
    this.active = this.loop().catch((error) => this.logger.error({ err: error }, 'VK Long Poll аварийно завершился'))
  }

  async stop() {
    this.stopped = true
    this.controller?.abort()
    await this.active
  }

  private async loop() {
    await diagnoseVkLongPollSettings(this.api, this.logger)
    let server = await this.api.getLongPollServer()
    while (!this.stopped) {
      const result = await this.poll(server)
      if ('failed' in result) {
        if (result.failed === 1 && result.ts) server.ts = result.ts
        else server = await this.api.getLongPollServer()
        continue
      }
      server.ts = result.ts
      for (const update of result.updates) {
        if (this.stopped) break
        await this.adapter.handle(update).catch((error) => this.logger.error({ err: error, updateType: update.type }, 'Ошибка VK update'))
      }
    }
  }

  private async poll(server: VkLongPollServer): Promise<{ ts: string; updates: VkLongPollUpdate[] } | { failed: number; ts?: string }> {
    this.controller = new AbortController()
    const url = new URL(server.server)
    url.search = new URLSearchParams({ act: 'a_check', key: server.key, ts: server.ts, wait: '25' }).toString()
    try {
      const response = await this.fetcher(url, { signal: this.controller.signal })
      if (!response.ok) throw new Error(`VK_LONG_POLL_HTTP_ERROR:${response.status}`)
      return await response.json() as { ts: string; updates: VkLongPollUpdate[] } | { failed: number; ts?: string }
    } catch (error) {
      if (this.stopped && error instanceof Error && error.name === 'AbortError') return { failed: 1, ts: server.ts }
      throw error
    } finally {
      this.controller = undefined
    }
  }
}

export async function diagnoseVkLongPollSettings(api: VkApi, logger: Logger) {
  if (!api.getLongPollSettings) return { checked: false, ready: null }
  try {
    const settings = await api.getLongPollSettings()
    const enabled = Boolean(settings.is_enabled ?? settings.enabled)
    const messageNew = Boolean(settings.events?.message_new)
    const messageEvent = Boolean(settings.events?.message_event)
    const ready = enabled && messageNew && messageEvent
    if (!ready) {
      logger.warn({ enabled, messageNew, messageEvent }, 'VK Long Poll настроен не полностью: требуются message_new=1 и message_event=1')
    }
    return { checked: true, ready }
  } catch (error) {
    const code = error instanceof Error ? error.message.split(':').slice(0, 2).join(':') : 'UNKNOWN'
    logger.warn({ code }, 'Не удалось проверить настройки VK Long Poll')
    return { checked: false, ready: null }
  }
}
