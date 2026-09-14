import Fastify from 'fastify'
import { webhookCallback, type Bot } from 'grammy'
import type { Logger } from 'pino'
import type { AppConfig } from '../config'
import type { DatabasePool } from '../db/pool'
import type { FunnelEngine } from '../runtime/engine'
import type { AdminRepository } from '../admin/repository'
import { parseAndMigrateFunnelDocument, validateFunnel } from '../core/shared'
import { verifyAdminToken, type YooKassaIntegrationRepository, type YooKassaPaymentService } from '../payments/yookassa'

interface PaymentHttpDependencies {
  adminRepository?: AdminRepository
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
    if (!request.url.startsWith('/admin/integrations/') && !request.url.startsWith('/admin/editor/')) return
    const origin = request.headers.origin?.replace(/\/$/, '')
    if (origin && config.editorOrigins.includes(origin)) {
      reply.header('Access-Control-Allow-Origin', origin)
      reply.header('Vary', 'Origin')
      reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      reply.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS')
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

  app.post<{ Body: unknown }>('/admin/editor/publish', async (request, reply) => {
    if (!paymentDependencies?.adminRepository) return reply.code(503).send({
      error: 'publishing_unavailable',
      message: 'Публикация из конструктора сейчас недоступна.',
    })
    const adminId = config.adminIds.values().next().value
    if (!adminId) return reply.code(503).send({
      error: 'administrator_unavailable',
      message: 'На сервере не настроен администратор для журнала публикаций.',
    })
    const parsed = parseAndMigrateFunnelDocument(request.body)
    if (!parsed.success) return reply.code(400).send({
      error: 'invalid_document',
      message: 'Воронка содержит некорректные данные.',
      issues: parsed.errors.map((message) => ({ severity: 'error', section: 'document', code: 'invalid_document', message })),
    })
    const documentIssues = validateFunnel(parsed.document)
    if (documentIssues.some((issue) => issue.severity === 'error')) return reply.code(422).send({
      error: 'publication_blocked',
      message: 'Исправьте ошибки перед публикацией.',
      issues: documentIssues,
    })
    try {
      const result = await paymentDependencies.adminRepository.publishFromEditor(parsed.document, adminId)
      if (!result.published) return reply.code(422).send({
        error: 'publication_blocked',
        message: 'Исправьте ошибки перед публикацией.',
        issues: result.issues,
        version: result.document.funnel.version,
      })
      return {
        published: true,
        created: result.created,
        unchanged: !result.created,
        version: result.document.funnel.version,
        document: result.document,
        issues: result.issues,
      }
    } catch (error) {
      request.log.error({ err: error }, 'Не удалось опубликовать воронку из конструктора')
      return reply.code(500).send({
        error: 'publication_failed',
        message: 'Не удалось опубликовать воронку. Повторите попытку или воспользуйтесь Telegram-админкой.',
      })
    }
  })

  app.get('/admin/editor/funnels', async (_request, reply) => {
    if (!paymentDependencies?.adminRepository) return reply.code(503).send({
      error: 'sync_unavailable', message: 'Загрузка опубликованных воронок сейчас недоступна.',
    })
    return { funnels: await paymentDependencies.adminRepository.listEditorFunnels() }
  })

  app.get<{ Params: { id: string } }>('/admin/editor/funnels/:id', async (request, reply) => {
    if (!paymentDependencies?.adminRepository) return reply.code(503).send({
      error: 'sync_unavailable', message: 'Загрузка опубликованной воронки сейчас недоступна.',
    })
    const document = await paymentDependencies.adminRepository.getEditorFunnel(request.params.id)
    if (!document) return reply.code(404).send({
      error: 'funnel_not_found', message: 'Опубликованная воронка не найдена.',
    })
    return { document }
  })

  app.delete<{ Params: { id: string } }>('/admin/editor/funnels/:id', async (request, reply) => {
    if (!paymentDependencies?.adminRepository) return reply.code(503).send({
      error: 'sync_unavailable', message: 'Удаление воронки сейчас недоступно.',
    })
    const adminId = config.adminIds.values().next().value
    if (!adminId) return reply.code(503).send({
      error: 'administrator_unavailable', message: 'На сервере не настроен администратор для журнала изменений.',
    })
    const result = await paymentDependencies.adminRepository.deleteEditorFunnel(request.params.id, adminId)
    if (!result) return reply.code(404).send({
      error: 'funnel_not_found', message: 'Воронка не найдена или уже удалена.',
    })
    return result
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
