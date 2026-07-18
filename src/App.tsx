import { lazy, Suspense, useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { StartScreen } from './components/StartScreen'
import { freshDemoFunnel } from './model/demo'
import { createEmptyFunnel, duplicateFunnel } from './model/funnel'
import type { DraftSummary, FunnelDocument } from './model/types'
import { deleteDraft, getDrafts, saveDraft } from './services/drafts'
import { useEditorStore } from './store/editor'

const Editor = lazy(() => import('./components/Editor').then((module) => ({ default: module.Editor })))
const Analytics = lazy(() => import('./components/Analytics').then((module) => ({ default: module.Analytics })))

export default function App() {
  return <HashRouter><AppRoutes /></HashRouter>
}

function AppRoutes() {
  const navigate = useNavigate()
  const location = useLocation()
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
    const collision = drafts.some((draft) => draft.id === source.funnel.id)
    const next = collision ? duplicateFunnel(source) : source
    await persist(next)
  }

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
  }

  return <Suspense fallback={<div className="app-loading"><span className="brand-mark">В</span><p>Открываем воронку…</p></div>}>
    <Routes>
      <Route path="/" element={<StartScreen {...homeProps} />} />
      <Route path="/editor" element={document ? <Editor document={document} onBack={() => navigate('/')} onAnalytics={() => navigate('/analytics')} onSave={persist} /> : <Navigate to="/" replace />} />
      <Route path="/analytics" element={document ? <Analytics document={document} onBack={() => navigate('/')} onEdit={() => navigate('/editor')} /> : <Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to={location.pathname === '/editor' && document ? '/editor' : '/'} replace />} />
    </Routes>
  </Suspense>
}
