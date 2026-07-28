import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
} from '@xyflow/react'
import {
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  BarChart3,
  Beaker,
  Bot,
  CheckCircle2,
  Copy,
  Download,
  Ellipsis,
  Eye,
  FileImage,
  GitBranch,
  LayoutGrid,
  Menu,
  Package,
  PanelRight,
  Redo2,
  Search,
  Undo2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyticsForNode, createNewVersion, edgeLabel, nodePosition } from '../model/funnel'
import type { FunnelDocument, NodeType, ValidationIssue, WorkspaceSection } from '../model/types'
import { validateFunnel } from '../model/validation'
import { downloadFunnel, importFunnelFile } from '../services/files'
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
  onWorkspace: (section: WorkspaceSection) => void
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
  const setDocument = useEditorStore((state) => state.setDocument)
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
  const { screenToFlowPosition, fitView, setCenter } = useReactFlow()
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null)
  const [preview, setPreview] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [mobilePanel, setMobilePanel] = useState<'library' | 'properties' | null>(null)
  const [nodeSearch, setNodeSearch] = useState('')
  const [selectionArmed, setSelectionArmed] = useState(false)
  const canvasRef = useRef<HTMLDivElement>(null)

  const nodes: FunnelCanvasNode[] = useMemo(() => document.nodes.map((node) => ({
    id: node.id,
    type: 'funnel',
    position: nodePosition(document, node.id),
    selected: selectedNodeIds.includes(node.id),
    data: {
      source: node,
      document,
      collapsed: document.editor.collapsedNodeIds.includes(node.id),
      analytics: analyticsOverlay && document.analytics.snapshotAt ? analyticsForNode(document, node.id) : undefined,
    },
  })), [document, selectedNodeIds, analyticsOverlay])
  const highlightedEdges = useMemo(() => pathEdges(document, selectedNodeId), [document, selectedNodeId])
  const edges: Edge[] = useMemo(() => document.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    label: edgeLabel(document, edge.source, edge.sourceHandle) ?? edge.label,
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
    addNode(type, screenToFlowPosition({ x: event.clientX, y: event.clientY }))
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
    const node = document.nodes.find((candidate) => candidate.data.title.toLowerCase().includes(value))
    if (!node) return
    selectNode(node.id)
    const position = nodePosition(document, node.id)
    setCenter(position.x + 100, position.y + 40, { zoom: 1, duration: 350 })
  }
  const check = () => setIssues(validateFunnel(document))
  const exportCurrent = () => {
    const found = validateFunnel(document)
    if (found.some((issue) => issue.severity === 'error')) { setIssues(found); return }
    downloadFunnel(document)
  }
  const createVersion = async () => {
    setMoreOpen(false)
    if (!confirm(`Создать версию ${document.funnel.version + 1}? Статистика новой версии будет пустой, текущая версия не изменится.`)) return
    const next = createNewVersion(document, 'Создана в упрощённом конструкторе')
    await onSave(next)
    setDocument(next)
  }
  const importAnother = async (file?: File) => {
    setMoreOpen(false)
    if (!file) return
    const result = await importFunnelFile(file)
    if (!result.success) { alert(result.errors.join('\n')); return }
    if (!confirm(`Открыть импортированную воронку «${result.document.funnel.name}»? Текущий черновик останется в локальном хранилище.`)) return
    setDocument(result.document)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo() }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c' && selectedNodeIds.length) { event.preventDefault(); copySelected() }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteCopied() }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd' && selectedNodeIds.length) { event.preventDefault(); duplicateSelected() }
      if (event.key === 'Escape') setSelectionArmed(false)
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEdgeId) { event.preventDefault(); deleteEdge(selectedEdgeId) }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedNodeIds.length) {
        const removable = document.nodes.filter((candidate) => selectedNodeIds.includes(candidate.id) && candidate.type !== 'start')
        const connections = document.edges.filter((edge) => selectedNodeIds.includes(edge.source) || selectedNodeIds.includes(edge.target)).length
        if (removable.length && confirm(`Удалить ${removable.length} этапов и ${connections} связанных стрелок?`)) removable.forEach((node) => deleteNode(node.id))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [copySelected, deleteEdge, deleteNode, document.edges, document.nodes, duplicateSelected, pasteCopied, redo, selectedEdgeId, selectedNodeIds, undo])

  return <div className="editor-page">
    <header className="app-header editor-header simplified-header">
      <button className="brand-button compact" onClick={onBack}><span className="brand-mark">В</span><span><strong>Воронка</strong><small>К моим воронкам</small></span></button>
      <div className="funnel-name-field"><input value={document.funnel.name} onChange={(event) => updateDocument((draft) => { draft.funnel.name = event.target.value; draft.project.name = event.target.value; draft.bot.displayName = event.target.value })} aria-label="Название воронки" /><span>Версия {document.funnel.version} · <i className={dirty ? 'dirty' : ''}>{dirty ? 'Сохраняем…' : savedAt ? 'Все изменения сохранены' : 'Черновик'}</i></span></div>
      <nav className="editor-main-nav">
        <button className="active"><GitBranch size={15} /> Схема</button>
        <button onClick={() => onWorkspace('tests')}><Beaker size={15} /> Тесты</button>
        <button onClick={() => onWorkspace('media')}><FileImage size={15} /> Медиа</button>
        <button onClick={() => onWorkspace('products')}><Package size={15} /> Продукты</button>
        <button onClick={() => onWorkspace('bot')}><Bot size={15} /> Бот</button>
        <button onClick={onAnalytics}><BarChart3 size={15} /> Статистика</button>
      </nav>
      <div className="header-spacer" />
      <button className="header-action mobile-only" aria-label="Блоки" onClick={() => setMobilePanel('library')}><Menu size={18} /><span>Блоки</span></button>
      <button className="header-action mobile-only" aria-label="Настройки этапа" onClick={() => setMobilePanel('properties')}><PanelRight size={18} /><span>Настройки</span></button>
      <button className="header-action" onClick={check}><CheckCircle2 size={18} /><span>Проверить</span></button>
      <button className="header-action" onClick={() => setPreview(true)}><Eye size={18} /><span>Предпросмотр</span></button>
      <button className="button primary export-button" aria-label="Скачать файл для бота" onClick={exportCurrent}><Download size={17} /><span>Скачать файл для бота</span></button>
      <div className="export-menu-wrap"><button className="icon-button bordered" onClick={() => setMoreOpen(!moreOpen)} aria-label="Ещё"><Ellipsis size={19} /></button>{moreOpen && <div className="export-menu more-menu"><button onClick={createVersion}><Copy size={16} /><span><strong>Создать новую версию</strong><small>Со статистикой с нуля</small></span></button><button onClick={() => { setMoreOpen(false); downloadFunnel(document, `backup-v${document.funnel.version}`) }}><Download size={16} /><span><strong>Резервная копия</strong><small>Текущая версия целиком</small></span></button><label><FileImage size={16} /><span><strong>Импортировать другой файл</strong><small>Только упрощённый формат 2.0</small></span><input type="file" accept=".funnel,.json" hidden onChange={(event) => importAnother(event.target.files?.[0])} /></label><button onClick={() => { setMoreOpen(false); alert(`Формат файла: ${document.schemaVersion}\nВерсия воронки: ${document.funnel.version}\nБлоков: ${document.nodes.length}\nСвязей: ${document.edges.length}`) }}><CheckCircle2 size={16} /><span><strong>Сведения о файле</strong><small>Версия формата и состав</small></span></button></div>}</div>
    </header>
    <div className="editor-layout">
      <BlockLibrary onAdd={addAtCenter} hasStart={document.nodes.some((node) => node.type === 'start')} />
      <main className="canvas-wrap" ref={canvasRef} onDrop={onDrop} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}>
        <ReactFlow<FunnelCanvasNode, Edge> className={`canvas-flow${selectionArmed ? ' canvas-selection-ready' : ''}`} nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onNodeClick={(event, node) => { setSelectionArmed(false); if (event.metaKey || event.ctrlKey || event.shiftKey) selectNodes(selectedNodeIds.includes(node.id) ? selectedNodeIds.filter((id) => id !== node.id) : [...selectedNodeIds, node.id]); else selectNode(node.id) }} onEdgeClick={(_, edge) => { setSelectionArmed(false); selectEdge(edge.id) }} onPaneClick={() => { selectNode(null); selectEdge(null); setSelectionArmed((armed) => !armed) }} onSelectionEnd={() => setSelectionArmed(false)} onConnect={(connection: Connection) => connection.source && connection.target && connect(connection as Connection & { source: string; target: string })} onNodeDragStart={() => { setSelectionArmed(false); beginTransaction() }} onNodeDragStop={endTransaction} defaultViewport={{ x: 35, y: 50, zoom: .72 }} minZoom={.18} maxZoom={1.7} deleteKeyCode={null} snapToGrid snapGrid={[16, 16]} selectionKeyCode={null} selectionOnDrag={selectionArmed} panOnDrag={selectionArmed ? [1, 2] : true} nodesDraggable nodesConnectable elementsSelectable multiSelectionKeyCode={['Meta', 'Control', 'Shift']} proOptions={{ hideAttribution: true }}>
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#d8dde8" />
          <Controls position="bottom-left" showInteractive={false} />
          <div className="canvas-floating-actions"><button onClick={() => fitView({ padding: .25, duration: 350 })}>Вписать схему</button><button onClick={() => { autoLayout(); window.setTimeout(() => fitView({ padding: .2, duration: 350 }), 30) }}><LayoutGrid size={14} /> Упорядочить</button>{document.analytics.snapshotAt && <button className={analyticsOverlay ? 'active' : ''} onClick={toggleAnalyticsOverlay}><BarChart3 size={14} /> Показатели</button>}</div>
          <div className="canvas-search"><Search size={14} /><input value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && findNode()} placeholder="Найти этап по названию" /><button onClick={findNode}>Найти</button></div>
          {selectedNodeIds.length > 1 && <div className="selection-toolbar"><span>{selectedNodeIds.length} выбрано</span><button onClick={duplicateSelected}><Copy size={14} /></button><button onClick={() => alignSelected('left')}><AlignStartVertical size={14} /></button><button onClick={() => alignSelected('top')}><AlignStartHorizontal size={14} /></button><button onClick={() => alignSelected('horizontal')}><AlignHorizontalSpaceAround size={14} /></button><button onClick={() => alignSelected('vertical')}><AlignVerticalSpaceAround size={14} /></button></div>}
        </ReactFlow>
      </main>
      <PropertiesPanel document={document} />
    </div>
    {mobilePanel && <div className="mobile-drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setMobilePanel(null)}>{mobilePanel === 'library' ? <BlockLibrary className="mobile-drawer" onAdd={addAtCenter} hasStart={document.nodes.some((node) => node.type === 'start')} /> : <div className="mobile-drawer"><PropertiesPanel document={document} onCloseMobile={() => setMobilePanel(null)} /></div>}</div>}
    {issues && <ValidationDialog issues={issues} onClose={() => setIssues(null)} onSelectIssue={(issue) => { if (issue.nodeId) { selectNode(issue.nodeId); const item = document.nodes.find((candidate) => candidate.id === issue.nodeId); if (item) { const position = nodePosition(document, item.id); setCenter(position.x, position.y, { zoom: 1, duration: 350 }) } } setIssues(null) }} />}
    {preview && <Preview document={document} onClose={() => setPreview(false)} />}
  </div>
}

function pathEdges(document: FunnelDocument, targetId: string | null) {
  const highlighted = new Set<string>()
  if (!targetId) return highlighted
  document.edges.filter((edge) => edge.source === targetId).forEach((edge) => highlighted.add(edge.id))
  const queue = [document.funnel.startNodeId]
  const visited = new Set(queue)
  const previous = new Map<string, { nodeId: string; edgeId: string }>()
  while (queue.length) {
    const source = queue.shift()!
    document.edges.filter((edge) => edge.source === source).forEach((edge) => {
      if (!visited.has(edge.target)) { visited.add(edge.target); previous.set(edge.target, { nodeId: source, edgeId: edge.id }); queue.push(edge.target) }
    })
  }
  let cursor = targetId
  while (previous.has(cursor)) { const item = previous.get(cursor)!; highlighted.add(item.edgeId); cursor = item.nodeId }
  return highlighted
}
