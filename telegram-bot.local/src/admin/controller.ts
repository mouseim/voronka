import { randomBytes } from 'node:crypto'
import { Bot, Context, InlineKeyboard, InputFile } from 'grammy'
import type { Logger } from 'pino'
import { parseAndMigrateFunnelDocument, type MediaType } from '../core/shared'
import type { AppConfig } from '../config'
import type { AdminRepository } from './repository'
import { formatVkAttachment, type VkMediaBindingService } from '../vk/media-bindings'
import type { VkApi } from '../vk/api'
import { toVkKeyboard } from '../vk/transport'

type PrintTarget = 'tg' | 'vk' | 'all'
type PrintButton = { text: string; url: string }

type AdminButton = {
  text: string
  action: AdminAction
  style?: 'success' | 'danger' | 'primary'
}
const VERSION_PAGE_SIZE = 5

type AdminAction =
  | { type: 'main' }
  | { type: 'funnels' }
  | { type: 'versions'; funnelId: string; page?: number }
  | { type: 'version'; versionId: string }
  | { type: 'validate'; versionId: string }
  | { type: 'activate_version'; versionId: string }
  | { type: 'emoji_menu'; versionId: string }
  | { type: 'set_emoji'; versionId: string; emoji: string | null }
  | { type: 'delete_version_confirm'; versionId: string }
  | { type: 'delete_version'; versionId: string }
  | { type: 'set_default'; funnelId: string }
  | { type: 'rollback'; funnelId: string; versionId: string }
  | { type: 'media'; versionId: string }
  | { type: 'media_info'; versionId: string; assetId: string }
  | { type: 'media_upload'; versionId: string; assetId: string; expectedType: MediaType }
  | { type: 'media_unbind'; versionId: string; assetId: string }
  | { type: 'media_test'; versionId: string; assetId: string }
  | { type: 'vk_media_upload'; versionId: string; assetId: string; expectedType: MediaType }
  | { type: 'vk_media_peer'; versionId: string; assetId: string; expectedType: MediaType; peerId: string }
  | { type: 'vk_media_unbind'; versionId: string; assetId: string }
  | { type: 'stats'; versionId?: string }
  | { type: 'recent'; kind: 'contacts' | 'applications' | 'payments' }
  | { type: 'csv'; kind: 'contacts' | 'applications' | 'payments'; versionId?: string }
  | { type: 'export'; versionId: string }
  | { type: 'diagnostics' }
  | { type: 'import_prompt' }
  | { type: 'settings' }

type AdminInputState =
  | { type: 'import' }
  | { type: 'media'; versionId: string; assetId: string; expectedType: MediaType }
  | { type: 'vk_media'; versionId: string; assetId: string; expectedType: MediaType; peerId: string }
  | { type: 'vk_video'; versionId: string; assetId: string }
  | { type: 'print'; target: PrintTarget; button?: PrintButton; createdAt: number; expiresAt: number }

interface ActionRecord {
  adminId: string
  action: AdminAction
  expiresAt: number
}

export class AdminController {
  private readonly actions = new Map<string, ActionRecord>()
  private readonly input = new Map<string, AdminInputState>()
  private readonly lastImportAt = new Map<string, number>()

  constructor(
    private readonly bot: Bot,
    private readonly repository: AdminRepository,
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly vkMedia?: VkMediaBindingService,
    private readonly vkApi?: VkApi,
  ) {}

  isAdministrator(ctx: Context) {
    return Boolean(ctx.from && this.config.adminIds.has(String(ctx.from.id)))
  }

  async open(ctx: Context) {
    if (!await this.guard(ctx)) return
    await ctx.reply('Админка Telegram‑воронок', { reply_markup: this.mainKeyboard(String(ctx.from!.id)) })
  }

  async handleCallback(ctx: Context, token: string) {
    if (!await this.guard(ctx)) return
    const adminId = String(ctx.from!.id)
    const record = this.actions.get(token)
    if (!record || record.adminId !== adminId || record.expiresAt <= Date.now()) {
      await ctx.reply('Кнопка устарела. Откройте /admin заново.')
      return
    }
    try {
      await this.execute(ctx, adminId, record.action)
    } catch (error) {
      this.logger.error({ err: error, action: record.action.type, adminId }, 'Ошибка действия админки')
      await ctx.reply(`Не удалось выполнить действие: ${humanError(error)}`)
    }
  }

