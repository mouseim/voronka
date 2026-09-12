import { Bot, GrammyError, HttpError } from 'grammy'
import type { Logger } from 'pino'
import type { AdminController } from '../admin/controller'
import type { FunnelEngine } from '../runtime/engine'
import type { RuntimeStore } from '../runtime/store'
import type { TelegramProfile } from '../domain/types'

export function createTelegramBot(
  bot: Bot,
  store: RuntimeStore,
  engine: FunnelEngine,
  admin: AdminControllerFactory,
  logger: Logger,
) {
  const adminController = admin(bot)

  bot.use(async (ctx, next) => {
    if (!await store.reserveUpdate(ctx.update.update_id)) return
    await next()
  })

  bot.command('admin', (ctx) => adminController.open(ctx))
  bot.command('whoami', (ctx) => ctx.reply(`Ваш Telegram ID: ${ctx.from?.id ?? 'не определён'}`))
  bot.command('chatid', (ctx) => ctx.reply(`ID этого чата: ${ctx.chat?.id ?? 'не определён'}`))
  bot.command('start', async (ctx) => {
    if (!ctx.from) return
    await engine.start(toProfile(ctx.from), String(ctx.match ?? '').trim() || undefined)
  })
  bot.command('stop', async (ctx) => {
    if (!ctx.from) return
    await engine.stop(toProfile(ctx.from))
  })
  bot.command('product', (ctx) => adminController.handleCommand(ctx, 'product', String(ctx.match ?? '')))
  bot.command('rollback', (ctx) => adminController.handleCommand(ctx, 'rollback', String(ctx.match ?? '')))
  bot.command('csv', (ctx) => adminController.handleCommand(ctx, 'csv', String(ctx.match ?? '')))

  bot.callbackQuery(/^adm_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => undefined)
    await adminController.handleCallback(ctx, ctx.match[1]!)
  })
  bot.on('callback_query:data', async (ctx) => {
    if (!ctx.from) return
    await ctx.answerCallbackQuery().catch(() => undefined)
    await engine.handleCallback(toProfile(ctx.from), ctx.callbackQuery.data)
  })

  bot.on('pre_checkout_query', async (ctx) => {
    const query = ctx.preCheckoutQuery
    const checked = await engine.validatePreCheckout(query.invoice_payload, query.total_amount, query.currency)
    await ctx.answerPreCheckoutQuery(checked.ok, checked.ok ? undefined : { error_message: checked.message ?? 'Счёт недействителен.' })
  })
  bot.on('message:successful_payment', async (ctx) => {
    if (!ctx.from) return
    const payment = ctx.message.successful_payment
    await engine.handleSuccessfulPayment(toProfile(ctx.from), {
      payload: payment.invoice_payload,
      amountMinor: payment.total_amount,
      currency: payment.currency,
      telegramChargeId: payment.telegram_payment_charge_id,
      providerChargeId: payment.provider_payment_charge_id,
    })
  })

  bot.on([
    'message:document',
    'message:photo',
    'message:video',
    'message:audio',
    'message:voice',
    'message:video_note',
    'message:animation',
  ], async (ctx, next) => {
    const handled = ctx.message.document
      ? await adminController.handleDocument(ctx)
      : await adminController.handleMedia(ctx)
    if (!handled) await next()
  })

  bot.on('message:text', async (ctx) => {
    if (!ctx.from || ctx.message.text.startsWith('/')) return
    await engine.handleText(toProfile(ctx.from), ctx.message.text)
  })

  bot.catch(async (error) => {
    const details = error.error instanceof GrammyError
      ? { description: error.error.description, method: error.error.method }
      : error.error instanceof HttpError
        ? { http: error.error.message }
        : { err: error.error }
    logger.error({ updateId: error.ctx.update.update_id, ...details }, 'Необработанная ошибка Telegram update')
  })

  return { bot, adminController }
}

export type AdminControllerFactory = (bot: Bot) => AdminController

function toProfile(from: {
  id: number
  username?: string
  first_name: string
  last_name?: string
  language_code?: string
}): TelegramProfile {
  return {
    telegramId: String(from.id),
    username: from.username,
    firstName: from.first_name,
    lastName: from.last_name,
    languageCode: from.language_code,
  }
}
