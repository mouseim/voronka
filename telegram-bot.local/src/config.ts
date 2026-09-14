import 'dotenv/config'
import { z } from 'zod'

const environmentSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  ADMIN_TELEGRAM_IDS: z.string().default(''),
  APPLICATIONS_CHAT_ID: z.string().default(''),
  DATABASE_URL: z.string().url(),
  BOT_MODE: z.enum(['polling', 'webhook']).default('polling'),
  PUBLIC_BASE_URL: z.string().url().optional().or(z.literal('')),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional().or(z.literal('')),
  TELEGRAM_PAYMENT_PROVIDER_TOKEN: z.string().optional().default(''),
  EDITOR_ADMIN_TOKEN: z.string().optional().default(''),
  INTEGRATION_ENCRYPTION_KEY: z.string().optional().default(''),
  EDITOR_ORIGINS: z.string().optional().default('http://localhost:5173,http://127.0.0.1:5173'),
  VK_GROUP_ID: z.string().optional().default(''),
  VK_GROUP_TOKEN: z.string().optional().default(''),
  VK_API_VERSION: z.string().default('5.199'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  MAX_FUNNEL_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
  MAX_MEDIA_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  WORKER_POLL_MS: z.coerce.number().int().min(250).default(1000),
})

export type AppConfig = ReturnType<typeof loadConfig>

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const result = environmentSchema.safeParse(source)
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    throw new Error(`Некорректная конфигурация Telegram-бота: ${details}`)
  }
  const raw = result.data
  const adminIds = raw.ADMIN_TELEGRAM_IDS.split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      if (!/^-?\d+$/.test(value)) throw new Error(`ADMIN_TELEGRAM_IDS содержит нечисловое значение: ${value}`)
      return value
    })
  if (raw.BOT_MODE === 'webhook' && (!raw.PUBLIC_BASE_URL || !raw.TELEGRAM_WEBHOOK_SECRET)) {
    throw new Error('Для BOT_MODE=webhook нужны PUBLIC_BASE_URL и TELEGRAM_WEBHOOK_SECRET.')
  }
  if (Boolean(raw.VK_GROUP_ID) !== Boolean(raw.VK_GROUP_TOKEN)) {
    throw new Error('VK_GROUP_ID и VK_GROUP_TOKEN должны быть заданы вместе.')
  }
  if (raw.VK_GROUP_ID && !/^[1-9]\d*$/.test(raw.VK_GROUP_ID)) {
    throw new Error('VK_GROUP_ID должен быть положительным числом.')
  }
  if (raw.EDITOR_ADMIN_TOKEN && raw.EDITOR_ADMIN_TOKEN.length < 16) {
    throw new Error('EDITOR_ADMIN_TOKEN должен содержать не менее 16 символов.')
  }
  return {
    telegramToken: raw.TELEGRAM_BOT_TOKEN,
    adminIds: new Set(adminIds),
    applicationsChatId: raw.APPLICATIONS_CHAT_ID || null,
    databaseUrl: raw.DATABASE_URL,
    botMode: raw.BOT_MODE,
    publicBaseUrl: raw.PUBLIC_BASE_URL ? raw.PUBLIC_BASE_URL.replace(/\/+$/, '') : null,
    webhookSecret: raw.TELEGRAM_WEBHOOK_SECRET || null,
    paymentProviderToken: raw.TELEGRAM_PAYMENT_PROVIDER_TOKEN,
    editorAdminToken: raw.EDITOR_ADMIN_TOKEN,
    integrationEncryptionKey: raw.INTEGRATION_ENCRYPTION_KEY,
    editorOrigins: raw.EDITOR_ORIGINS.split(',').map((value) => value.trim().replace(/\/$/, '')).filter(Boolean),
    vk: raw.VK_GROUP_ID ? {
      groupId: raw.VK_GROUP_ID,
      token: raw.VK_GROUP_TOKEN,
      apiVersion: raw.VK_API_VERSION,
    } : null,
    logLevel: raw.LOG_LEVEL,
    port: raw.PORT,
    host: raw.HOST,
    maxFunnelBytes: raw.MAX_FUNNEL_BYTES,
    maxMediaBytes: raw.MAX_MEDIA_BYTES,
    workerPollMs: raw.WORKER_POLL_MS,
  }
}
