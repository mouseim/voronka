import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config'
import { createHttpServer } from '../src/http/server'

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
})

function server(dependencies: Record<string, unknown>) {
  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: 'token', DATABASE_URL: 'postgresql://localhost/test',
    EDITOR_ADMIN_TOKEN: 'admin-token-long', EDITOR_ORIGINS: 'http://localhost:5173',
  })
  const pool = { query: async () => ({ rows: [], rowCount: 1 }) }
  const engine = { handleRedirect: async () => null }
  return createHttpServer(config, pool as never, {} as never, engine as never, pino({ level: 'silent' }), {
    acceptYooKassaPayment: async () => undefined,
    ...dependencies,
  } as never)
}
