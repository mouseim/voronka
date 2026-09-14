import { afterEach, describe, expect, it, vi } from 'vitest'
import { freshDemoFunnel } from '../model/demo'

describe('editor runtime integration', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('хранит URL между сессиями, токен только во вкладке и публикует с Bearer auth', async () => {
    const localStorage = memoryStorage()
    const sessionStorage = memoryStorage()
    vi.stubGlobal('window', { localStorage, sessionStorage })
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
      published: true,
      created: true,
      unchanged: false,
      version: 2,
      document: { ...freshDemoFunnel(), funnel: { ...freshDemoFunnel().funnel, version: 2, status: 'published' } },
      issues: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const integrations = await import('./integrations')

    integrations.setIntegrationConnection({ runtimeUrl: 'https://runtime.example/', adminToken: 'private-admin-token' })
    await integrations.publishFunnel(freshDemoFunnel())

    expect(localStorage.getItem('voronka.runtimeUrl')).toBe('https://runtime.example')
    expect(localStorage.getItem('voronka.adminToken')).toBeNull()
    expect(sessionStorage.getItem('voronka.adminToken')).toBe('private-admin-token')
    expect(fetchMock).toHaveBeenCalledWith('https://runtime.example/admin/editor/publish', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer private-admin-token' }),
    }))
  })

  it('передаёт структурированные ошибки публикации в интерфейс', async () => {
    vi.stubGlobal('window', { localStorage: memoryStorage(), sessionStorage: memoryStorage() })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      message: 'Исправьте ошибки перед публикацией.',
      issues: [{ severity: 'error', section: 'media', code: 'runtime_media_binding_missing', message: 'Не загружен обязательный файл «Гайд».' }],
    }), { status: 422, headers: { 'Content-Type': 'application/json' } })))
    const integrations = await import('./integrations')
    integrations.setIntegrationConnection({ runtimeUrl: 'https://runtime.example', adminToken: 'private-admin-token' })

    await expect(integrations.publishFunnel(freshDemoFunnel())).rejects.toMatchObject({
      message: 'Исправьте ошибки перед публикацией.',
      issues: [expect.objectContaining({ code: 'runtime_media_binding_missing' })],
    })
  })
})

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}
