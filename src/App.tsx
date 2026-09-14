import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { StartScreen } from './components/StartScreen'
import type { WorkspaceSection } from './components/Workspace'
import { freshDemoFunnel } from './model/demo'
import { createEmptyFunnel, duplicateFunnel } from './model/funnel'
import type { DraftSummary, FunnelDocument } from './model/types'
import { archiveFunnelDrafts, documentsMatchForSync, getDrafts, saveDraft, saveRevision } from './services/drafts'
import { archiveServerFunnel, getServerFunnel, getServerFunnels, integrationConnection, setIntegrationConnection, type ServerFunnelSummary } from './services/integrations'
import { useEditorStore } from './store/editor'

const Editor = lazy(() => import('./components/Editor').then((module) => ({ default: module.Editor })))
const Analytics = lazy(() => import('./components/Analytics').then((module) => ({ default: module.Analytics })))
const Workspace = lazy(() => import('./components/Workspace').then((module) => ({ default: module.Workspace })))

export default function App() {
  const { path, navigate } = useHashRoute()
  const document = useEditorStore((state) => state.document)
  const dirty = useEditorStore((state) => state.dirty)
  const setDocument = useEditorStore((state) => state.setDocument)
  const markSaved = useEditorStore((state) => state.markSaved)
  const [drafts, setDrafts] = useState<DraftSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [serverFunnels, setServerFunnels] = useState<ServerFunnelSummary[]>([])
  const [syncState, setSyncState] = useState<'idle' | 'loading' | 'connected' | 'error'>('idle')
  const [syncMessage, setSyncMessage] = useState('')
  const [conflict, setConflict] = useState<{ local: DraftSummary; server: FunnelDocument } | null>(null)

  const refresh = async () => {
    try { setDrafts(await getDrafts()) } finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [])

  const refreshServer = useCallback(async (): Promise<string | null> => {
    const connection = integrationConnection()
    if (!connection.runtimeUrl || !connection.adminToken) { setSyncState('idle'); setServerFunnels([]); return null }
    setSyncState('loading')
    try {
      const funnels = await getServerFunnels()
      setServerFunnels(funnels)
      setSyncState('connected')
      setSyncMessage('')
      return null
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось загрузить опубликованные воронки.'
      setSyncState('error')
      setSyncMessage(message)
      return message
    }
  }, [])

  useEffect(() => { void refreshServer() }, [refreshServer])

  useEffect(() => {
    const refreshAfterConnection = () => { void refreshServer() }
    window.addEventListener('voronka:connection-changed', refreshAfterConnection)
    return () => window.removeEventListener('voronka:connection-changed', refreshAfterConnection)
  }, [refreshServer])

  useEffect(() => {
    if (!document || !dirty) return
    const timer = window.setTimeout(async () => {
      await saveDraft(document)
      markSaved()
      await refresh()
    }, 900)
    return () => window.clearTimeout(timer)
  }, [document, dirty, markSaved])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])

  const open = (next: FunnelDocument, route = '/editor') => { setDocument(next); navigate(route) }
  const persist = async (next: FunnelDocument) => { await saveDraft(next); if (useEditorStore.getState().document?.funnel.id === next.funnel.id) markSaved(); await refresh() }
  const manualSave = async (next: FunnelDocument) => { await saveRevision(next, 'Ручное сохранение'); await persist(next) }
  const connectRuntime = async (next: { runtimeUrl: string; adminToken: string }) => {
    setIntegrationConnection(next)
    const issue = await refreshServer()
    if (issue) throw new Error(issue)
    if (useEditorStore.getState().document) navigate('/')
  }

  const create = async () => {
    const next = createEmptyFunnel()
    await persist(next)
    open(next)
  }
  const demo = () => open(freshDemoFunnel())
  const duplicate = async (source: FunnelDocument) => { const next = duplicateFunnel(source); await persist(next); open(next) }
  const archive = async (target: { funnelId: string; name: string; onServer: boolean }) => {
    const explanation = target.onServer
      ? 'Она исчезнет из списка, но версии, статистика, платежи и активные прохождения сохранятся.'
      : 'Она исчезнет из списка, но останется в локальном архиве этого браузера.'
    if (!window.confirm(`Удалить воронку «${target.name}»?\n\n${explanation}`)) return
    try {
      if (target.onServer) await archiveServerFunnel(target.funnelId)
      await archiveFunnelDrafts(target.funnelId)
      await Promise.all([refresh(), refreshServer()])
    } catch (error) {
      setSyncState('error')
      setSyncMessage(error instanceof Error ? error.message : 'Не удалось переместить воронку в архив.')
    }
  }
  const importSave = async (source: FunnelDocument) => {
    const collision = drafts.some((draft) => draft.document.funnel.id === source.funnel.id && draft.version === source.funnel.version)
    if (collision && !window.confirm(`Версия ${source.funnel.version} воронки «${source.funnel.name}» уже есть локально. Сохранить импорт как независимую копию?`)) return
    const next = collision ? duplicateFunnel(source) : source
    await persist(next)
  }
  const openServer = async (summary: ServerFunnelSummary) => {
    try {
      const server = await getServerFunnel(summary.id)
      await persist(server)
      open(server)
    } catch (error) {
      setSyncState('error')
      setSyncMessage(error instanceof Error ? error.message : 'Не удалось открыть опубликованную воронку.')
    }
  }
  const openLocal = async (draft: DraftSummary) => {
    const summary = serverFunnels.find((item) => item.id === draft.document.funnel.id)
    if (!summary) { open(draft.document); return }
    try {
      const server = await getServerFunnel(summary.id)
      if (documentsMatchForSync(draft.document, server)) open(draft.document)
      else setConflict({ local: draft, server })
    } catch {
      open(draft.document)
    }
  }
  const loadConflictServer = async () => {
    if (!conflict) return
    await saveRevision(conflict.local.document, 'Резервная копия перед загрузкой опубликованной версии')
    await persist(conflict.server)
    const server = conflict.server
    setConflict(null)
    open(server)
  }

  const homeProps = {
    drafts,
    serverFunnels,
    loading,
    syncState,
    syncMessage,
    onCreate: create,
    onDemo: demo,
    onOpen: (next: FunnelDocument) => open(next),
    onOpenLocal: openLocal,
    onOpenServer: openServer,
    onConnectRuntime: connectRuntime,
    onRefreshServer: refreshServer,
    onImportSave: importSave,
    onDuplicate: duplicate,
    onArchive: archive,
    onAnalytics: (next: FunnelDocument) => open(next, '/analytics'),
  }

  useEffect(() => {
    if (!document && path !== '/') navigate('/', true)
  }, [document, navigate, path])

  const workspaceMatch = path.match(/^\/workspace\/([^/]+)$/)
  const content = path === '/'
    ? <StartScreen {...homeProps} />
    : path === '/editor' && document
      ? <Editor document={document} onBack={() => navigate('/')} onAnalytics={() => navigate('/analytics')} onWorkspace={(section) => navigate(`/workspace/${section}`)} onSave={manualSave} onPublished={refreshServer} />
      : path === '/analytics' && document
        ? <Analytics document={document} onBack={() => navigate('/')} onEdit={() => navigate('/editor')} />
        : workspaceMatch && document
          ? <WorkspaceRoute document={document} rawSection={workspaceMatch[1]} onBack={() => navigate('/')} onEdit={() => navigate('/editor')} onAnalytics={() => navigate('/analytics')} onSection={(section) => navigate(`/workspace/${section}`)} />
          : <StartScreen {...homeProps} />

  return <><Suspense fallback={<div className="app-loading"><span className="brand-mark">В</span><p>Открываем воронку…</p></div>}>
    {content}
  </Suspense>{conflict && <div className="modal-backdrop"><section className="dialog conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="sync-conflict-title"><h2 id="sync-conflict-title">Есть изменения на этом устройстве</h2><p className="dialog-lead">Локальная версия отличается от опубликованной. Выберите, какую открыть.</p><div className="dialog-actions"><button className="button secondary" onClick={() => { const local = conflict.local.document; setConflict(null); open(local) }}>Продолжить локальную версию</button><button className="button primary" onClick={() => void loadConflictServer()}>Загрузить опубликованную версию</button></div></section></div>}</>
}

function WorkspaceRoute({ document, rawSection, onBack, onEdit, onAnalytics, onSection }: { document: FunnelDocument; rawSection: string; onBack: () => void; onEdit: () => void; onAnalytics: () => void; onSection: (section: WorkspaceSection) => void }) {
  const allowed: WorkspaceSection[] = ['variables', 'tests', 'media', 'products', 'integrations', 'bot']
  const section = allowed.includes(rawSection as WorkspaceSection) ? rawSection as WorkspaceSection : 'variables'
  return <Workspace document={document} section={section} onSection={onSection} onBack={onBack} onEdit={onEdit} onAnalytics={onAnalytics} />
}

function useHashRoute() {
  const readPath = () => {
    const raw = window.location.hash.replace(/^#/, '') || '/'
    return raw.startsWith('/') ? raw : `/${raw}`
  }
  const [path, setPath] = useState(readPath)

  useEffect(() => {
    const onHashChange = () => setPath(readPath())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const navigate = useCallback((next: string, replace = false) => {
    const target = next.startsWith('/') ? next : `/${next}`
    if (replace) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${target}`)
      setPath(target)
      return
    }
    if (readPath() === target) {
      setPath(target)
      return
    }
    window.location.hash = target
  }, [])

  return { path, navigate }
}
