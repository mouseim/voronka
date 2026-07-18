import type { DraftSummary, FunnelDocument } from '../model/types'

const DATABASE_NAME = 'voronka-funnel-builder'
const STORE_NAME = 'drafts'
const DATABASE_VERSION = 1

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, mode)
    const request = run(tx.objectStore(STORE_NAME))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => database.close()
  })
}

export function toDraft(document: FunnelDocument): DraftSummary {
  return {
    id: document.funnel.id,
    name: document.funnel.name,
    version: document.funnel.version,
    updatedAt: document.funnel.updatedAt,
    nodeCount: document.nodes.length,
    document: structuredClone(document),
  }
}

export async function saveDraft(document: FunnelDocument): Promise<DraftSummary> {
  const draft = toDraft(document)
  await transaction('readwrite', (store) => store.put(draft))
  return draft
}

export async function getDrafts(): Promise<DraftSummary[]> {
  const drafts = await transaction<DraftSummary[]>('readonly', (store) => store.getAll())
  return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function deleteDraft(id: string): Promise<void> {
  await transaction('readwrite', (store) => store.delete(id))
}
