export interface YooKassaIntegrationStatus {
  configured: boolean
  shopIdMasked: string | null
  verifiedAt: string | null
  updatedAt: string | null
}

export interface PublishFunnelResponse {
  published: true
  created: boolean
  unchanged: boolean
  version: number
  document: import('../model/types').FunnelDocument
  issues: import('../model/types').ValidationIssue[]
}

export interface ServerFunnelSummary {
  id: string
  name: string
  activeVersion: number
  updatedAt: string
  publishedAt: string | null
  isDefault: boolean
  nodeCount: number
}

export class RuntimeRequestError extends Error {
  constructor(message: string, readonly issues: import('../model/types').ValidationIssue[] = []) {
    super(message)
  }
}

const buildEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
const browserStorage = typeof window === 'undefined' ? null : window
let runtimeUrl = String(browserStorage?.localStorage.getItem('voronka.runtimeUrl') ?? buildEnv?.VITE_RUNTIME_API_URL ?? '').replace(/\/$/, '')
let adminToken = String(browserStorage?.sessionStorage.getItem('voronka.adminToken') ?? '')

export function integrationConnection() {
  return { runtimeUrl, adminToken }
}

export function setIntegrationConnection(next: { runtimeUrl: string; adminToken: string }) {
  runtimeUrl = next.runtimeUrl.trim().replace(/\/$/, '')
  adminToken = next.adminToken
  browserStorage?.localStorage.setItem('voronka.runtimeUrl', runtimeUrl)
  if (adminToken) browserStorage?.sessionStorage.setItem('voronka.adminToken', adminToken)
  else browserStorage?.sessionStorage.removeItem('voronka.adminToken')
  if (typeof browserStorage?.dispatchEvent === 'function') browserStorage.dispatchEvent(new Event('voronka:connection-changed'))
}

export async function publishFunnel(document: import('../model/types').FunnelDocument) {
  return request<PublishFunnelResponse>('/admin/editor/publish', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(document),
  })
}

export async function getServerFunnels() {
  return (await request<{ funnels: ServerFunnelSummary[] }>('/admin/editor/funnels')).funnels
}

export async function getServerFunnel(id: string) {
  return (await request<{ document: import('../model/types').FunnelDocument }>(`/admin/editor/funnels/${encodeURIComponent(id)}`)).document
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
    const body = await response.json().catch(() => null) as { message?: string; issues?: import('../model/types').ValidationIssue[] } | null
    throw new RuntimeRequestError(body?.message ?? 'Runtime не выполнил запрос. Проверьте адрес и настройки интеграции.', body?.issues ?? [])
  }
  return await response.json() as T
}
