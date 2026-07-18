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
}

const clone = (document: FunnelDocument) => structuredClone(document)
const HISTORY_LIMIT = 50

export const useEditorStore = create<EditorState>((set, get) => ({
  document: null,
  selectedNodeId: null,
  selectedEdgeId: null,
  dirty: false,
  savedAt: null,
  past: [],
  future: [],
  transactionBase: null,
  analyticsOverlay: false,

  setDocument: (document) => set({ document: clone(document), selectedNodeId: null, selectedEdgeId: null, dirty: false, savedAt: document.funnel.updatedAt, past: [], future: [], transactionBase: null }),

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
    const node = createNode(type, position)
    get().updateDocument((draft) => { draft.nodes.push(node) })
    set({ selectedNodeId: node.id, selectedEdgeId: null })
    return node.id
  },

  deleteNode: (nodeId) => {
    const document = get().document
    const node = document?.nodes.find((candidate) => candidate.id === nodeId)
    if (!document || !node || node.type === 'start') return false
    get().updateDocument((draft) => {
      draft.nodes = draft.nodes.filter((candidate) => candidate.id !== nodeId)
      draft.edges = draft.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)
    })
    set({ selectedNodeId: null })
    return true
  },

  selectNode: (nodeId) => set({ selectedNodeId: nodeId, selectedEdgeId: null }),
  selectEdge: (edgeId) => set({ selectedEdgeId: edgeId, selectedNodeId: null }),

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
      if (node) node.position = position
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
    set({ document: clone(previous), past: past.slice(0, -1), future: [clone(document), ...future].slice(0, HISTORY_LIMIT), selectedNodeId: null, selectedEdgeId: null, dirty: true })
  },

  redo: () => {
    const { document, past, future } = get()
    if (!document || !future.length) return
    const next = future[0]
    set({ document: clone(next), past: [...past, clone(document)].slice(-HISTORY_LIMIT), future: future.slice(1), selectedNodeId: null, selectedEdgeId: null, dirty: true })
  },

  markSaved: () => set({ dirty: false, savedAt: new Date().toISOString() }),
  toggleAnalyticsOverlay: () => set((state) => ({ analyticsOverlay: !state.analyticsOverlay })),
}))
