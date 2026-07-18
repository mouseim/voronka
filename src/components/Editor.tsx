import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
} from '@xyflow/react'
import { AlignHorizontalSpaceAround, AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceAround, BarChart3, CheckCircle2, ChevronDown, ChevronsUp, Copy, Download, Eye, LayoutGrid, Menu, PanelRight, Redo2, Save, Search, Settings2, Undo2, WandSparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createNewVersion, edgeLabel, analyticsForNode, nodePosition } from '../model/funnel'
import type { FunnelDocument, NodeType, ValidationIssue } from '../model/types'
import { validateFunnel } from '../model/validation'
import { downloadFunnel } from '../services/files'
import { useEditorStore } from '../store/editor'
import { BlockLibrary } from './BlockLibrary'
import { FunnelNodeCard, type FunnelCanvasNode } from './FunnelNodeCard'
import { Preview } from './Preview'
import { PropertiesPanel } from './PropertiesPanel'
import { ValidationDialog } from './ValidationDialog'

interface EditorProps {
  document: FunnelDocument
  onBack: () => void
  onAnalytics: () => void
  onWorkspace: (section: 'variables' | 'tests' | 'media' | 'products' | 'settings' | 'validation' | 'compare' | 'history') => void
  onSave: (document: FunnelDocument) => Promise<void>
}

const nodeTypes = { funnel: FunnelNodeCard }

export function Editor(props: EditorProps) {
  return <ReactFlowProvider><EditorCanvas {...props} /></ReactFlowProvider>
}