  async handleCommand(ctx: Context, command: string, args: string) {
    if (!await this.guard(ctx)) return
    const adminId = String(ctx.from!.id)
    try {
      if (command === 'print') {
        const parsed = parsePrintCommand(args)
        if (!parsed || ((parsed.target === 'vk' || parsed.target === 'all') && (!this.vkMedia || !this.vkApi))) {
          await ctx.reply(!parsed ? printUsage() : 'VK runtime не настроен. Рассылка не запущена.')
          return
        }
        const now = Date.now()
        this.input.set(adminId, { type: 'print', ...parsed, createdAt: now, expiresAt: now + 10 * 60_000 })
        await ctx.reply('Ожидаю сообщение для рассылки: текст, фото с подписью или документ с подписью.\n\nДля отмены отправьте /cancel.')
        return
      }
      if (command === 'cancel') {
        const state = this.input.get(adminId)
        if (state?.type === 'print') {
          this.input.delete(adminId)
          await ctx.reply('Рассылка отменена.')
        } else {
          await ctx.reply('Нет ожидающей рассылки.')
        }
        return
      }
      if (command === 'product') {
        const [versionId, productId, productType, provider, currency, amountRaw, assetsRaw] = args.trim().split(/\s+/)
        const amountMinor = Number(amountRaw)
        if (!versionId || !productId || !['digital', 'service', 'physical', 'other'].includes(productType ?? '')
          || !['unconfigured', 'mock', 'telegram_stars', 'yookassa', 'yookassa_api'].includes(provider ?? '')
          || !currency || !Number.isInteger(amountMinor) || amountMinor < 0) {
          await ctx.reply('Формат:\n/product VERSION_ID PRODUCT_ID digital|service|physical|other mock|telegram_stars|yookassa|yookassa_api|unconfigured RUB|XTR AMOUNT_MINOR [assetId1,assetId2]')
          return
        }
        await this.repository.configureProduct(versionId, productId, {
          productType: productType as 'digital' | 'service' | 'physical' | 'other',
          provider: provider as 'unconfigured' | 'mock' | 'telegram_stars' | 'yookassa' | 'yookassa_api',
          currency: currency.toUpperCase(),
          amountMinor,
          deliveryAssetIds: assetsRaw ? assetsRaw.split(',').filter(Boolean) : undefined,
        }, adminId)
        await ctx.reply('Настройки продукта сохранены. Перед публикацией запустите проверку версии.')
        return
      }
      if (command === 'vkmedia') {
        const [versionId, assetId, peerId, attachment] = args.trim().split(/\s+/)
        if (!versionId || !assetId || !peerId || !/^-?\d+$/.test(peerId)) {
          await ctx.reply('Формат: /vkmedia VERSION_ID ASSET_ID PEER_ID [videoOWNER_ID_MEDIA_ID_ACCESS_KEY]')
          return
        }
        if (!this.vkMedia) throw new Error('VK_RUNTIME_DISABLED')
        if (attachment) {
          const saved = await this.vkMedia.bindExisting(versionId, assetId, attachment, adminId)
          await ctx.reply(`VK binding сохранён: ${saved.type}${saved.ownerId}_${saved.mediaId}.`)
          return
        }
        const asset = (await this.repository.listMedia(versionId)).find((item) => item.asset_id === assetId)
        if (!asset) throw new Error('ASSET_NOT_FOUND')
        if (!['image', 'voice', 'document'].includes(asset.expected_type)) throw new Error(`VK_MEDIA_UPLOAD_UNSUPPORTED:${asset.expected_type}`)
        this.input.set(adminId, { type: 'vk_media', versionId, assetId, expectedType: asset.expected_type, peerId })
        await ctx.reply(`Отправьте файл ${asset.expected_type}. Он будет один раз загружен в VK для peer_id ${peerId}.`)
        return
      }
      if (command === 'rollback') {
        const [funnelId, versionId] = args.trim().split(/\s+/)
        if (!funnelId || !versionId) {
          await ctx.reply('Формат: /rollback FUNNEL_ID VERSION_ID')
          return
        }
        await this.repository.rollback(funnelId, versionId, adminId)
        await ctx.reply('Rollback выполнен только для новых запусков. Текущие сессии остались на своих версиях.')
        return
      }
      if (command === 'csv') {
        const [kind, versionId] = args.trim().split(/\s+/)
        if (!['contacts', 'applications', 'payments', 'sources', 'nodes', 'tests'].includes(kind ?? '')) {
          await ctx.reply('Формат: /csv contacts|applications|payments|sources|nodes|tests [VERSION_ID]')
          return
        }
        await this.sendCsv(ctx, kind as Parameters<AdminRepository['exportCsv']>[0], versionId)
      }
    } catch (error) {
      this.logger.error({ err: error, command, adminId }, 'Ошибка административной команды')
      await ctx.reply(`Ошибка: ${humanError(error)}`)
    }
  }

  async handleDocument(ctx: Context) {
    if (!this.isAdministrator(ctx) || !ctx.from || !ctx.message?.document) return false
    const adminId = String(ctx.from.id)
    const state = this.input.get(adminId)
    if (state?.type === 'print') return this.handlePrintMessage(ctx, adminId, state)
    if (!state) return false
    if (state.type === 'media' || state.type === 'vk_media') return this.handleMedia(ctx)
    this.input.delete(adminId)
    const lastImport = this.lastImportAt.get(adminId) ?? 0
    if (Date.now() - lastImport < 5_000) {
      await ctx.reply('Импортировать файлы можно не чаще одного раза в 5 секунд.')
      return true
    }
    this.lastImportAt.set(adminId, Date.now())
    const document = ctx.message.document
    if (document.file_size && document.file_size > this.config.maxFunnelBytes) {
      await ctx.reply(`Файл больше допустимых ${Math.round(this.config.maxFunnelBytes / 1024 / 1024)} МБ.`)
      return true
    }
    try {
      const content = await this.downloadTelegramFile(document.file_id)
      let raw: unknown
      try {
        raw = JSON.parse(content.toString('utf8'))
      } catch {
        throw new Error('Файл не является корректным JSON.')
      }
      const parsed = parseAndMigrateFunnelDocument(raw)
      if (!parsed.success) {
        await ctx.reply(`Импорт отклонён:\n${parsed.errors.map((error) => `• ${error}`).join('\n')}`)
        return true
      }
      const imported = await this.repository.importDocument(parsed.document, adminId)
      await ctx.reply(imported.created
        ? `Импортирован draft: ${parsed.document.funnel.name}, версия ${parsed.document.funnel.version}.\nID версии: ${imported.versionId}`
        : `Такая версия уже существует и совпадает по SHA‑256.\nID версии: ${imported.versionId}`,
      { reply_markup: this.versionKeyboard(adminId, imported.versionId, imported.funnelId, false, false, 'draft') })
    } catch (error) {
      this.logger.error({ err: error, adminId }, 'Ошибка импорта .funnel')
      await ctx.reply(`Импорт не выполнен: ${humanError(error)}`)
    }
    return true
  }

  async handleText(ctx: Context) {
    if (!this.isAdministrator(ctx) || !ctx.from || !ctx.message?.text) return false
    const adminId = String(ctx.from.id)
    const state = this.input.get(adminId)
    if (state?.type === 'print') return this.handlePrintMessage(ctx, adminId, state)
    if (state?.type !== 'vk_video') return false
    try {
      if (!this.vkMedia) throw new Error('VK_RUNTIME_DISABLED')
      const saved = await this.vkMedia.bindExisting(state.versionId, state.assetId, ctx.message.text.trim(), adminId)
      if (saved.type !== 'video') throw new Error('VK_VIDEO_ATTACHMENT_REQUIRED')
      this.input.delete(adminId)
      await ctx.reply(`VK-видео привязано: video${saved.ownerId}_${saved.mediaId}.`)
      await this.showMediaInfo(ctx, adminId, state.versionId, state.assetId)
    } catch (error) {
      await ctx.reply(`Не удалось привязать VK-видео: ${humanError(error)} Отправьте attachment вида video-123_456_accessKey или ссылку на VK Video.`)
    }
    return true
  }

