import { randomBytes } from 'node:crypto'
import { Bot, Context, InlineKeyboard, InputFile } from 'grammy'
import type { Logger } from 'pino'
import { parseAndMigrateFunnelDocument, type MediaType } from '../core/shared'
import type { AppConfig } from '../config'
import type { AdminRepository } from './repository'
import type { VkMediaBindingService } from '../vk/media-bindings'

type AdminAction =
  | { type: 'main' }
  | { type: 'funnels' }
  | { type: 'versions'; funnelId: string }
  | { type: 'version'; versionId: string }
  | { type: 'validate'; versionId: string }
  | { type: 'publish'; versionId: string; placeholders: boolean }
  | { type: 'set_default'; funnelId: string }
  | { type: 'rollback'; funnelId: string; versionId: string }
  | { type: 'media'; versionId: string }
  | { type: 'media_info'; versionId: string; assetId: string }
  | { type: 'media_upload'; versionId: string; assetId: string; expectedType: MediaType }
  | { type: 'media_unbind'; versionId: string; assetId: string }
  | { type: 'media_test'; versionId: string; assetId: string }
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
      { reply_markup: this.versionKeyboard(adminId, imported.versionId, imported.funnelId, false, false) })
    } catch (error) {
      this.logger.error({ err: error, adminId }, 'Ошибка импорта .funnel')
      await ctx.reply(`Импорт не выполнен: ${humanError(error)}`)
    }
    return true
  }

  async handleMedia(ctx: Context) {
    if (!this.isAdministrator(ctx) || !ctx.from || !ctx.message) return false
    const adminId = String(ctx.from.id)
    const state = this.input.get(adminId)
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
      await ctx.reply(confirmation, {
        reply_markup: this.keyboard(adminId, [
          [{ text: '← К файлам', action: { type: 'media', versionId: state.versionId } }],
        ]),
      })
    } catch (error) {
      await ctx.reply(`Не удалось привязать файл: ${humanError(error)}`)
    }
    return true
  }

  private async execute(ctx: Context, adminId: string, action: AdminAction) {
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
      await ctx.reply(rows.length ? rows.map((row) =>
        `v${row.version} · ${row.status} · сессий ${row.active_sessions} · файлов не хватает ${row.missing_media}`,
      ).join('\n') : 'Версий нет.', { reply_markup: this.keyboard(adminId, [
        ...rows.map((row) => [{ text: `v${row.version} — ${row.status}`, action: { type: 'version' as const, versionId: row.id } }]),
        [{ text: '← К воронкам', action: { type: 'funnels' as const } }],
      ]) })
      return
    }
    if (action.type === 'version') {
      const details = await this.repository.versionDetails(action.versionId)
      if (!details) throw new Error('VERSION_NOT_FOUND')
      await ctx.reply([
        `${details.funnel_name} · v${details.version}`,
        `Формат: ${details.schema_version}`,
        `Статус: ${details.status}${details.active ? ' · активная' : ''}${details.default_for_bot ? ' · default' : ''}`,
        `Заглушки: ${details.allow_placeholders ? 'разрешены' : 'нет'}`,
        `ID: ${details.id}`,
      ].join('\n'), {
        reply_markup: this.versionKeyboard(adminId, details.id, details.funnel_id, details.active, details.default_for_bot),
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
    if (action.type === 'publish') {
      const result = await this.repository.publish(action.versionId, adminId, action.placeholders)
      await ctx.reply(result.published
        ? `Версия опубликована${action.placeholders ? ' с явно разрешёнными заглушками' : ''}. Новые старты пойдут на неё.`
        : `Публикация заблокирована:\n${formatIssues(result.issues)}`)
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
      const row = (await this.repository.listMedia(action.versionId)).find((item) => item.asset_id === action.assetId)
      if (!row) throw new Error('ASSET_NOT_FOUND')
      await ctx.reply([
        `Telegram: ${row.telegram_bound ? '✅ привязан' : '❓ не загружен'}`,
        `VK: ${row.vk_bound ? `✅ ${row.vk_attachment_type}${row.vk_owner_id}_${row.vk_media_id}` : '❓ не привязан'}`,
        `Asset: ${row.asset_key}`,
        `Ожидаемый тип: ${row.expected_type}`,
        row.file_size ? `Размер: ${row.file_size} байт` : '',
        row.mime_type ? `MIME: ${row.mime_type}` : '',
      ].filter(Boolean).join('\n'), { reply_markup: this.keyboard(adminId, [
        [{ text: row.bound ? 'Заменить' : 'Загрузить', action: { type: 'media_upload', versionId: action.versionId, assetId: action.assetId, expectedType: row.expected_type } }],
        ...(row.bound ? [
          [{ text: 'Тестовая отправка', action: { type: 'media_test' as const, versionId: action.versionId, assetId: action.assetId } }],
          [{ text: 'Удалить привязку', action: { type: 'media_unbind' as const, versionId: action.versionId, assetId: action.assetId } }],
        ] : []),
        [{ text: '← К файлам', action: { type: 'media', versionId: action.versionId } }],
      ]) })
      return
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
        'VK photo/voice/document upload:',
        '/vkmedia VERSION_ID ASSET_ID VK_PEER_ID',
        'Затем отправьте файл в этот чат.',
        '',
        'VK video binding:',
        '/vkmedia VERSION_ID ASSET_ID VK_PEER_ID video-123_456_accessKey',
        '',
        'Stars: provider=telegram_stars, currency=XTR.',
        'ЮKassa: provider=yookassa и TELEGRAM_PAYMENT_PROVIDER_TOKEN; digital через ЮKassa запрещён.',
        '',
        'Rollback: /rollback FUNNEL_ID VERSION_ID',
        'CSV: /csv contacts|applications|payments|sources|nodes|tests [VERSION_ID]',
      ].join('\n'))
    }
  }

  private versionKeyboard(adminId: string, versionId: string, funnelId: string, active: boolean, isDefault: boolean) {
    const rows: Array<Array<{ text: string; action: AdminAction }>> = [
      [{ text: 'Проверить', action: { type: 'validate', versionId } }, { text: 'Файлы', action: { type: 'media', versionId } }],
      [{ text: 'Статистика', action: { type: 'stats', versionId } }, { text: 'Экспорт .funnel', action: { type: 'export', versionId } }],
      [{ text: 'Опубликовать', action: { type: 'publish', versionId, placeholders: false } }],
      [{ text: 'Опубликовать с заглушками', action: { type: 'publish', versionId, placeholders: true } }],
    ]
    if (!isDefault && active) rows.push([{ text: 'Сделать default', action: { type: 'set_default', funnelId } }])
    if (!active) rows.push([{ text: 'Rollback на эту версию', action: { type: 'rollback', funnelId, versionId } }])
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

  private keyboard(adminId: string, rows: Array<Array<{ text: string; action: AdminAction }>>) {
    const keyboard = new InlineKeyboard()
    rows.forEach((row, rowIndex) => {
      row.forEach((item) => keyboard.text(item.text, `adm_${this.register(adminId, item.action)}`))
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
  }
  if (message.startsWith('MEDIA_TYPE_MISMATCH:')) return `Ожидается тип ${message.split(':')[1]}.`
  return known[message] ?? message
}
