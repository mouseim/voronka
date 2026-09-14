import Fastify from 'fastify'
import { webhookCallback, type Bot } from 'grammy'
import type { Logger } from 'pino'
import type { AppConfig } from '../config'
import type { DatabasePool } from '../db/pool'
import type { FunnelEngine } from '../runtime/engine'
import { verifyAdminToken, type YooKassaIntegrationRepository, type YooKassaPaymentService } from '../payments/yookassa'

interface PaymentHttpDependencies {
  integration?: YooKassaIntegrationRepository
  payments?: YooKassaPaymentService
  acceptYooKassaPayment(providerPaymentId: string): Promise<void>
}

export function createHttpServer(
  config: AppConfig,
  pool: DatabasePool,
  bot: Bot,
  engine: FunnelEngine,
  logger: Logger,
  paymentDependencies?: PaymentHttpDependencies,
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

  app.get('/payments/return', async (_request, reply) => reply
    .type('text/html; charset=utf-8')
    .send('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Оплата</title><body><main><h1>Спасибо</h1><p>Вернитесь в чат. Бот подтвердит платёж автоматически; также можно нажать «Проверить оплату».</p></main></body></html>'))

  app.post<{ Body: { event?: string; object?: { id?: string } } }>('/webhooks/yookassa', async (request, reply) => {
    const event = request.body?.event
    const providerPaymentId = request.body?.object?.id
    if (!providerPaymentId || !['payment.succeeded', 'payment.canceled'].includes(event ?? '')) {
      return reply.code(200).send({ accepted: false })
    }
    if (!paymentDependencies?.payments) return reply.code(503).send({ accepted: false })
    await paymentDependencies.acceptYooKassaPayment(providerPaymentId)
    return reply.code(200).send({ accepted: true })
  })

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/admin/integrations/')) return
    const origin = request.headers.origin?.replace(/\/$/, '')
    if (origin && config.editorOrigins.includes(origin)) {
      reply.header('Access-Control-Allow-Origin', origin)
      reply.header('Vary', 'Origin')
      reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      reply.header('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS')
    }
    if (request.method === 'OPTIONS') {
      if (!origin || !config.editorOrigins.includes(origin)) return reply.code(403).send()
      return reply.code(204).send()
    }
    if (!verifyAdminToken(request.headers.authorization, config.editorAdminToken)) return reply.code(401).send({ error: 'unauthorized' })
  })

  app.get('/admin/integrations/yookassa', async (_request, reply) => {
    if (!paymentDependencies?.integration) return reply.code(503).send({ error: 'integration_encryption_unavailable' })
    return paymentDependencies.integration.status()
  })

  app.put<{ Body: { shopId?: string; secretKey?: string } }>('/admin/integrations/yookassa', async (request, reply) => {
    if (!paymentDependencies?.integration) return reply.code(503).send({ error: 'integration_encryption_unavailable' })
    const shopId = String(request.body?.shopId ?? '').trim()
    const secretKey = String(request.body?.secretKey ?? '').trim()
    if (!shopId || !secretKey || shopId.length > 128 || secretKey.length > 256) return reply.code(400).send({ error: 'invalid_credentials' })
    await paymentDependencies.integration.save({ shopId, secretKey })
    return paymentDependencies.integration.status()
  })

  app.post('/admin/integrations/yookassa/check', async (_request, reply) => {
    if (!paymentDependencies?.payments) return reply.code(503).send({ error: 'integration_unavailable' })
    try {
      await paymentDependencies.payments.checkCredentials()
      return { ok: true, status: await paymentDependencies.integration?.status() }
    } catch {
      return reply.code(422).send({ ok: false, error: 'credentials_check_failed' })
    }
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