  async handleMedia(ctx: Context) {
    if (!this.isAdministrator(ctx) || !ctx.from || !ctx.message) return false
    const adminId = String(ctx.from.id)
    const state = this.input.get(adminId)
    if (state?.type === 'print') return this.handlePrintMessage(ctx, adminId, state)
    if (!state || (state.type !== 'media' && state.type !== 'vk_media')) return false
    const media = extractMedia(ctx)
    if (!media) {
      await ctx.reply(`Ожидается Telegram‑сообщение типа ${state.expectedType}.`)
      return true
    }
    if (media.type !== state.expectedType) {
      await ctx.reply(`Неверный тип: получен ${media.type}, ожидается ${state.expectedType}. Отправьте правильный файл.`)
      return true
    }
    try {
      let confirmation: string
      if (state.type === 'vk_media') {
        if (!this.vkMedia) throw new Error('VK_RUNTIME_DISABLED')
        const content = await this.downloadTelegramFile(media.fileId, this.config.maxMediaBytes)
        const saved = await this.vkMedia.uploadAndBind({
          versionId: state.versionId,
          assetId: state.assetId,
          mediaType: state.expectedType,
          peerId: state.peerId,
          file: { content, filename: media.filename, mimeType: media.mimeType },
          adminTelegramId: adminId,
        })
        confirmation = `Файл загружен в VK и привязан: ${saved.type}${saved.ownerId}_${saved.mediaId}.`
      } else {
        await this.repository.bindMedia(state.versionId, state.assetId, media, adminId)
        confirmation = 'Telegram-файл привязан и проверен.'
      }
      this.input.delete(adminId)
      await ctx.reply(confirmation)
      await this.showMediaInfo(ctx, adminId, state.versionId, state.assetId)
    } catch (error) {
      await ctx.reply(`Не удалось привязать файл: ${humanError(error)}`)
    }
    return true
  }

