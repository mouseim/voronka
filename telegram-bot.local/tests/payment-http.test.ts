import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config'
import { createHttpServer } from '../src/http/server'
import { loadDemo } from './helpers'

describe('payment HTTP boundary', () => {
  it('защищает admin API, ограничивает CORS и не возвращает секрет', async () => {
    const saved: Array<{ shopId: string; secretKey: string }> = []
    const integration = {
      status: async () => ({ configured: saved.length > 0, shopIdMasked: saved.length ? '12****90' : null, verifiedAt: null, updatedAt: null }),
      save: async (value: { shopId: string; secretKey: string }) => { saved.push(value) },
    }
    const app = server({ integration, payments: { checkCredentials: async () => undefined } })
    try {
      expect((await app.inject({ method: 'GET', url: '/admin/integrations/yookassa' })).statusCode).toBe(401)
      const response = await app.inject({
        method: 'PUT', url: '/admin/integrations/yookassa',
        headers: { authorization: 'Bearer admin-token-long', origin: 'http://localhost:5173' },
        payload: { shopId: '1234567890', secretKey: 'merchant-secret' },
      })
      expect(response.statusCode).toBe(200)
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173')
      expect(response.body).not.toContain('merchant-secret')
      expect(saved).toEqual([{ shopId: '1234567890', secretKey: 'merchant-secret' }])
      const denied = await app.inject({ method: 'OPTIONS', url: '/admin/integrations/yookassa', headers: { origin: 'https://evil.test' } })
      expect(denied.statusCode).toBe(403)
    } finally { await app.close() }
  })

  it('принимает только известные webhook events и передаёт лишь provider id на перепроверку', async () => {
    const accept = vi.fn(async () => undefined)
    const app = server({ payments: {}, acceptYooKassaPayment: accept })
    try {
      expect((await app.inject({ method: 'POST', url: '/webhooks/yookassa', payload: { event: 'payment.waiting_for_capture', object: { id: 'ignored' } } })).statusCode).toBe(200)
      expect(accept).not.toHaveBeenCalled()
      expect((await app.inject({ method: 'POST', url: '/webhooks/yookassa', payload: { event: 'payment.succeeded', object: { id: 'provider-42', status: 'succeeded', paid: true } } })).statusCode).toBe(200)
      expect(accept).toHaveBeenCalledWith('provider-42')
    } finally { await app.close() }
  })

  it('защищает прямую публикацию, проверяет документ и возвращает синхронизированную версию', async () => {
    const document = await loadDemo()
    const publishFromEditor = vi.fn(async () => ({
      published: true as const,
      created: true,
      versionId: 'version-id',
      funnelId: 'funnel-id',
      document: { ...document, funnel: { ...document.funnel, version: 4, status: 'published' as const } },
      issues: [],
    }))
    const app = server({ adminRepository: { publishFromEditor } })
    try {
      expect((await app.inject({ method: 'POST', url: '/admin/editor/publish', payload: document })).statusCode).toBe(401)
      expect((await app.inject({
        method: 'OPTIONS', url: '/admin/editor/publish', headers: { origin: 'https://evil.test' },
      })).statusCode).toBe(403)
      const invalid = await app.inject({
        method: 'POST', url: '/admin/editor/publish', headers: { authorization: 'Bearer admin-token-long' }, payload: {},
      })
      expect(invalid.statusCode).toBe(400)
      expect(invalid.json()).toMatchObject({ error: 'invalid_document' })
      const noProvider = structuredClone(document)
      delete noProvider.products[0]!.paymentProvider
      const providerBlocked = await app.inject({
        method: 'POST', url: '/admin/editor/publish', headers: { authorization: 'Bearer admin-token-long' }, payload: noProvider,
      })
      expect(providerBlocked.statusCode).toBe(422)
      expect(providerBlocked.json()).toMatchObject({
        error: 'publication_blocked',
        issues: [expect.objectContaining({ code: 'payment_provider_missing' })],
      })

      const response = await app.inject({
        method: 'POST', url: '/admin/editor/publish',
        headers: { authorization: 'Bearer admin-token-long', origin: 'http://localhost:5173' },
        payload: document,
      })
      expect(response.statusCode).toBe(200)
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173')
      expect(response.json()).toMatchObject({ published: true, created: true, unchanged: false, version: 4 })
      expect(publishFromEditor).toHaveBeenCalledWith(expect.objectContaining({ documentType: 'funnel' }), '1')
      expect(response.body).not.toContain('secretKey')
    } finally { await app.close() }
  })

  it('отдаёт только список и активный документ через защищённый editor API', async () => {
    const document = await loadDemo()
    document.analytics.contacts = [{ id: 'private-contact', email: 'hidden@example.test' }]
    const app = server({
      adminRepository: {
        listEditorFunnels: async () => [{ id: document.funnel.id, name: document.funnel.name, activeVersion: 3, updatedAt: '2026-09-14T00:00:00.000Z', publishedAt: '2026-09-14T00:00:00.000Z', isDefault: true, nodeCount: document.nodes.length }],
        getEditorFunnel: async (id: string) => id === document.funnel.id ? { ...document, analytics: { ...document.analytics, contacts: [], applications: [] } } : null,
      },
    })
    try {
      expect((await app.inject({ method: 'GET', url: '/admin/editor/funnels' })).statusCode).toBe(401)
      const list = await app.inject({
        method: 'GET', url: '/admin/editor/funnels',
        headers: { authorization: 'Bearer admin-token-long', origin: 'http://localhost:5173' },
      })
      expect(list.statusCode).toBe(200)
      expect(list.headers['access-control-allow-origin']).toBe('http://localhost:5173')
      expect(list.json()).toMatchObject({ funnels: [expect.objectContaining({ id: document.funnel.id, activeVersion: 3 })] })
      const active = await app.inject({
        method: 'GET', url: `/admin/editor/funnels/${document.funnel.id}`,
        headers: { authorization: 'Bearer admin-token-long' },
      })
      expect(active.statusCode).toBe(200)
      expect(active.json()).toMatchObject({ document: { documentType: 'funnel', funnel: { id: document.funnel.id } } })
      expect(active.body).not.toContain('hidden@example.test')
      expect(active.body).not.toMatch(/secretKey|EDITOR_ADMIN_TOKEN|TELEGRAM_BOT_TOKEN|VK_GROUP_TOKEN/)
      expect((await app.inject({
        method: 'GET', url: '/admin/editor/funnels/missing', headers: { authorization: 'Bearer admin-token-long' },
      })).statusCode).toBe(404)
    } finally { await app.close() }
  })
})

function server(dependencies: Record<string, unknown>) {
  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: 'token', DATABASE_URL: 'postgresql://localhost/test',
    ADMIN_TELEGRAM_IDS: '1',
    EDITOR_ADMIN_TOKEN: 'admin-token-long', EDITOR_ORIGINS: 'http://localhost:5173',
  })
  const pool = { query: async () => ({ rows: [], rowCount: 1 }) }
  const engine = { handleRedirect: async () => null }
  return createHttpServer(config, pool as never, {} as never, engine as never, pino({ level: 'silent' }), {
    acceptYooKassaPayment: async () => undefined,
    ...dependencies,
  } as never)
}
