export interface YooKassaIntegrationStatus {
  configured: boolean
  shopIdMasked: string | null
  verifiedAt: string | null
  updatedAt: string | null
}

const buildEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
let runtimeUrl = String(buildEnv?.VITE_RUNTIME_API_URL ?? '').replace(/\/$/, '')
let adminToken = ''

export function integrationConnection() {
  return { runtimeUrl, adminToken }
}

export function setIntegrationConnection(next: { runtimeUrl: string; adminToken: string }) {
  runtimeUrl = next.runtimeUrl.trim().replace(/\/$/, '')
  adminToken = next.adminToken
}

export async function getYooKassaStatus() {
  return request<YooKassaIntegrationStatus>('/admin/integrations/yookassa')
}

export async function saveYooKassa(credentials: { shopId: string; secretKey: string }) {
  return request<YooKassaIntegrationStatus>('/admin/integrations/yookassa', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials),
  })
}

export async function checkYooKassa() {
  return request<{ ok: boolean; status?: YooKassaIntegrationStatus }>('/admin/integrations/yookassa/check', { method: 'POST' })
}

async function request<T>(path: string, init: RequestInit = {}) {
  if (!runtimeUrl || !adminToken) throw new Error('Укажите адрес runtime и токен администратора.')
  const response = await fetch(`${runtimeUrl}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${adminToken}` },
  })
  if (!response.ok) {
    if (response.status === 401) throw new Error('Токен администратора не принят.')
    throw new Error('Runtime не выполнил запрос. Проверьте адрес и настройки интеграции.')
  }
  return await response.json() as T
}