  private async execute(ctx: Context, adminId: string, action: AdminAction): Promise<void> {
    if (action.type === 'main') return this.open(ctx)
    if (action.type === 'funnels') {
      const rows = await this.repository.listFunnels()
      const text = rows.length ? rows.map((row) => [
        `${row.default_for_bot ? '⭐️' : '▫️'} ${row.name}`,
        `активная версия: ${row.active_version ?? 'нет'}, версий: ${row.versions}, активных сессий: ${row.active_sessions}`,
      ].join('\n')).join('\n\n') : 'Воронок пока нет. Импортируйте `.funnel`.'
      await ctx.reply(text, { reply_markup: this.keyboard(adminId, [
        ...rows.map((row) => [{ text: `Версии: ${row.name}`, action: { type: 'versions' as const, funnelId: row.id } }]),
        [{ text: 'Импортировать .funnel', action: { type: 'import_prompt' as const } }],
        [{ text: '← Главное меню', action: { type: 'main' as const } }],
      ]) })
      return
    }
    if (action.type === 'versions') {
      const rows = await this.repository.listVersions(action.funnelId)
      const pageCount = Math.max(1, Math.ceil(rows.length / VERSION_PAGE_SIZE))
      const page = Math.min(pageCount - 1, Math.max(0, Math.trunc(action.page ?? 0)))
      const visibleRows = rows.slice(page * VERSION_PAGE_SIZE, (page + 1) * VERSION_PAGE_SIZE)
      const keyboardRows: Array<Array<{ text: string; action: AdminAction }>> = visibleRows.map((row) => [{
        text: `${row.emoji ? `${row.emoji} ` : ''}v${row.version} — ${row.active ? '🟢' : '🔴'}`,
        action: { type: 'version', versionId: row.id },
      }])
      if (pageCount > 1) {
        const navigation: Array<{ text: string; action: AdminAction }> = []
        if (page > 0) navigation.push({ text: '←', action: { type: 'versions', funnelId: action.funnelId, page: page - 1 } })
        if (page < pageCount - 1) navigation.push({ text: '→', action: { type: 'versions', funnelId: action.funnelId, page: page + 1 } })
        keyboardRows.push(navigation)
      }
      keyboardRows.push([{ text: '← К воронкам', action: { type: 'funnels' } }])
      await ctx.reply(rows.length ? [`Версии · страница ${page + 1}/${pageCount}`, '', ...visibleRows.map((row) =>
        `${row.emoji ? `${row.emoji} ` : ''}v${row.version} · ${row.active ? '🟢 Активно' : '🔴 Неактивно'} · сессий ${row.active_sessions} · файлов не хватает ${row.missing_media}`,
      )].join('\n') : 'Версий нет.', { reply_markup: this.keyboard(adminId, keyboardRows) })
      return
    }
    if (action.type === 'version') {
      const details = await this.repository.versionDetails(action.versionId)
      if (!details) throw new Error('VERSION_NOT_FOUND')
      await ctx.reply([
        `${details.emoji ? `${details.emoji} ` : ''}${details.funnel_name} · v${details.version}`,
        details.active ? '🟢 Активно' : '🔴 Неактивно',
        `Формат: ${details.schema_version}`,
        `Состояние: ${details.status}${details.default_for_bot ? ' · default' : ''}`,
        `ID: ${details.id}`,
      ].join('\n'), {
        reply_markup: this.versionKeyboard(adminId, details.id, details.funnel_id, details.active, details.default_for_bot, details.status),
      })
      return
    }
    if (action.type === 'validate') {
      const issues = await this.repository.publicationIssues(action.versionId)
      await ctx.reply(formatIssues(issues), { reply_markup: this.keyboard(adminId, [
        [{ text: '← К версии', action: { type: 'version', versionId: action.versionId } }],
      ]) })
      return
    }
    if (action.type === 'activate_version') {
      const details = await this.repository.versionDetails(action.versionId)
      if (!details) throw new Error('VERSION_NOT_FOUND')

      if (details.active) {
        await ctx.reply('Эта версия уже активна.')
        return
      }

      if (details.status === 'draft') {
        await ctx.reply('Черновики публикуются только через сайт-конструктор.')
        return
      }

      const result = await this.repository.publish(action.versionId, adminId, true)

      await ctx.reply(
        result.published
          ? '🟢 Версия сделана активной. Новые пользователи будут запускаться на ней.'
          : `Не удалось сделать версию активной:\n${formatIssues(result.issues)}`,
      )

      return this.execute(ctx, adminId, {
        type: 'version',
        versionId: action.versionId,
      })
    }

    if (action.type === 'emoji_menu') {
      const emojis = ['⭐️', '🏆', '🧪', '🚀', '✅', '⚠️', '🔥', '💎']
      await ctx.reply('Выберите эмоджи версии:', {
        reply_markup: this.keyboard(adminId, [
          emojis.slice(0, 4).map((emoji) => ({
            text: emoji,
            action: { type: 'set_emoji' as const, versionId: action.versionId, emoji },
          })),
          emojis.slice(4).map((emoji) => ({
            text: emoji,
            action: { type: 'set_emoji' as const, versionId: action.versionId, emoji },
          })),
          [{
            text: 'Без эмоджи',
            action: { type: 'set_emoji' as const, versionId: action.versionId, emoji: null },
          }],
          [{ text: '← К версии', action: { type: 'version' as const, versionId: action.versionId } }],
        ]),
      })
      return
    }

    if (action.type === 'set_emoji') {
      await this.repository.setVersionEmoji(action.versionId, action.emoji, adminId)
      await ctx.reply(action.emoji ? `Эмоджи версии: ${action.emoji}` : 'Эмоджи версии удалён.')
      return this.execute(ctx, adminId, { type: 'version', versionId: action.versionId })
    }

    if (action.type === 'delete_version_confirm') {
      const details = await this.repository.versionDetails(action.versionId)
      if (!details) throw new Error('VERSION_NOT_FOUND')

      if (details.active) {
        await ctx.reply('Активную версию удалить нельзя. Сначала сделайте активной другую версию.')
        return
      }

      await ctx.reply(
        `Удалить v${details.version} из истории? Версия исчезнет из админки и статистики, но старые данные и сессии останутся безопасно сохранены.`,
        {
          reply_markup: this.keyboard(adminId, [
            [{
              text: '🗑 Да, удалить версию',
              action: { type: 'delete_version', versionId: action.versionId },
              style: 'danger',
            }],
            [{ text: 'Отмена', action: { type: 'version', versionId: action.versionId } }],
          ]),
        },
      )
      return
    }

    if (action.type === 'delete_version') {
      const result = await this.repository.hideVersion(action.versionId, adminId)
      await ctx.reply('Версия удалена из истории.', {
        reply_markup: this.keyboard(adminId, [
          [{ text: '← К версиям', action: { type: 'versions', funnelId: result.funnelId } }],
        ]),
      })
      return
    }
    if (action.type === 'set_default') {
      await this.repository.setDefault(action.funnelId, adminId)
      await ctx.reply('Эта воронка выбрана default для обычного /start.')
      return
    }
    if (action.type === 'rollback') {
      await this.repository.rollback(action.funnelId, action.versionId, adminId)
      await ctx.reply('Rollback выполнен для новых стартов. Уже начатые сессии не мигрировали.')
      return
    }
    if (action.type === 'media') {
      const rows = await this.repository.listMedia(action.versionId)
      await ctx.reply(rows.length ? rows.map((row) => `TG ${row.telegram_bound ? '✅' : '❓'} · VK ${row.vk_bound ? '✅' : '❓'} · ${row.asset_key} · ${row.expected_type}`).join('\n') : 'В версии нет медиа‑ресурсов.', {
        reply_markup: this.keyboard(adminId, [
          ...rows.map((row) => [{
            text: `${row.bound ? '✅' : '❓'} ${row.asset_key}`,
            action: { type: 'media_info' as const, versionId: action.versionId, assetId: row.asset_id },
          }]),
          [{ text: '← К версии', action: { type: 'version' as const, versionId: action.versionId } }],
        ]),
      })
      return
    }
    if (action.type === 'media_info') {
      return this.showMediaInfo(ctx, adminId, action.versionId, action.assetId)
    }
    if (action.type === 'media_upload') {
      this.input.set(adminId, {
        type: 'media',
        versionId: action.versionId,
        assetId: action.assetId,
        expectedType: action.expectedType,
      })
      await ctx.reply(`Отправьте одним сообщением файл типа ${action.expectedType}. Для document тип файла берётся из Telegram, расширение может быть любым.`)
      return
    }
    if (action.type === 'media_unbind') {
      await this.repository.unbindMedia(action.versionId, action.assetId, adminId)
      await ctx.reply('Привязка удалена. Сам Telegram‑файл и пользовательские данные не удалены.')
      return
    }
    if (action.type === 'media_test') {
      const row = (await this.repository.listMedia(action.versionId)).find((item) => item.asset_id === action.assetId)
      if (!row?.telegram_file_id) throw new Error('MEDIA_NOT_BOUND')
      try {
        await sendMedia(this.bot, adminId, row.expected_type, row.telegram_file_id, `Тест: ${row.asset_key}`)
      } catch {
        await ctx.reply('Telegram не принимает эту привязку для текущего бота. Нажмите «Заменить» и загрузите исходный файл заново; VK-привязка останется без изменений.')
      }
      return
    }
    if (action.type === 'vk_media_upload') {
      if (!this.vkMedia) throw new Error('VK_RUNTIME_DISABLED')
      if (action.expectedType === 'video') {
        this.input.set(adminId, { type: 'vk_video', versionId: action.versionId, assetId: action.assetId })
        await ctx.reply('Отправьте attachment VK-видео вида video-123_456_accessKey или ссылку на VK Video. UUID и peer ID вводить не нужно.')
        return
      }
      if (!['image', 'voice', 'document'].includes(action.expectedType)) throw new Error(`VK_MEDIA_UPLOAD_UNSUPPORTED:${action.expectedType}`)
      const peers = await this.repository.recentVkPeers()
      if (!peers.length) {
        await ctx.reply('Сначала напишите VK-боту «Начать», затем вернитесь к этому файлу и повторите загрузку в VK.')
        return
      }
      if (peers.length === 1) return this.prepareVkUpload(ctx, adminId, action, peers[0]!.peer_id)
      await ctx.reply('Выберите недавнего пользователя VK, для диалога с которым загрузить файл:', {
        reply_markup: this.keyboard(adminId, [
          ...peers.map((peer) => [{
            text: vkPeerLabel(peer),
            action: { type: 'vk_media_peer' as const, versionId: action.versionId, assetId: action.assetId, expectedType: action.expectedType, peerId: peer.peer_id },
          }]),
          [{ text: '← К файлу', action: { type: 'media_info' as const, versionId: action.versionId, assetId: action.assetId } }],
        ]),
      })
      return
    }
    if (action.type === 'vk_media_peer') return this.prepareVkUpload(ctx, adminId, action, action.peerId)
    if (action.type === 'vk_media_unbind') {
      await this.repository.unbindMedia(action.versionId, action.assetId, adminId, 'vk')
      await ctx.reply('VK-привязка удалена. Telegram-файл не изменён.')
      await this.showMediaInfo(ctx, adminId, action.versionId, action.assetId)
      return
    }
    if (action.type === 'stats') {
      if (action.versionId) {
        const stats = await this.repository.versionStats(action.versionId)
        await ctx.reply(`Статистика версии\nПользователи: ${stats.users}\nАктивные: ${stats.active}\nЗавершили: ${stats.completed}\nЗаявки: ${stats.applications}\nОплаты: ${stats.paid}`)
      } else {
        const stats = await this.repository.overallStats()
        const revenue = Object.entries(stats.revenue_by_currency)
          .map(([currency, amount]) => `${currency}: ${amount} minor units`)
          .join(', ') || 'нет'
        await ctx.reply(`Общая статистика\nПользователи: ${stats.users}\nСессии: ${stats.sessions}\nАктивные: ${stats.active}\nЗаявки: ${stats.applications}\nОплаты: ${stats.paid}\nВыручка: ${revenue}`)
      }
      return
    }
    if (action.type === 'recent') {
      if (action.kind === 'contacts') {
        const rows = await this.repository.recentContacts()
        await ctx.reply(rows.length ? rows.map((row) => `${row.created_at.toISOString()} · ${row.telegram_id} · ${row.funnel_name} v${row.version}\n${formatRecord(row.fields)}`).join('\n\n') : 'Контактов пока нет.', {
          reply_markup: this.keyboard(adminId, [[{ text: 'CSV контактов', action: { type: 'csv', kind: 'contacts' } }]]),
        })
      } else if (action.kind === 'applications') {
        const rows = await this.repository.recentApplications()
        await ctx.reply(rows.length ? rows.map((row) => `${row.created_at.toISOString()} · ${row.telegram_id} · ${row.status}\n${formatRecord(row.payload)}`).join('\n\n') : 'Заявок пока нет.', {
          reply_markup: this.keyboard(adminId, [[{ text: 'CSV заявок', action: { type: 'csv', kind: 'applications' } }]]),
        })
      } else {
        const rows = await this.repository.recentPayments()
        await ctx.reply(rows.length ? rows.map((row) => `${row.created_at.toISOString()} · ${row.telegram_id} · ${row.product_id}\n${row.status} · ${row.provider} · ${row.amount_minor} ${row.currency}`).join('\n\n') : 'Платежей пока нет.', {
          reply_markup: this.keyboard(adminId, [[{ text: 'CSV платежей', action: { type: 'csv', kind: 'payments' } }]]),
        })
      }
      return
    }
    if (action.type === 'csv') return this.sendCsv(ctx, action.kind, action.versionId)
    if (action.type === 'export') {
      const document = await this.repository.exportFunnel(action.versionId)
      await ctx.replyWithDocument(new InputFile(Buffer.from(`${JSON.stringify(document, null, 2)}\n`), `${document.funnel.key}-v${document.funnel.version}.funnel`), {
        caption: 'Экспорт содержит снимок аналитики и может содержать персональные данные. Храните его безопасно.',
      })
      return
    }
    if (action.type === 'diagnostics') {
      const diagnostics = await this.repository.diagnostics()
      await ctx.reply(`Диагностика\nВерсий: ${diagnostics.versions}\nАктивных сессий: ${diagnostics.activeSessions}\nОжидающих задач: ${diagnostics.pendingJobs}\nОшибочных задач: ${diagnostics.failedJobs}`)
      return
    }
    if (action.type === 'import_prompt') {
      this.input.set(adminId, { type: 'import' })
      await ctx.reply(`Отправьте `.concat('`').concat('.funnel` как документ. Максимальный размер: ', String(Math.round(this.config.maxFunnelBytes / 1024 / 1024)), ' МБ. Импорт создаст неизменяемый draft и ничего не опубликует.'))
      return
    }
    if (action.type === 'settings') {
      await ctx.reply([
        'Настройка продукта выполняется командой:',
        '/product VERSION_ID PRODUCT_ID TYPE PROVIDER CURRENCY AMOUNT_MINOR [ASSET_IDS]',
        '',
        'Пример mock:',
        '/product <version> <product> digital mock RUB 99000 <asset>',
        '',
        'Telegram и VK-файлы настраиваются через Воронки → версия → Файлы.',
        'Команда /vkmedia сохранена только для диагностики и обратной совместимости.',
        '',
        'Stars: provider=telegram_stars, currency=XTR.',
        'ЮKassa: provider=yookassa и TELEGRAM_PAYMENT_PROVIDER_TOKEN; digital через ЮKassa запрещён.',
        '',
        'Rollback: /rollback FUNNEL_ID VERSION_ID',
        'CSV: /csv contacts|applications|payments|sources|nodes|tests [VERSION_ID]',
      ].join('\n'))
    }
  }

