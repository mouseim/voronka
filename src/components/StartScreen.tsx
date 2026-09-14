import { AlertTriangle, BarChart3, Blocks, CheckCircle2, Clock3, Cloud, Copy, Download, FileJson, FolderOpen, Plus, RefreshCw, Search, Sparkles, Trash2, UploadCloud, X, XCircle } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { DraftSummary, FunnelDocument, ImportResultSuccess } from '../model/types'
import { downloadFunnel, importFunnelFile } from '../services/files'
import { integrationConnection, type ServerFunnelSummary } from '../services/integrations'

interface StartScreenProps {
  drafts: DraftSummary[]
  serverFunnels: ServerFunnelSummary[]
  loading: boolean
  syncState: 'idle' | 'loading' | 'connected' | 'error'
  syncMessage: string
  onCreate: () => void
  onDemo: () => void
  onOpen: (document: FunnelDocument) => void
  onOpenLocal: (draft: DraftSummary) => void
  onOpenServer: (funnel: ServerFunnelSummary) => void
  onConnectRuntime: (connection: { runtimeUrl: string; adminToken: string }) => Promise<void>
  onRefreshServer: () => Promise<unknown>
  onImportSave: (document: FunnelDocument) => Promise<void>
  onDuplicate: (document: FunnelDocument) => void
  onDelete: (target: { funnelId: string; name: string; onServer: boolean }) => void
  onAnalytics: (document: FunnelDocument) => void
}

