import type { Logger } from 'pino'

interface ActiveTelegramMediaBinding {
  funnel_name: string
  version: number
  asset_key: string
  telegram_file_id: string
}

interface TelegramFileApi {
  getFile(fileId: string): Promise<unknown>
}

interface TelegramMediaRepository {
  listActiveTelegramMediaBindings(): Promise<ActiveTelegramMediaBinding[]>
}

export async function diagnoseActiveTelegramMediaBindings(
  repository: TelegramMediaRepository,
  api: TelegramFileApi,
  logger: Logger,
) {
  const bindings = await repository.listActiveTelegramMediaBindings()
  let invalid = 0
  for (const binding of bindings) {
    try {
      await api.getFile(binding.telegram_file_id)
    } catch {
      invalid += 1
      logger.warn({
        funnel: binding.funnel_name,
        version: binding.version,
        assetKey: binding.asset_key,
      }, 'Telegram media binding недействителен для текущего бота; перепривяжите файл через /admin')
    }
  }
  if (bindings.length) logger.info({ checked: bindings.length, invalid }, 'Проверены Telegram media bindings активных воронок')
  return { checked: bindings.length, invalid }
}