  private async showMediaInfo(ctx: Context, adminId: string, versionId: string, assetId: string) {
    const row = (await this.repository.listMedia(versionId)).find((item) => item.asset_id === assetId)
    if (!row) throw new Error('ASSET_NOT_FOUND')
    const rows: Array<Array<{ text: string; action: AdminAction }>> = [[{
      text: row.telegram_bound ? 'Заменить TG' : 'Загрузить TG',
      action: { type: 'media_upload', versionId, assetId, expectedType: row.expected_type },
    }]]
    if (row.telegram_bound) rows[0]!.push(
      { text: 'Тест TG', action: { type: 'media_test', versionId, assetId } },
      { text: 'Удалить TG', action: { type: 'media_unbind', versionId, assetId } },
    )
    if (['image', 'voice', 'document', 'video'].includes(row.expected_type)) {
      rows.push([{
        text: row.expected_type === 'video'
          ? (row.vk_bound ? 'Заменить VK-видео' : 'Привязать VK-видео')
          : (row.vk_bound ? 'Заменить в VK' : 'Загрузить в VK'),
        action: { type: 'vk_media_upload', versionId, assetId, expectedType: row.expected_type },
      }])
      if (row.vk_bound) rows.at(-1)!.push({ text: 'Удалить VK', action: { type: 'vk_media_unbind', versionId, assetId } })
    }
    rows.push([{ text: '← К файлам', action: { type: 'media', versionId } }])
    await ctx.reply([
      `Asset: ${row.asset_key}`,
      `Ожидаемый тип: ${row.expected_type}`,
      '',
      `Telegram: ${row.telegram_bound ? '✅ привязан' : '❓ не загружен'}`,
      `VK: ${row.vk_bound ? `✅ ${row.vk_attachment_type}${row.vk_owner_id}_${row.vk_media_id}` : '❓ не привязан'}`,
      !['image', 'voice', 'document', 'video'].includes(row.expected_type) ? 'Этот тип файла пока не поддерживается VK.' : '',
      row.file_size ? `Размер TG: ${row.file_size} байт` : '',
      row.mime_type ? `MIME TG: ${row.mime_type}` : '',
    ].filter((line) => line !== '').join('\n'), { reply_markup: this.keyboard(adminId, rows) })
  }

