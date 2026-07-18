import { create } from 'zustand'
import { edgeLabel, newId, syncAssets } from '../model/funnel'
import type { FunnelDocument, FunnelEdge, FunnelNode, NodeType } from '../model/types'
import { createNode } from '../model/funnel'

interface ConnectionInput {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

interface EditorState {
  document: FunnelDocument | null
  selectedNodeId: string | null
  selectedNodeIds: string[]
  selectedEdgeId: string | null
  dirty: boolean
  savedAt: string | null
  past: FunnelDocument[]
  future: FunnelDocument[]
  transactionBase: FunnelDocument | null
  analyticsOverlay: boolean
  setDocument: (document: FunnelDocument) => void
  updateDocument: (update: (draft: FunnelDocument) => void) => void
  updateNode: (nodeId: string, update: (node: FunnelNode) => void) => void
  addNode: (type: NodeType, position: { x: number; y: number }) => string | null
  deleteNode: (nodeId: string) => boolean
  selectNode: (nodeId: string | null) => void
  selectNodes: (nodeIds: string[]) => void
  selectEdge: (edgeId: string | null) => void
  connect: (connection: ConnectionInput) => void
  deleteEdge: (edgeId: string) => void
  beginTransaction: () => void
  applyNodePositions: (positions: Array<{ id: string; position: { x: number; y: number } }>) => void
  endTransaction: () => void
  undo: () => void
  redo: () => void
  markSaved: () => void
  toggleAnalyticsOverlay: () => void
  duplicateSelected: () => void
  copySelected: () => void
  pasteCopied: () => void
  alignSelected: (mode: 'left' | 'top' | 'horizontal' | 'vertical') => void
  autoLayout: () => void
  toggleSelectedCollapse: () => void
}

const clone = <T,>(value: T): T => structuredClone(value)
const HISTORY_LIMIT = 50
let clipboard: { nodes: FunnelNode[]; edges: FunnelEdge[]; positions: Record<string, { x: number; y: number }> } | null = null

export const useEditorStore = create<EditorState>((set, get) => ({
  document: null,
  selectedNodeId: null,
  selectedNodeIds: [],
  selectedEdgeId: null,
  dirty: false,
  savedAt: null,
  past: [],
  future: [],
  transactionBase: null,
  analyticsOverlay: false,

  setDocument: (document) => set({ document: clone(document), selectedNodeId: null, selectedNodeIds: [], selectedEdgeId: null, dirty: false, savedAt: document.funnel.updatedAt, past: [], future: [], transactionBase: null }),

  updateDocument: (update) => {
    const current = get().document
    if (!current) return
    const next = clone(current)
    update(next)
    next.funnel.updatedAt = new Date().toISOString()
    set({ document: syncAssets(next), past: [...get().past, clone(current)].slice(-HISTORY_LIMIT), future: [], dirty: true })
  },

  updateNode: (nodeId, update) => get().updateDocument((draft) => {
    const node = draft.nodes.find((candidate) => candidate.id === nodeId)
    if (node) update(node)
  }),

  addNode: (type, position) => {
    const document = get().document
    if (!document || (type === 'start' && document.nodes.some((node) => node.type === 'start'))) return null
    const node = createNode(type)
    get().updateDocument((draft) => {
      draft.nodes.push(node)
      draft.editor.nodePositions[node.id] = position
    })
    set({ selectedNodeId: node.id, selectedNodeIds: [node.id], selectedEdgeId: null })
    return node.id
  },

  deleteNode: (nodeId) => {
    const document = get().document
    const node = document?.nodes.find((candidate) => candidate.id === nodeId)
    if (!document || !node || node.type === 'start') return false
    get().updateDocument((draft) => {
      draft.nodes = draft.nodes.filter((candidate) => candidate.id !== nodeId)
      draft.edges = draft.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)
      delete draft.editor.nodePositions[nodeId]
      draft.editor.groups = draft.editor.groups.map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => id !== nodeId) }))
    })
    set({ selectedNodeId: null, selectedNodeIds: [] })
    return true
  },

  selectNode: (nodeId) => set({ selectedNodeId: nodeId, selectedNodeIds: nodeId ? [nodeId] : [], selectedEdgeId: null }),
  selectNodes: (nodeIds) => set({ selectedNodeIds: nodeIds, selectedNodeId: nodeIds.at(-1) ?? null, selectedEdgeId: null }),
  selectEdge: (edgeId) => set({ selectedEdgeId: edgeId, selectedNodeId: null, selectedNodeIds: [] }),

  connect: (connection) => {
    const document = get().document
    if (!document) return
    const sourceNode = document.nodes.find((node) => node.id === connection.source)
    if (!sourceNode || sourceNode.type === 'end' || connection.source === connection.target) return
    const sourceHandle = connection.sourceHandle ?? 'next'
    get().updateDocument((draft) => {
      draft.edges = draft.edges.filter((edge) => !(edge.source === connection.source && (edge.sourceHandle ?? 'next') === sourceHandle))
      const edge: FunnelEdge = {
        id: newId('edge'),
        source: connection.source,
        target: connection.target,
        sourceHandle,
        targetHandle: connection.targetHandle,
        label: edgeLabel(draft, connection.source, sourceHandle),
      }
      draft.edges.push(edge)
    })
  },

  deleteEdge: (edgeId) => {
    get().updateDocument((draft) => { draft.edges = draft.edges.filter((edge) => edge.id !== edgeId) })
    set({ selectedEdgeId: null })
  },

  beginTransaction: () => {
    const document = get().document
    if (document && !get().transactionBase) set({ transactionBase: clone(document) })
  },

  applyNodePositions: (positions) => {
    const document = get().document
    if (!document) return
    const next = clone(document)
    positions.forEach(({ id, position }) => {
      const node = next.nodes.find((candidate) => candidate.id === id)
      if (node) next.editor.nodePositions[id] = position
    })
    next.funnel.updatedAt = new Date().toISOString()
    set({ document: next, dirty: true })
  },

  endTransaction: () => {
    const base = get().transactionBase
    if (!base) return
    set({ past: [...get().past, base].slice(-HISTORY_LIMIT), future: [], transactionBase: null, dirty: true })
  },

  undo: () => {
    const { document, past, future } = get()
    if (!document || !past.length) return
    const previous = past[past.length - 1]
    set({ document: clone(previous), past: past.slice(0, -1), future: [clone(document), ...future].slice(0, HISTORY_LIMIT), selectedNodeId: null, selectedNodeIds: [], selectedEdgeId: null, dirty: true })
  },

  redo: () => {
    const { document, past, future } = get()
    if (!document || !future.length) return
    const next = future[0]
    set({ document: clone(next), past: [...past, clone(document)].slice(-HISTORY_LIMIT), future: future.slice(1), selectedNodeId: null, selectedNodeIds: [], selectedEdgeId: null, dirty: true })
  },

  markSaved: () => set({ dirty: false, savedAt: new Date().toISOString() }),
  toggleAnalyticsOverlay: () => set((state) => ({ analyticsOverlay: !state.analyticsOverlay })),

  copySelected: () => {
    const document = get().document
    const ids = new Set(get().selectedNodeIds)
    if (!document || !ids.size) return
    clipboard = {
      nodes: clone(document.nodes.filter((node) => ids.has(node.id))),
      edges: clone(document.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target))),
      positions: Object.fromEntries([...ids].map((id) => [id, document.editor.nodePositions[id] ?? { x: 0, y: 0 }])),
    }
  },

  pasteCopied: () => {
    if (!clipboard || !get().document) return
    const idMap = new Map<string, string>()
    const innerIdMap = new Map<string, string>()
    const nodes = clipboard.nodes.filter((node) => node.type !== 'start').map((node) => {
      const id = newId(node.type); idMap.set(node.id, id)
      return { ...clone(node), id, data: freshNestedIds(node.data, innerIdMap) as FunnelNode['data'] }
    })
    if (!nodes.length) return
    const edges = clipboard.edges.filter((edge) => idMap.has(edge.source) && idMap.has(edge.target)).map((edge) => ({ ...clone(edge), id: newId('edge'), source: idMap.get(edge.source)!, target: idMap.get(edge.target)!, sourceHandle: edge.sourceHandle ? innerIdMap.get(edge.sourceHandle) ?? edge.sourceHandle : edge.sourceHandle }))
    get().updateDocument((draft) => {
      draft.nodes.push(...nodes); draft.edges.push(...edges)
      clipboard!.nodes.forEach((source) => { const id = idMap.get(source.id); if (id) { const position = clipboard!.positions[source.id] ?? { x: 0, y: 0 }; draft.editor.nodePositions[id] = { x: position.x + 40, y: position.y + 40 } } })
    })
    const ids = nodes.map((node) => node.id); set({ selectedNodeIds: ids, selectedNodeId: ids.at(-1) ?? null })
  },

  duplicateSelected: () => { get().copySelected(); get().pasteCopied() },

  alignSelected: (mode) => {
    const document = get().document; const ids = get().selectedNodeIds
    if (!document || ids.length < 2) return
    const positions = ids.map((id) => ({ id, position: document.editor.nodePositions[id] ?? { x: 0, y: 0 } }))
    get().updateDocument((draft) => {
      if (mode === 'left') { const x = Math.min(...positions.map((item) => item.position.x)); positions.forEach((item) => { draft.editor.nodePositions[item.id] = { ...item.position, x } }) }
      if (mode === 'top') { const y = Math.min(...positions.map((item) => item.position.y)); positions.forEach((item) => { draft.editor.nodePositions[item.id] = { ...item.position, y } }) }
      if (mode === 'horizontal') { const sorted = [...positions].sort((a, b) => a.position.x - b.position.x); const min = sorted[0].position.x; const max = sorted.at(-1)!.position.x; sorted.forEach((item, index) => { draft.editor.nodePositions[item.id] = { ...item.position, x: min + (max - min) * index / Math.max(1, sorted.length - 1) } }) }
      if (mode === 'vertical') { const sorted = [...positions].sort((a, b) => a.position.y - b.position.y); const min = sorted[0].position.y; const max = sorted.at(-1)!.position.y; sorted.forEach((item, index) => { draft.editor.nodePositions[item.id] = { ...item.position, y: min + (max - min) * index / Math.max(1, sorted.length - 1) } }) }
    })
  },

  autoLayout: () => {
    const document = get().document
    if (!document) return
    const levels = new Map<string, number>([[document.funnel.startNodeId, 0]])
    const queue = [document.funnel.startNodeId]
    while (queue.length) { const source = queue.shift()!; const level = levels.get(source) ?? 0; document.edges.filter((edge) => edge.source === source).forEach((edge) => { if (!levels.has(edge.target)) { levels.set(edge.target, level + 1); queue.push(edge.target) } }) }
    document.nodes.forEach((node) => { if (!levels.has(node.id)) levels.set(node.id, Math.max(0, ...levels.values()) + 1) })
    const buckets = new Map<number, string[]>()
    document.nodes.forEach((node) => { const level = levels.get(node.id) ?? 0; buckets.set(level, [...(buckets.get(level) ?? []), node.id]) })
    get().updateDocument((draft) => { [...buckets.entries()].forEach(([level, ids]) => ids.forEach((id, index) => { draft.editor.nodePositions[id] = { x: 80 + level * 285, y: 70 + index * 155 } })) })
  },

  toggleSelectedCollapse: () => {
    const document = get().document; const ids = get().selectedNodeIds
    if (!document || !ids.length) return
    const allCollapsed = ids.every((id) => document.editor.collapsedNodeIds.includes(id))
    get().updateDocument((draft) => { draft.editor.collapsedNodeIds = allCollapsed ? draft.editor.collapsedNodeIds.filter((id) => !ids.includes(id)) : Array.from(new Set([...draft.editor.collapsedNodeIds, ...ids])) })
  },
}))

function freshNestedIds(value: unknown, idMap: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => freshNestedIds(item, idMap))
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
    if (key === 'id' && typeof child === 'string') { const id = newId(child.split('_')[0] || 'item'); idMap.set(child, id); result[key] = id }
    else result[key] = freshNestedIds(child, idMap)
  })
  return result
}
