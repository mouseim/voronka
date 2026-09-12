import Fastify from 'fastify'
import { webhookCallback, type Bot } from 'grammy'
import type { Logger } from 'pino'
import type { AppConfig } from '../config'
import type { DatabasePool } from '../db/pool'
import type { FunnelEngine } from '../runtime/engine'

export function createHttpServer(
  config: AppConfig,
  pool: DatabasePool,
  bot: Bot,
  engine: FunnelEngine,
  logger: Logger,
) {
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: config.maxFunnelBytes,
    trustProxy: true,
  })

  app.get('/health/live', async () => ({ status: 'ok' }))
  app.get('/health/ready', async (_request, reply) => {
    try {
      await pool.query('SELECT 1')
      return { status: 'ready' }
    } catch {
      reply.code(503)
      return { status: 'not_ready' }
    }
  })
  app.get<{ Params: { token: string } }>('/r/:token', async (request, reply) => {
    const target = await engine.handleRedirect(request.params.token)
    if (!target) {
      reply.code(410)
      return 'Ссылка устарела или уже была использована.'
    }
    return reply.redirect(target, 302)
  })

  if (config.botMode === 'webhook') {
    app.post('/telegram/webhook', webhookCallback(bot, 'fastify', {
      secretToken: config.webhookSecret!,
      timeoutMilliseconds: 9_000,
      onTimeout: 'return',
    }))
  }

  return app
}