  private async prepareVkUpload(
    ctx: Context,
    adminId: string,
    action: Extract<AdminAction, { type: 'vk_media_upload' | 'vk_media_peer' }>,
    peerId: string,
  ) {
    this.input.set(adminId, {
      type: 'vk_media', versionId: action.versionId, assetId: action.assetId,
      expectedType: action.expectedType, peerId,
    })
    await ctx.reply(`Отправьте одним сообщением файл типа ${action.expectedType}. Он будет загружен в VK и привязан к выбранному asset.`)
  }

  private async handlePrintMessage(
    ctx: Context,
    adminId: string,
    state: Extract<AdminInputState, { type: 'print' }>,
  ) {
    if (state.expiresAt <= Date.now()) {
      this.input.delete(adminId)
      await ctx.reply('Ожидание рассылки истекло. Запустите /print снова.')
      return true
    }
    const message = ctx.message
    const media = extractMedia(ctx)
    const supported = Boolean(message?.text || ((media?.type === 'image' || media?.type === 'document') && message?.caption))
    if (!message || !supported) {
      await ctx.reply('Поддерживаются только текст, фото с подписью или документ с подписью. Для отмены отправьте /cancel.')
      return true
    }

    this.input.delete(adminId)
    try {
      const result = await this.sendPrint(ctx, state)
      const lines = ['Рассылка завершена.', '']
      if (state.target === 'tg' || state.target === 'all') lines.push(`TG: ${result.tgSuccess}/${result.tgTotal}`)
      if (state.target === 'vk' || state.target === 'all') lines.push(`VK: ${result.vkSuccess}/${result.vkTotal}`)
      lines.push(`Ошибок: ${result.failed}`)
      await ctx.reply(lines.join('\n'))
    } catch (error) {
      this.logger.error({ err: error, adminId }, 'Не удалось выполнить рассылку')
      await ctx.reply(`Рассылка не выполнена: ${humanError(error)}`)
    }
    return true
  }

  private async sendPrint(ctx: Context, state: Extract<AdminInputState, { type: 'print' }>) {
    const message = ctx.message!
    const recipients = await this.repository.listBroadcastRecipients(state.target)
    const telegram = recipients.filter((recipient) => recipient.platform === 'telegram')
    const vk = recipients.filter((recipient) => recipient.platform === 'vk')
    let tgSuccess = 0
    let vkSuccess = 0
    let failed = 0
    const replyMarkup = state.button ? new InlineKeyboard().url(state.button.text, state.button.url) : undefined

    for (const recipient of telegram) {
      try {
        await this.bot.api.copyMessage(recipient.external_user_id, ctx.chat!.id, message.message_id, replyMarkup ? { reply_markup: replyMarkup } : {})
        tgSuccess++
      } catch (error) {
        failed++
        this.logger.warn({ err: error, platform: 'telegram' }, 'Не удалось доставить сообщение рассылки')
      }
    }

    if (vk.length) {
      if (!this.vkApi || !this.vkMedia) throw new Error('VK_RUNTIME_DISABLED')
      const media = extractMedia(ctx)
      let attachment: string | undefined
      if (media?.type === 'image' || media?.type === 'document') {
        try {
          const content = await this.downloadTelegramFile(media.fileId, this.config.maxMediaBytes)
          const uploaded = await this.vkMedia.uploadForBroadcast(vk[0]!.external_user_id, media.type, {
            content,
            filename: media.filename,
            mimeType: media.mimeType,
          })
          attachment = formatVkAttachment(uploaded)
        } catch (error) {
          failed += vk.length
          this.logger.warn({ err: error, platform: 'vk' }, 'Не удалось загрузить файл рассылки в VK')
          return { tgSuccess, tgTotal: telegram.length, vkSuccess, vkTotal: vk.length, failed }
        }
      }
      const exactText = message.text ?? message.caption ?? ''
      const keyboard = state.button
        ? JSON.stringify(toVkKeyboard([[{ text: state.button.text, url: state.button.url }]]))
        : undefined
      for (const recipient of vk) {
        try {
          await this.vkApi.sendMessage(recipient.external_user_id, exactText, keyboard, attachment)
          vkSuccess++
        } catch (error) {
          failed++
          this.logger.warn({ err: error, platform: 'vk' }, 'Не удалось доставить сообщение рассылки')
        }
      }
    }

    return { tgSuccess, tgTotal: telegram.length, vkSuccess, vkTotal: vk.length, failed }
  }

