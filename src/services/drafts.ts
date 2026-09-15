import { parseAndMigrateFunnelDocument } from '../model/schema'
import { defaultBotSettings, emptyAnalytics } from '../model/funnel'
import type { DraftRevision, DraftSummary, FunnelDocument } from '../model/types'
import { validateFunnel } from '../model/validation'

const DATABASE_NAME = 'voronka-funnel-builder'
const DRAFTS_STORE = 'drafts'
const REVISIONS_STORE = 'revisions'
const DATABASE_VERSION = 2
const REVISION_LIMIT = 20

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(DRAFTS_STORE)) database.createObjectStore(DRAFTS_STORE, { keyPath: 'id' })
      if (!database.objectStoreNames.contains(REVISIONS_STORE)) {
        const revisions = database.createObjectStore(REVISIONS_STORE, { keyPath: 'id' })
        revisions.createIndex('draftId', 'draftId', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function requestFromStore<T>(storeName: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, mode)
    const request = run(tx.objectStore(storeName))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    tx.onerror = () => reject(tx.error)
    tx.oncomplete = () => database.close()
  })
}

export function draftKey(document: FunnelDocument) {
  return `${document.funnel.id}::v${document.funnel.version}`
}

export function toDraft(document: FunnelDocument): DraftSummary {
  const issues = validateFunnel(document)
  return {
    id: draftKey(document),
    name: document.funnel.name,
    version: document.funnel.version,
    status: document.funnel.status,
    schemaVersion: document.schemaVersion,
    updatedAt: document.funnel.updatedAt,
    nodeCount: document.nodes.length,
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
    document: structuredClone(document),
  }
}

export async function saveDraft(document: FunnelDocument): Promise<DraftSummary> {
  const draft = toDraft(document)
  try { await requestFromStore(DRAFTS_STORE, 'readwrite', (store) => store.put(draft)) }
  catch (error) {
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'UnknownError')) throw new Error('Локальное хранилище переполнено. Экспортируйте резервную копию и удалите старые ревизии.')
    throw error
  }
  return draft
}

export async function getDrafts(): Promise<DraftSummary[]> {
  const stored = await requestFromStore<unknown[]>(DRAFTS_STORE, 'readonly', (store) => store.getAll())
  const drafts: DraftSummary[] = []
  for (const raw of stored) {
    if (!raw || typeof raw !== 'object' || !('document' in raw)) continue
    const parsed = parseAndMigrateFunnelDocument((raw as { document: unknown }).document)
    if (!parsed.success) continue
    const draft = toDraft(parsed.document)
    drafts.push(draft)
    const oldId = (raw as { id?: string }).id
    if (oldId !== draft.id) {
      await saveDraft(parsed.document)
      if (oldId && oldId !== draft.id) await requestFromStore(DRAFTS_STORE, 'readwrite', (store) => store.delete(oldId))
    }
  }
  return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function deleteDraft(id: string): Promise<void> {
  await requestFromStore(DRAFTS_STORE, 'readwrite', (store) => store.delete(id))
  const revisions = await getRevisions(id)
  for (const revision of revisions) await requestFromStore(REVISIONS_STORE, 'readwrite', (store) => store.delete(revision.id))
}

export async function deleteFunnelDrafts(funnelId: string): Promise<void> {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction([DRAFTS_STORE, REVISIONS_STORE], 'readwrite')
    const draftsStore = tx.objectStore(DRAFTS_STORE)
    const revisionsStore = tx.objectStore(REVISIONS_STORE)
    const draftsRequest = draftsStore.getAll()
    const revisionsRequest = revisionsStore.getAll()
    let drafts: unknown[] | null = null
    let revisions: DraftRevision[] | null = null
    const remove = () => {
      if (!drafts || !revisions) return
      for (const raw of drafts) {
        const draft = raw as Partial<DraftSummary>
        if (draft.document?.funnel.id === funnelId && draft.id) draftsStore.delete(draft.id)
      }
      for (const revision of revisions) {
        if (revision.document?.funnel.id === funnelId || revision.draftId.startsWith(`${funnelId}::v`)) revisionsStore.delete(revision.id)
      }
    }
    draftsRequest.onsuccess = () => { drafts = draftsRequest.result; remove() }
    revisionsRequest.onsuccess = () => { revisions = revisionsRequest.result as DraftRevision[]; remove() }
    tx.oncomplete = () => { database.close(); resolve() }
    tx.onerror = () => { database.close(); reject(tx.error) }
    tx.onabort = () => { database.close(); reject(tx.error) }
  })
}

export async function saveRevision(document: FunnelDocument, reason: string): Promise<DraftRevision> {
  const draftId = draftKey(document)
  const revision: DraftRevision = {
    id: `${draftId}::revision::${new Date().toISOString()}::${crypto.randomUUID()}`,
    draftId,
    createdAt: new Date().toISOString(),
    reason,
    nodeCount: document.nodes.length,
    document: structuredClone(document),
  }
  await requestFromStore(REVISIONS_STORE, 'readwrite', (store) => store.put(revision))
  const revisions = await getRevisions(draftId)
  for (const old of revisions.slice(REVISION_LIMIT)) await requestFromStore(REVISIONS_STORE, 'readwrite', (store) => store.delete(old.id))
  return revision
}

export async function getRevisions(draftId: string): Promise<DraftRevision[]> {
  const database = await openDatabase()
  const result = await new Promise<DraftRevision[]>((resolve, reject) => {
    const tx = database.transaction(REVISIONS_STORE, 'readonly')
    const index = tx.objectStore(REVISIONS_STORE).index('draftId')
    const request = index.getAll(draftId)
    request.onsuccess = () => resolve(request.result as DraftRevision[])
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => database.close()
  })
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function clearRevisions(draftId: string): Promise<void> {
  const revisions = await getRevisions(draftId)
  for (const revision of revisions) await requestFromStore(REVISIONS_STORE, 'readwrite', (store) => store.delete(revision.id))
}

export function documentsMatchForSync(left: FunnelDocument, right: FunnelDocument) {
  return canonicalJson(syncComparable(left)) === canonicalJson(syncComparable(right))
}

function syncComparable(source: FunnelDocument) {
  const document = structuredClone(source)
  const defaults = defaultBotSettings()
  document.bot.reminders = { ...defaults.reminders, ...document.bot.reminders }
  document.nodes.forEach((node) => {
    if (node.type === 'timer') {
      ;(node.data as { background?: boolean }).background ??= false
    }
  })
  document.bot.trackingLinks = document.bot.trackingLinks.map((link) => ({
    ...link,
    platform: link.platform ?? 'telegram',
    locked: link.locked ?? true,
    source: link.source ?? '',
    campaign: link.campaign ?? '',
  }))
  document.funnel.status = 'published'
  document.funnel.updatedAt = ''
  document.analytics = emptyAnalytics(document.funnel.version)
  return document
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