function EditorCanvas({ document, onBack, onAnalytics, onWorkspace, onSave }: EditorProps) {
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId)
  const selectedNodeIds = useEditorStore((state) => state.selectedNodeIds)
  const selectedEdgeId = useEditorStore((state) => state.selectedEdgeId)
  const dirty = useEditorStore((state) => state.dirty)
  const savedAt = useEditorStore((state) => state.savedAt)
  const past = useEditorStore((state) => state.past)
  const future = useEditorStore((state) => state.future)
  const analyticsOverlay = useEditorStore((state) => state.analyticsOverlay)
  const updateDocument = useEditorStore((state) => state.updateDocument)
  const addNode = useEditorStore((state) => state.addNode)
  const deleteNode = useEditorStore((state) => state.deleteNode)
  const selectNode = useEditorStore((state) => state.selectNode)
  const selectNodes = useEditorStore((state) => state.selectNodes)
  const selectEdge = useEditorStore((state) => state.selectEdge)
  const connect = useEditorStore((state) => state.connect)
  const deleteEdge = useEditorStore((state) => state.deleteEdge)
  const beginTransaction = useEditorStore((state) => state.beginTransaction)
  const applyNodePositions = useEditorStore((state) => state.applyNodePositions)
  const endTransaction = useEditorStore((state) => state.endTransaction)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const toggleAnalyticsOverlay = useEditorStore((state) => state.toggleAnalyticsOverlay)
  const duplicateSelected = useEditorStore((state) => state.duplicateSelected)
  const copySelected = useEditorStore((state) => state.copySelected)
  const pasteCopied = useEditorStore((state) => state.pasteCopied)
  const alignSelected = useEditorStore((state) => state.alignSelected)
  const autoLayout = useEditorStore((state) => state.autoLayout)
  const toggleSelectedCollapse = useEditorStore((state) => state.toggleSelectedCollapse)
  const { screenToFlowPosition, fitView, setCenter } = useReactFlow()
  const [rightTab, setRightTab] = useState<'properties' | 'media'>('properties')
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null)
  const [preview, setPreview] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [mobilePanel, setMobilePanel] = useState<'library' | 'properties' | null>(null)
  const [nodeSearch, setNodeSearch] = useState('')
  const canvasRef = useRef<HTMLDivElement>(null)

  const nodes: FunnelCanvasNode[] = useMemo(() => document.nodes.map((node) => ({
    id: node.id,
    type: 'funnel',
    position: nodePosition(document, node.id),
    selected: selectedNodeIds.includes(node.id),
    data: { source: node, collapsed: document.editor.collapsedNodeIds.includes(node.id), analytics: analyticsOverlay && document.analytics.snapshotAt ? analyticsForNode(document, node.id) : undefined },
  })), [document, selectedNodeIds, analyticsOverlay])

  const highlightedEdges = useMemo(() => pathEdges(document, selectedNodeId), [document, selectedNodeId])

  const edges: Edge[] = useMemo(() => document.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    label: edge.label ?? edgeLabel(document, edge.source, edge.sourceHandle),
    selected: edge.id === selectedEdgeId,
    markerEnd: { type: MarkerType.ArrowClosed, width: 17, height: 17, color: edge.id === selectedEdgeId || highlightedEdges.has(edge.id) ? '#4969e8' : '#9aa5b5' },
    style: { stroke: edge.id === selectedEdgeId || highlightedEdges.has(edge.id) ? '#4969e8' : '#9aa5b5', strokeWidth: edge.id === selectedEdgeId || highlightedEdges.has(edge.id) ? 2.2 : 1.7 },
    labelStyle: { fill: '#5e6673', fontSize: 11, fontWeight: 600 },
    labelBgStyle: { fill: '#fff', fillOpacity: .92 },
    labelBgPadding: [5, 3] as [number, number],
    labelBgBorderRadius: 5,
  })), [document, highlightedEdges, selectedEdgeId])

  const addAtCenter = (type: NodeType) => {
    const bounds = canvasRef.current?.getBoundingClientRect()
    const point = screenToFlowPosition({ x: (bounds?.left ?? 0) + (bounds?.width ?? 700) / 2, y: (bounds?.top ?? 0) + (bounds?.height ?? 500) / 2 })
    addNode(type, { x: point.x - 100, y: point.y - 45 })
    setMobilePanel(null)
  }

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    const type = event.dataTransfer.getData('application/funnel-node') as NodeType
    if (!type) return
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    addNode(type, position)
  }, [addNode, screenToFlowPosition])

  const onNodesChange = useCallback((changes: NodeChange<FunnelCanvasNode>[]) => {
    const moved = changes.filter((change): change is Extract<NodeChange<FunnelCanvasNode>, { type: 'position' }> => change.type === 'position' && Boolean(change.position)).map((change) => ({ id: change.id, position: change.position! }))
    if (moved.length) applyNodePositions(moved)
    const selectionChanges = changes.filter((change): change is Extract<NodeChange<FunnelCanvasNode>, { type: 'select' }> => change.type === 'select')
    if (selectionChanges.length) {
      const next = new Set(selectedNodeIds)
      selectionChanges.forEach((change) => { if (change.selected) next.add(change.id); else next.delete(change.id) })
      selectNodes([...next])
    }
  }, [applyNodePositions, selectNodes, selectedNodeIds])

  const findNode = () => {
    const value = nodeSearch.trim().toLowerCase()
    if (!value) return
    const node = document.nodes.find((candidate) => candidate.id.toLowerCase().includes(value) || String(candidate.data.title).toLowerCase().includes(value))
    if (!node) return
    selectNode(node.id); const position = nodePosition(document, node.id); setCenter(position.x + 100, position.y + 40, { zoom: 1, duration: 350 })
  }

  const runValidation = () => setIssues(validateFunnel(document))
  const canExport = () => {
    const result = validateFunnel(document)
    if (result.some((issue) => issue.severity === 'error')) { setIssues(result); return false }
    return true
  }
  const exportCurrent = () => { setExportOpen(false); if (canExport()) downloadFunnel(document) }
  const exportNewVersion = () => {
    setExportOpen(false)
    const next = createNewVersion(document)
    if (!canExport()) return
    if (window.confirm(`Будет создана версия ${next.funnel.version}. Статистика новой версии начнётся с нуля. Исходный файл версии ${document.funnel.version} не изменится.`)) downloadFunnel(next)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo(); else undo()
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c' && selectedNodeIds.length) { event.preventDefault(); copySelected() }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteCopied() }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd' && selectedNodeIds.length) { event.preventDefault(); duplicateSelected() }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEdgeId) { event.preventDefault(); deleteEdge(selectedEdgeId) }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedNodeIds.length) {
        const removable = document.nodes.filter((candidate) => selectedNodeIds.includes(candidate.id) && candidate.type !== 'start')
        const connections = document.edges.filter((edge) => selectedNodeIds.includes(edge.source) || selectedNodeIds.includes(edge.target)).length
        if (removable.length && window.confirm(`Удалить ${removable.length} блоков и ${connections} связанных переходов?`)) removable.forEach((node) => deleteNode(node.id))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [copySelected, deleteEdge, deleteNode, document.edges, document.nodes, duplicateSelected, pasteCopied, redo, selectedEdgeId, selectedNodeIds, undo])

  return (
    <div className="editor-page">
      <header className="app-header editor-header">
        <button className="brand-button compact" onClick={onBack}><span className="brand-mark">В</span><span><strong>Воронка</strong><small>конструктор</small></span></button>
        <div className="header-divider" />
        <div className="funnel-name-field"><input value={document.funnel.name} onChange={(event) => updateDocument((draft) => { draft.funnel.name = event.target.value; draft.project.name = event.target.value })} aria-label="Название воронки" /><span>Версия {document.funnel.version} · <i className={dirty ? 'dirty' : ''}>{dirty ? 'Есть изменения' : savedAt ? 'Сохранено' : 'Черновик'}</i></span></div>
        <div className="header-spacer" />
        <button className="header-action mobile-only" onClick={() => setMobilePanel('library')} aria-label="Блоки"><Menu size={18} /><span>Блоки</span></button>
        <button className="header-action mobile-only" onClick={() => setMobilePanel('properties')} aria-label="Свойства"><PanelRight size={18} /><span>Свойства</span></button>
        <button className="header-action" onClick={undo} disabled={!past.length} title="Отменить (⌘Z)"><Undo2 size={18} /><span className="desktop-action-label">Отменить</span></button>
        <button className="header-action icon-only-action" onClick={redo} disabled={!future.length} title="Повторить (⇧⌘Z)" aria-label="Повторить"><Redo2 size={18} /></button>
        <button className="header-action" onClick={() => onSave(document)} aria-label="Сохранить"><Save size={18} /><span className="desktop-action-label">Сохранить</span></button>
        <button className="header-action" onClick={runValidation} aria-label="Проверить"><CheckCircle2 size={18} /><span className="desktop-action-label">Проверить</span></button>
        <button className="header-action" onClick={() => onWorkspace('variables')} aria-label="Разделы проекта"><Settings2 size={18} /><span className="desktop-action-label">Разделы</span></button>
        <button className="header-action" onClick={() => setPreview(true)} aria-label="Предпросмотр"><Eye size={18} /><span className="desktop-action-label">Предпросмотр</span></button>
        <button className="header-action analytics-action" onClick={onAnalytics} aria-label="Статистика"><BarChart3 size={18} /><span className="desktop-action-label">Статистика</span></button>
        <div className="export-menu-wrap">
          <button className="button primary export-button" onClick={() => setExportOpen(!exportOpen)} aria-label="Экспорт"><Download size={17} /><span>Экспорт</span><ChevronDown size={14} /></button>
          {exportOpen && <div className="export-menu"><button onClick={exportCurrent}><Download size={17} /><span><strong>Текущая версия</strong><small>Версия {document.funnel.version}, статистика сохранится</small></span></button><button onClick={exportNewVersion}><WandSparkles size={17} /><span><strong>Как новая версия</strong><small>Версия {document.funnel.version + 1}, статистика с нуля</small></span></button></div>}
        </div>
      </header>
      <div className="editor-layout">
        <BlockLibrary onAdd={addAtCenter} hasStart={document.nodes.some((node) => node.type === 'start')} />
        <main className="canvas-wrap" ref={canvasRef} onDrop={onDrop} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}>
          <ReactFlow<FunnelCanvasNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={(event, node) => { if (event.metaKey || event.ctrlKey || event.shiftKey) selectNodes(selectedNodeIds.includes(node.id) ? selectedNodeIds.filter((id) => id !== node.id) : [...selectedNodeIds, node.id]); else selectNode(node.id) }}
            onEdgeClick={(_, edge) => selectEdge(edge.id)}
            onPaneClick={() => { selectNode(null); selectEdge(null) }}
            onConnect={(connection: Connection) => connection.source && connection.target && connect(connection as Connection & { source: string; target: string })}
            onNodeDragStart={beginTransaction}
            onNodeDragStop={endTransaction}
            fitView
            fitViewOptions={{ padding: .25, maxZoom: 1 }}
            minZoom={.18}
            maxZoom={1.7}
            deleteKeyCode={null}
            snapToGrid
            snapGrid={[16, 16]}
            selectionOnDrag
            panOnDrag={[1, 2]}
            multiSelectionKeyCode={["Meta", "Control", "Shift"]}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#d8dde8" />
            <Controls position="bottom-left" showInteractive={false} />
            <MiniMap position="bottom-right" pannable zoomable nodeColor="#cbd3e6" maskColor="rgba(248,249,252,.76)" />
            <div className="canvas-floating-actions">
              <button onClick={() => fitView({ padding: .25, duration: 350 })}>Вписать схему</button>
              <button onClick={() => { autoLayout(); window.setTimeout(() => fitView({ padding: .2, duration: 350 }), 30) }} title="Автоматическая раскладка"><LayoutGrid size={14} /> Авто</button>
              {document.analytics.snapshotAt && <button className={analyticsOverlay ? 'active' : ''} onClick={toggleAnalyticsOverlay}><BarChart3 size={14} /> Статистика на схеме</button>}
            </div>
            <div className="canvas-search"><Search size={14} /><input value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && findNode()} placeholder="Блок или ID" /><button onClick={findNode}>Найти</button></div>
            {selectedNodeIds.length > 0 && <div className="selection-toolbar"><span>{selectedNodeIds.length} выбрано</span><button onClick={duplicateSelected} title="Дублировать (⌘D)"><Copy size={14} /></button><button onClick={() => alignSelected('left')} title="По левому краю"><AlignStartVertical size={14} /></button><button onClick={() => alignSelected('top')} title="По верхнему краю"><AlignStartHorizontal size={14} /></button><button onClick={() => alignSelected('horizontal')} title="Распределить по горизонтали"><AlignHorizontalSpaceAround size={14} /></button><button onClick={() => alignSelected('vertical')} title="Распределить по вертикали"><AlignVerticalSpaceAround size={14} /></button><button onClick={toggleSelectedCollapse} title="Свернуть или развернуть"><ChevronsUp size={14} /></button></div>}
          </ReactFlow>
        </main>
        <PropertiesPanel document={document} activeTab={rightTab} onTabChange={setRightTab} />
      </div>
      {mobilePanel && <div className="mobile-drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setMobilePanel(null)}>{mobilePanel === 'library' ? <BlockLibrary className="mobile-drawer" onAdd={addAtCenter} hasStart={document.nodes.some((node) => node.type === 'start')} /> : <div className="mobile-drawer"><PropertiesPanel document={document} activeTab={rightTab} onTabChange={setRightTab} onCloseMobile={() => setMobilePanel(null)} /></div>}</div>}
      {issues && <ValidationDialog issues={issues} onClose={() => setIssues(null)} onSelectIssue={(issue) => { if (issue.nodeId) { selectNode(issue.nodeId); const node = document.nodes.find((candidate) => candidate.id === issue.nodeId); if (node) { const position = nodePosition(document, node.id); setCenter(position.x, position.y, { zoom: 1, duration: 350 }) } } setIssues(null) }} />}
      {preview && <Preview document={document} onClose={() => setPreview(false)} />}
    </div>
  )
}

function pathEdges(document: FunnelDocument, targetId: string | null) {
  const highlighted = new Set<string>()
  if (!targetId) return highlighted
  document.edges.filter((edge) => edge.source === targetId).forEach((edge) => highlighted.add(edge.id))
  if (targetId === document.funnel.startNodeId) return highlighted
  const queue = [document.funnel.startNodeId]
  const visited = new Set(queue)
  const previous = new Map<string, { nodeId: string; edgeId: string }>()
  while (queue.length) {
    const source = queue.shift()!
    for (const edge of document.edges.filter((candidate) => candidate.source === source)) {
      if (visited.has(edge.target)) continue
      visited.add(edge.target); previous.set(edge.target, { nodeId: source, edgeId: edge.id }); queue.push(edge.target)
    }
  }
  let cursor = targetId
  while (previous.has(cursor)) { const item = previous.get(cursor)!; highlighted.add(item.edgeId); cursor = item.nodeId }
  return highlighted
}