  private versionKeyboard(
    adminId: string,
    versionId: string,
    funnelId: string,
    active: boolean,
    isDefault: boolean,
    status: string,
  ) {
    const rows: AdminButton[][] = [
      [
        { text: 'Проверить', action: { type: 'validate', versionId } },
        { text: 'Файлы', action: { type: 'media', versionId } },
      ],
      [
        { text: 'Статистика', action: { type: 'stats', versionId } },
        { text: 'Экспорт .funnel', action: { type: 'export', versionId } },
      ],
      [{ text: '😀 Изменить эмоджи', action: { type: 'emoji_menu', versionId } }],
    ]

    // Публикация новых версий выполняется только в веб-конструкторе.
    // Telegram здесь только управляет уже опубликованными версиями.
    if (!active && status !== 'draft') {
      rows.push([{
        text: '🟢 Сделать активной',
        action: { type: 'activate_version', versionId },
        style: 'success',
      }])
    }

    if (!active) {
      rows.push([{
        text: '🗑 Удалить версию',
        action: { type: 'delete_version_confirm', versionId },
        style: 'danger',
      }])
    }

    if (!isDefault && active) {
      rows.push([{ text: 'Сделать default', action: { type: 'set_default', funnelId } }])
    }

    rows.push([{ text: '← К версиям', action: { type: 'versions', funnelId } }])
    return this.keyboard(adminId, rows)
  }

  private mainKeyboard(adminId: string) {
    return this.keyboard(adminId, [
      [{ text: 'Воронки', action: { type: 'funnels' } }, { text: 'Импорт', action: { type: 'import_prompt' } }],
      [{ text: 'Статистика', action: { type: 'stats' } }, { text: 'Диагностика', action: { type: 'diagnostics' } }],
      [{ text: 'Контакты', action: { type: 'recent', kind: 'contacts' } }, { text: 'Заявки', action: { type: 'recent', kind: 'applications' } }],
      [{ text: 'Платежи', action: { type: 'recent', kind: 'payments' } }, { text: 'Настройки', action: { type: 'settings' } }],
    ])
  }

  private keyboard(adminId: string, rows: AdminButton[][]) {
    const keyboard = new InlineKeyboard()

    rows.forEach((row, rowIndex) => {
      row.forEach((item) => {
        const text = item.style
          ? { text: item.text, style: item.style }
          : item.text

        keyboard.text(text, `adm_${this.register(adminId, item.action)}`)
      })

      if (rowIndex < rows.length - 1) keyboard.row()
    })

    return keyboard
  }

  private register(adminId: string, action: AdminAction) {
    const token = randomBytes(9).toString('base64url')
    this.actions.set(token, { adminId, action, expiresAt: Date.now() + 24 * 3_600_000 })
    if (this.actions.size > 5_000) {
      const now = Date.now()
      this.actions.forEach((record, key) => {
        if (record.expiresAt <= now) this.actions.delete(key)
      })
    }
    return token
  }

  private async sendCsv(ctx: Context, kind: Parameters<AdminRepository['exportCsv']>[0], versionId?: string) {
    const csv = await this.repository.exportCsv(kind, versionId)
    await ctx.replyWithDocument(new InputFile(Buffer.from(csv), `${kind}${versionId ? `-${versionId}` : ''}.csv`), {
      caption: 'CSV содержит персональные данные. Не пересылайте его в публичные чаты.',
    })
  }

  private async guard(ctx: Context) {
    if (this.isAdministrator(ctx)) return true
    await ctx.reply('Доступ к админке запрещён.')
    return false
  }

  private async downloadTelegramFile(fileId: string, maxBytes = this.config.maxFunnelBytes) {
    const file = await this.bot.api.getFile(fileId)
    if (!file.file_path) throw new Error('Telegram не вернул путь к файлу.')
    const response = await fetch(`https://api.telegram.org/file/bot${this.config.telegramToken}/${file.file_path}`)
    if (!response.ok) throw new Error(`Telegram file API: HTTP ${response.status}`)
    const announced = Number(response.headers.get('content-length') ?? 0)
    if (announced > maxBytes) throw new Error(`Файл превышает допустимые ${maxBytes} байт.`)
    const content = Buffer.from(await response.arrayBuffer())
    if (content.length > maxBytes) throw new Error(`Файл превышает допустимые ${maxBytes} байт.`)
    return content
  }
}

export function parsePrintCommand(args: string): { target: PrintTarget; button?: PrintButton } | null {
  const match = /^\s*(tg|vk|all)(?:\s+\[([^|\]\r\n]+)\|([^\]\r\n]+)\])?\s*$/.exec(args)
  if (!match) return null
  const target = match[1] as PrintTarget
  if (!match[2] || !match[3]) return { target }
  const text = match[2].trim()
  const rawUrl = match[3].trim()
  if (!text || !rawUrl) return null
  const normalizedUrl = /^[a-z][a-z\d+.-]*:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
  try {
    const url = new URL(normalizedUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return { target, button: { text, url: url.toString() } }
  } catch {
    return null
  }
}