export function StartScreen(props: StartScreenProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [imported, setImported] = useState<ImportResultSuccess | null>(null)
  const [errors, setErrors] = useState<string[] | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | 'draft' | 'published'>('all')
  const [sort, setSort] = useState<'updated' | 'name' | 'version'>('updated')
  const [connectionOpen, setConnectionOpen] = useState(false)
  const latestDrafts = useMemo(() => [...props.drafts.filter((draft) => draft.status !== 'archived').reduce((items, draft) => {
    const funnelId = draft.document.funnel.id
    const current = items.get(funnelId)
    if (!current || draft.updatedAt > current.updatedAt) items.set(funnelId, draft)
    return items
  }, new Map<string, DraftSummary>()).values()], [props.drafts])
  const visibleDrafts = useMemo(() => latestDrafts.filter((draft) => (status === 'all' || draft.status === status) && draft.name.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'ru') : sort === 'version' ? b.version - a.version : b.updatedAt.localeCompare(a.updatedAt)), [latestDrafts, query, sort, status])
  const localFunnelIds = useMemo(() => new Set(latestDrafts.map((draft) => draft.document.funnel.id)), [latestDrafts])
  const serverOnly = useMemo(() => props.serverFunnels.filter((funnel) => !localFunnelIds.has(funnel.id) && (status === 'all' || status === 'published') && funnel.name.toLowerCase().includes(query.trim().toLowerCase())), [localFunnelIds, props.serverFunnels, query, status])
  const remoteById = useMemo(() => new Map(props.serverFunnels.map((funnel) => [funnel.id, funnel])), [props.serverFunnels])
  const total = latestDrafts.length + props.serverFunnels.filter((funnel) => !localFunnelIds.has(funnel.id)).length

  const processFile = async (file?: File) => {
    if (!file) return
    const result = await importFunnelFile(file)
    if (result.success) setImported(result)
    else setErrors(result.errors)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="home-page" onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files')) setDragging(true) }}>
      <header className="home-header"><div className="home-brand"><span className="brand-mark">В</span><span><strong>Воронка</strong><small>конструктор Telegram + VK</small></span></div><button className={`offline-pill sync-pill ${props.syncState}`} onClick={() => setConnectionOpen(true)}><i /> {props.syncState === 'connected' ? 'Подключено' : props.syncState === 'loading' ? 'Загрузка…' : 'Подключить'}</button></header>
      <main className="home-content">
        <section className="welcome-section">
          <div className="welcome-copy"><span className="eyebrow"><Sparkles size={14} /> Визуальный конструктор</span><h1>Соберите путь клиента<br />без кода</h1><p>Редактируйте одну воронку для Telegram и VK и публикуйте её одной кнопкой.</p></div>
          <div className="welcome-visual" aria-hidden="true"><div className="visual-grid" /><div className="mini-node start"><span>●</span> Старт</div><div className="visual-line one" /><div className="mini-node message"><span>▣</span> Сообщение</div><div className="visual-line two" /><div className="mini-node choice"><span>☷</span> Кнопки → ветки</div></div>
        </section>
        <section className="primary-actions">
          <button className="action-card create" onClick={props.onCreate}><span className="action-icon"><Plus size={25} /></span><span><strong>Создать новую воронку</strong><small>Начать с чистого полотна</small></span><i>→</i></button>
          <button className="action-card open" onClick={() => setConnectionOpen(true)}><span className="action-icon"><Cloud size={25} /></span><span><strong>Подключить мои воронки</strong><small>Загрузить опубликованные проекты</small></span><i>→</i></button>
          <button className="action-card demo" onClick={props.onDemo}><span className="action-icon"><Sparkles size={25} /></span><span><strong>Открыть полное демо</strong><small>7 механизмов, тест, продукт и статистика</small></span><i>→</i></button>
          <input ref={inputRef} type="file" accept=".funnel,application/json" hidden onChange={(event) => processFile(event.target.files?.[0])} />
        </section>

        <section className="drafts-section">
          <div className="drafts-heading"><div><span className="eyebrow">Рабочие и опубликованные</span><h2>Мои воронки</h2></div><div className="draft-heading-actions"><button className="button secondary" onClick={() => inputRef.current?.click()}><FolderOpen size={14} /> Импорт .funnel</button>{props.syncState === 'connected' && <button className="icon-button bordered" title="Обновить с сервера" onClick={() => void props.onRefreshServer()}><RefreshCw size={15} /></button>}<span>{total} {plural(total, ['воронка', 'воронки', 'воронок'])}</span></div></div>
          {props.syncMessage && <div className="sync-message error">{props.syncMessage}</div>}
          {total > 0 && <div className="draft-tools"><label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по названию" /></label><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">Все статусы</option><option value="draft">Черновики</option><option value="published">Опубликованные</option></select><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="updated">Сначала изменённые</option><option value="name">По названию</option><option value="version">По версии</option></select></div>}
          {props.loading ? <div className="drafts-loading">Загружаем воронки…</div> : visibleDrafts.length || serverOnly.length ? (
            <div className="draft-grid">{visibleDrafts.map((draft) => <DraftCard key={draft.document.funnel.id} draft={draft} remote={remoteById.get(draft.document.funnel.id)} onOpen={props.onOpenLocal} onDuplicate={props.onDuplicate} onDelete={props.onDelete} onAnalytics={props.onAnalytics} />)}{serverOnly.map((funnel) => <ServerDraftCard key={funnel.id} funnel={funnel} onOpen={props.onOpenServer} onDelete={props.onDelete} />)}</div>
          ) : total ? (
            <div className="drafts-empty"><div><Search size={30} /></div><h3>Ничего не найдено</h3><p>Измените запрос или фильтр статуса.</p><button className="button secondary" onClick={() => { setQuery(''); setStatus('all') }}>Сбросить фильтры</button></div>
          ) : (
            <div className="drafts-empty"><div><Blocks size={30} /></div><h3>Воронок пока нет</h3><p>Подключите опубликованные проекты или создайте новую воронку.</p><button className="button primary" onClick={() => setConnectionOpen(true)}><Cloud size={17} /> Подключить мои воронки</button></div>
          )}
        </section>
      </main>
      <footer className="home-footer"><span>Черновики сохраняются на этом устройстве</span><span>Опубликованные воронки можно загрузить после подключения</span></footer>

      {dragging && <div className="drop-overlay" onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => event.target === event.currentTarget && setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); processFile(event.dataTransfer.files[0]) }}><UploadCloud size={42} /><strong>Отпустите файл .funnel</strong><span>Мы проверим его до открытия</span></div>}
      {imported && <ImportDialog result={imported} onClose={() => setImported(null)} onOpen={() => { props.onOpen(imported.document); setImported(null) }} onSave={async () => { await props.onImportSave(imported.document); setImported(null) }} />}
      {errors && <ErrorDialog errors={errors} onClose={() => setErrors(null)} />}
      {connectionOpen && <RuntimeDialog onClose={() => setConnectionOpen(false)} onConnect={props.onConnectRuntime} />}
    </div>
  )
}

