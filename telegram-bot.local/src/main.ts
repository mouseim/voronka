import { Bot } from 'grammy'
import pino from 'pino'
import { AdminController } from './admin/controller'
import { AdminRepository } from './admin/repository'
import { createTelegramBot } from './bot/create-bot'
import { GrammyTransport } from './bot/transport'
import { loadConfig } from './config'
import { migrate } from './db/migrate'
import { createPool } from './db/pool'
import { PostgresRuntimeStore } from './db/postgres-store'
import { createHttpServer } from './http/server'
import { createJobWorker } from './jobs/worker'
import { createMaintenanceWorker } from './jobs/maintenance'
import { FunnelEngine } from './runtime/engine'

const config = loadConfig()
const logger = pino({
  level: config.logLevel,
  redact: {
    paths: ['telegramToken', 'paymentProviderToken', 'req.headers.authorization', 'req.headers.x-telegram-bot-api-secret-token'],
    censor: '[REDACTED]',
  },
})
const pool = createPool(config.databaseUrl)
const store = new PostgresRuntimeStore(pool)
const bot = new Bot(config.telegramToken)
const transport = new GrammyTransport(bot, {
  administratorIds: config.adminIds,
  applicationsChatId: config.applicationsChatId,
})
const engine = new FunnelEngine(store, transport, {
  publicBaseUrl: config.publicBaseUrl,
  paymentProviderToken: config.paymentProviderToken,
})
const adminRepository = new AdminRepository(pool, store)
createTelegramBot(
  bot,
  store,
  engine,
  (targetBot) => new AdminController(targetBot, adminRepository, config, logger),
  logger,
)
const worker = createJobWorker(store, engine, logger, config.workerPollMs)
const maintenance = createMaintenanceWorker(pool, logger)
const server = createHttpServer(config, pool, bot, engine, logger)

let shuttingDown = false

async function main() {
  await migrate(pool)
  await bot.init()
  await bot.api.setMyCommands([
    { command: 'start', description: 'Начать или продолжить прохождение' },
    { command: 'stop', description: 'Остановить сообщения и напоминания' },
    { command: 'admin', description: 'Админка (только allowlist)' },
    { command: 'whoami', description: 'Показать ваш Telegram ID' },
    { command: 'chatid', description: 'Показать ID текущего чата' },
  ])
  if (config.botMode === 'webhook') {
    await bot.api.setWebhook(`${config.publicBaseUrl}/telegram/webhook`, {
      secret_token: config.webhookSecret!,
      allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
    })
  } else {
    await bot.api.deleteWebhook({ drop_pending_updates: false })
  }
  await server.listen({ host: config.host, port: config.port })
  worker.start()
  maintenance.start()
  logger.info({ mode: config.botMode, port: config.port }, 'Telegram runtime запущен')
  if (config.botMode === 'polling') {
    void bot.start({
      allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
      onStart: (info) => logger.info({ username: info.username }, 'Long polling запущен'),
    }).catch(async (error) => {
      logger.fatal({ err: error }, 'Long polling аварийно завершился')
      await shutdown('polling_error')
      process.exitCode = 1
    })
  }
}

async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, 'Остановка Telegram runtime')
  if (config.botMode === 'polling' && bot.isRunning()) await bot.stop()
  await worker.stop()
  await maintenance.stop()
  await server.close()
  await pool.end()
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

main().catch(async (error) => {
  logger.fatal({ err: error }, 'Не удалось запустить Telegram runtime')
  await shutdown('startup_error').catch(() => undefined)
  process.exitCode = 1
})