function printUsage() {
  return 'Формат: /print tg|vk|all [Текст кнопки|https://example.com]'
}

function extractMedia(ctx: Context): {
  type: MediaType
  fileId: string
  fileUniqueId?: string
  mimeType?: string
  fileSize?: number
  filename: string
} | null {
  const message = ctx.message
  if (!message) return null
  if (message.photo?.length) {
    const item = message.photo.at(-1)!
    return { type: 'image', fileId: item.file_id, fileUniqueId: item.file_unique_id, fileSize: item.file_size, filename: 'photo.jpg' }
  }
  if (message.video) return { type: 'video', fileId: message.video.file_id, fileUniqueId: message.video.file_unique_id, mimeType: message.video.mime_type, fileSize: message.video.file_size, filename: message.video.file_name ?? 'video.mp4' }
  if (message.audio) return { type: 'audio', fileId: message.audio.file_id, fileUniqueId: message.audio.file_unique_id, mimeType: message.audio.mime_type, fileSize: message.audio.file_size, filename: message.audio.file_name ?? 'audio.mp3' }
  if (message.voice) return { type: 'voice', fileId: message.voice.file_id, fileUniqueId: message.voice.file_unique_id, mimeType: message.voice.mime_type, fileSize: message.voice.file_size, filename: 'voice.ogg' }
  if (message.video_note) return { type: 'video_note', fileId: message.video_note.file_id, fileUniqueId: message.video_note.file_unique_id, fileSize: message.video_note.file_size, filename: 'video-note.mp4' }
  if (message.animation) return { type: 'animation', fileId: message.animation.file_id, fileUniqueId: message.animation.file_unique_id, mimeType: message.animation.mime_type, fileSize: message.animation.file_size, filename: message.animation.file_name ?? 'animation.gif' }
  if (message.document) return { type: 'document', fileId: message.document.file_id, fileUniqueId: message.document.file_unique_id, mimeType: message.document.mime_type, fileSize: message.document.file_size, filename: message.document.file_name ?? 'document' }
  return null
}

async function sendMedia(bot: Bot, chatId: string, type: MediaType, fileId: string, caption: string) {
  if (type === 'image') await bot.api.sendPhoto(chatId, fileId, { caption })
  else if (type === 'video') await bot.api.sendVideo(chatId, fileId, { caption })
  else if (type === 'audio') await bot.api.sendAudio(chatId, fileId, { caption })
  else if (type === 'voice') await bot.api.sendVoice(chatId, fileId, { caption })
  else if (type === 'video_note') {
    await bot.api.sendVideoNote(chatId, fileId)
    await bot.api.sendMessage(chatId, caption)
  } else if (type === 'animation') await bot.api.sendAnimation(chatId, fileId, { caption })
  else await bot.api.sendDocument(chatId, fileId, { caption })
}

function formatIssues(issues: Awaited<ReturnType<AdminRepository['publicationIssues']>>) {
  if (!issues.length) return 'Проверка пройдена: ошибок и предупреждений нет.'
  return issues.slice(0, 30).map((issue) => `${issue.severity === 'error' ? '⛔️' : '⚠️'} ${issue.message}`).join('\n')
}

function formatRecord(record: Record<string, unknown>) {
  return Object.entries(record).map(([key, value]) => `${key}: ${String(value)}`).join('\n')
}

function humanError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const known: Record<string, string> = {
    VERSION_NUMBER_ALREADY_HAS_DIFFERENT_CONTENT: 'У этой воронки уже есть версия с таким номером, но другим содержимым. Увеличьте version в конструкторе.',
    VERSION_NOT_FOUND: 'Версия не найдена.',
    FUNNEL_NOT_PUBLISHED: 'Сначала опубликуйте активную версию.',
    DIGITAL_REQUIRES_STARS: 'Цифровые товары внутри Telegram можно продавать только за Telegram Stars.',
    STARS_REQUIRES_XTR: 'Для Telegram Stars валюта должна быть XTR.',
    ASSET_NOT_FOUND: 'Ресурс не найден в этой версии.',
    MEDIA_NOT_BOUND: 'Файл ещё не привязан.',
    VK_RUNTIME_DISABLED: 'VK runtime не настроен: задайте VK_GROUP_ID и VK_GROUP_TOKEN.',
    VK_ATTACHMENT_INVALID: 'Некорректный VK attachment. Пример: video-123_456_accessKey.',
    VK_VIDEO_ATTACHMENT_REQUIRED: 'Нужен attachment типа video.',
  }
  if (message.startsWith('MEDIA_TYPE_MISMATCH:')) return `Ожидается тип ${message.split(':')[1]}.`
  if (message.startsWith('VK_MEDIA_UPLOAD_UNSUPPORTED:')) return `Этот тип (${message.split(':')[1]}) пока нельзя загрузить в VK.`
  if (message.startsWith('VK_HTTP_ERROR:')) return 'VK временно не принял загрузку. Проверьте доступность VK и повторите попытку.'
  if (message.startsWith('VK_API_ERROR:')) return 'VK отклонил файл или не разрешил загрузку в выбранный диалог. Проверьте файл и повторите попытку.'
  if (message.startsWith('VK_UPLOAD_MISSING_FIELD:') || message === 'VK_PHOTO_SAVE_EMPTY' || message === 'VK_SAVED_ATTACHMENT_INVALID') {
    return 'VK вернул неполные данные о загруженном файле. Повторите попытку.'
  }
  return known[message] ?? message
}

function vkPeerLabel(peer: { peer_id: string; first_name: string | null; username: string | null }) {
  const firstName = peer.first_name?.trim()
  const username = peer.username ? `@${peer.username.replace(/^@/, '')}` : ''
  const label = [firstName, username].filter(Boolean).join(' · ') || 'Пользователь VK'
  return label.slice(0, 48)
}