function DraftCard({ draft, remote, onOpen, onDuplicate, onDelete, onAnalytics }: { draft: DraftSummary; remote?: ServerFunnelSummary; onOpen: (draft: DraftSummary) => void; onDuplicate: (document: FunnelDocument) => void; onDelete: StartScreenProps['onDelete']; onAnalytics: (document: FunnelDocument) => void }) {
  return <article className="draft-card"><div className="draft-card__top"><span className="draft-file-icon"><FileJson size={21} /></span><span className={`draft-status ${draft.status}`}>{statusLabel(draft.status)}</span><span className="version-pill">v{draft.version}</span></div><h3>{draft.name}</h3><div className="draft-location"><span>На этом устройстве</span>{remote && <span className="server">На сервере v{remote.activeVersion}</span>}</div><div className="draft-health">{draft.errors > 0 ? <span className="error"><XCircle size={13} /> {draft.errors} ошибок</span> : <span className="ok"><CheckCircle2 size={13} /> Без ошибок</span>}{draft.warnings > 0 && <span className="warning"><AlertTriangle size={13} /> {draft.warnings}</span>}</div><div className="draft-meta"><span><Blocks size={14} /> {draft.nodeCount} {plural(draft.nodeCount, ['блок', 'блока', 'блоков'])}</span><span><Clock3 size={14} /> {formatRelative(draft.updatedAt)}</span></div><div className="draft-card__actions"><button className="button primary" onClick={() => onOpen(draft)}>Открыть</button><button className="icon-button bordered" onClick={() => onDuplicate(draft.document)} title="Дублировать"><Copy size={16} /></button><button className="icon-button bordered" onClick={() => downloadFunnel(draft.document)} title="Скачать"><Download size={16} /></button>{draft.document.analytics.snapshotAt && <button className="icon-button bordered" onClick={() => onAnalytics(draft.document)} title="Статистика"><BarChart3 size={16} /></button>}</div><button className="text-button danger funnel-delete" onClick={() => onDelete({ funnelId: draft.document.funnel.id, name: draft.name, onServer: Boolean(remote) })}><Trash2 size={14} /> Удалить воронку</button></article>
}

function ServerDraftCard({ funnel, onOpen, onDelete }: { funnel: ServerFunnelSummary; onOpen: (funnel: ServerFunnelSummary) => void; onDelete: StartScreenProps['onDelete'] }) {
  return <article className="draft-card server-card"><div className="draft-card__top"><span className="draft-file-icon"><Cloud size={21} /></span><span className="draft-status published">Опубликована</span><span className="version-pill">v{funnel.activeVersion}</span></div><h3>{funnel.name}</h3><div className="draft-location"><span className="server">На сервере{funnel.isDefault ? ' · основная' : ''}</span></div><div className="draft-health"><span className="ok"><CheckCircle2 size={13} /> Готова к загрузке</span></div><div className="draft-meta"><span><Blocks size={14} /> {funnel.nodeCount} {plural(funnel.nodeCount, ['блок', 'блока', 'блоков'])}</span><span><Clock3 size={14} /> {formatRelative(funnel.updatedAt)}</span></div><div className="draft-card__actions"><button className="button primary" onClick={() => onOpen(funnel)}>Открыть</button></div><button className="text-button danger funnel-delete" onClick={() => onDelete({ funnelId: funnel.id, name: funnel.name, onServer: true })}><Trash2 size={14} /> Удалить воронку</button></article>
}

