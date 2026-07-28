import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { StartScreen } from './components/StartScreen'
import type { WorkspaceSection } from './components/Workspace'
import { freshDemoFunnel } from './model/demo'
import { createEmptyFunnel, duplicateFunnel } from './model/funnel'
import { createNewVersion } from './model/funnel'
import type { DraftSummary, FunnelDocument } from './model/types'
import { deleteDraft, getDrafts, saveDraft, saveRevision } from './services/drafts'
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

  const refresh = async () => {
    try { setDrafts(await getDrafts()) } finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [])

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

  const create = async () => {
    const next = createEmptyFunnel()
    await persist(next)
    open(next)
  }
  const demo = () => open(freshDemoFunnel())
  const duplicate = async (source: FunnelDocument) => { const next = duplicateFunnel(source); await persist(next); open(next) }
  const remove = async (draft: DraftSummary) => {
    if (!window.confirm(`Удалить черновик «${draft.name}»? Это действие нельзя отменить.`)) return
    await deleteDraft(draft.id)
    await refresh()
  }
  const importSave = async (source: FunnelDocument) => {
    const collision = drafts.some((draft) => draft.document.funnel.id === source.funnel.id && draft.version === source.funnel.version)
    if (collision && !window.confirm(`Версия ${source.funnel.version} воронки «${source.funnel.name}» уже есть локально. Сохранить импорт как независимую копию?`)) return
    const next = collision ? duplicateFunnel(source) : source
    await persist(next)
  }
  const newVersion = async (source: FunnelDocument) => { const next = createNewVersion(source, 'Создано с главного экрана'); await persist(next); open(next) }

  const homeProps = {
    drafts,
    loading,
    onCreate: create,
    onDemo: demo,
    onOpen: (next: FunnelDocument) => open(next),
    onImportSave: importSave,
    onDuplicate: duplicate,
    onDelete: remove,
    onAnalytics: (next: FunnelDocument) => open(next, '/analytics'),
    onNewVersion: newVersion,
  }

  useEffect(() => {
    if (!document && path !== '/') navigate('/', true)
  }, [document, navigate, path])

  const workspaceMatch = path.match(/^\/workspace\/([^/]+)$/)
  const content = path === '/'
    ? <StartScreen {...homeProps} />
    : path === '/editor' && document
      ? <Editor document={document} onBack={() => navigate('/')} onAnalytics={() => navigate('/analytics')} onWorkspace={(section) => navigate(`/workspace/${section}`)} onSave={manualSave} />
      : path === '/analytics' && document
        ? <Analytics document={document} onBack={() => navigate('/')} onEdit={() => navigate('/editor')} />
        : workspaceMatch && document
          ? <WorkspaceRoute document={document} rawSection={workspaceMatch[1]} onBack={() => navigate('/')} onEdit={() => navigate('/editor')} onAnalytics={() => navigate('/analytics')} onSection={(section) => navigate(`/workspace/${section}`)} />
          : <StartScreen {...homeProps} />

  return <Suspense fallback={<div className="app-loading"><span className="brand-mark">В</span><p>Открываем воронку…</p></div>}>
    {content}
  </Suspense>
}

function WorkspaceRoute({ document, rawSection, onBack, onEdit, onAnalytics, onSection }: { document: FunnelDocument; rawSection: string; onBack: () => void; onEdit: () => void; onAnalytics: () => void; onSection: (section: WorkspaceSection) => void }) {
  const allowed: WorkspaceSection[] = ['variables', 'tests', 'media', 'products', 'bot']
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