function ImportDialog({ result, onClose, onOpen, onSave }: { result: ImportResultSuccess; onClose: () => void; onOpen: () => void; onSave: () => void }) {
  const { document } = result
  const issues = result.issues ?? []
  const errors = issues.filter((issue) => issue.severity === 'error').length
  const warnings = issues.filter((issue) => issue.severity === 'warning').length
  return <div className="modal-backdrop"><section className="dialog import-dialog"><button className="icon-button dialog-close" onClick={onClose}><X size={19} /></button><div className={`dialog-status ${errors ? 'warning' : 'success'}`}><FileJson size={27} /></div><h2>Файл успешно проверен</h2><p className="dialog-lead">«{document.funnel.name}», версия {document.funnel.version} · {document.nodes.length} {plural(document.nodes.length, ['блок', 'блока', 'блоков'])}</p><div className="import-summary"><span>Проверка <strong>{errors ? `${errors} ошибок` : warnings ? `${warnings} предупреждений` : 'готово'}</strong></span><span>Тесты <strong>{document.tests.length}</strong></span><span>Медиа <strong>{document.assets.length}</strong></span></div><div className="dialog-actions"><button className="button secondary" onClick={onSave}>Сохранить в черновики</button><button className="button primary" onClick={onOpen}>Открыть проект</button></div></section></div>
}

function RuntimeDialog({ onClose, onConnect }: { onClose: () => void; onConnect: (connection: { runtimeUrl: string; adminToken: string }) => Promise<void> }) {
  const initial = integrationConnection()
  const [runtimeUrl, setRuntimeUrl] = useState(initial.runtimeUrl)
  const [adminToken, setAdminToken] = useState(initial.adminToken)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')
  const connect = async () => {
    if (!runtimeUrl.trim() || !adminToken) { setMessage('Введите адрес и токен доступа.'); return }
    setWorking(true)
    setMessage('')
    try {
      await onConnect({ runtimeUrl, adminToken })
      onClose()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось подключиться.')
    } finally {
      setWorking(false)
    }
  }
  return <div className="modal-backdrop"><section className="dialog runtime-dialog" role="dialog" aria-modal="true" aria-labelledby="runtime-title"><button className="icon-button dialog-close" onClick={onClose} aria-label="Закрыть"><X size={19} /></button><div className="dialog-status success"><Cloud size={27} /></div><h2 id="runtime-title">Подключить мои воронки</h2><p className="dialog-lead">Введите данные доступа, которые передал владелец бота. Это нужно сделать один раз для этой вкладки.</p><label className="field"><span>Адрес</span><input type="url" value={runtimeUrl} placeholder="https://…" onChange={(event) => setRuntimeUrl(event.target.value)} /></label><label className="field"><span>Токен доступа</span><input type="password" autoComplete="off" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} /></label>{message && <div className="sync-message error">{message}</div>}<div className="dialog-actions"><button className="button secondary" onClick={onClose}>Отмена</button><button className="button primary" disabled={working} onClick={() => void connect()}>{working ? 'Подключаем…' : 'Подключить'}</button></div></section></div>
}

function ErrorDialog({ errors, onClose }: { errors: string[]; onClose: () => void }) {
  return <div className="modal-backdrop"><section className="dialog import-dialog"><button className="icon-button dialog-close" onClick={onClose}><X size={19} /></button><div className="dialog-status error"><X size={27} /></div><h2>Не удалось открыть файл</h2><p className="dialog-lead">Файл не прошёл безопасную проверку. Текущие черновики не изменены.</p><div className="import-errors">{errors.slice(0, 12).map((error, index) => <code key={index}>{error}</code>)}</div><div className="dialog-actions"><button className="button primary" onClick={onClose}>Понятно</button></div></section></div>
}

function plural(value: number, forms: [string, string, string]) {
  return value % 10 === 1 && value % 100 !== 11 ? forms[0] : [2, 3, 4].includes(value % 10) && ![12, 13, 14].includes(value % 100) ? forms[1] : forms[2]
}

function formatRelative(value: string) {
  const date = new Date(value)
  const diff = Date.now() - date.getTime()
  if (diff < 60_000) return 'только что'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин назад`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч назад`
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(date)
}

function statusLabel(status: DraftSummary['status']) { return status === 'published' ? 'Опубликована' : status === 'archived' ? 'Архив' : 'Черновик' }
