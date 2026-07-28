import { AlertTriangle, BarChart3, Blocks, CheckCircle2, Clock3, Copy, Download, FileJson, FolderOpen, Plus, Search, Sparkles, Trash2, UploadCloud, X, XCircle } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { DraftSummary, FunnelDocument, ImportResultSuccess } from '../model/types'
import { downloadFunnel, importFunnelFile } from '../services/files'

interface StartScreenProps {
  drafts: DraftSummary[]
  loading: boolean
  onCreate: () => void
  onDemo: () => void
  onOpen: (document: FunnelDocument) => void
  onImportSave: (document: FunnelDocument) => Promise<void>
  onDuplicate: (document: FunnelDocument) => void
  onDelete: (draft: DraftSummary) => void
  onAnalytics: (document: FunnelDocument) => void
  onNewVersion: (document: FunnelDocument) => void
}

export function StartScreen(props: StartScreenProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [imported, setImported] = useState<ImportResultSuccess | null>(null)
  const [errors, setErrors] = useState<string[] | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | DraftSummary['status']>('all')
  const [sort, setSort] = useState<'updated' | 'name' | 'version'>('updated')
  const visibleDrafts = useMemo(() => props.drafts.filter((draft) => (status === 'all' || draft.status === status) && draft.name.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'ru') : sort === 'version' ? b.version - a.version : b.updatedAt.localeCompare(a.updatedAt)), [props.drafts, query, sort, status])

  const processFile = async (file?: File) => {
    if (!file) return
    const result = await importFunnelFile(file)
    if (result.success) setImported(result)
    else setErrors(result.errors)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="home-page" onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files')) setDragging(true) }}>
      <header className="home-header"><div className="home-brand"><span className="brand-mark">В</span><span><strong>Воронка</strong><small>автономный конструктор</small></span></div><span className="offline-pill"><i /> Работает локально</span></header>
      <main className="home-content">
        <section className="welcome-section">
          <div className="welcome-copy"><span className="eyebrow"><Sparkles size={14} /> Визуальный конструктор</span><h1>Соберите путь клиента<br />без кода и backend</h1><p>Создавайте Telegram-воронки, проверяйте логику и передавайте проект одним файлом <code>.funnel</code>.</p></div>
          <div className="welcome-visual" aria-hidden="true"><div className="visual-grid" /><div className="mini-node start"><span>●</span> Старт</div><div className="visual-line one" /><div className="mini-node message"><span>▣</span> Сообщение</div><div className="visual-line two" /><div className="mini-node choice"><span>☷</span> Кнопки → ветки</div></div>
        </section>
        <section className="primary-actions">
          <button className="action-card create" onClick={props.onCreate}><span className="action-icon"><Plus size={25} /></span><span><strong>Создать новую воронку</strong><small>Начать с чистого полотна</small></span><i>→</i></button>
          <button className="action-card open" onClick={() => inputRef.current?.click()}><span className="action-icon"><FolderOpen size={25} /></span><span><strong>Открыть файл .funnel</strong><small>Импортировать готовый проект</small></span><i>→</i></button>
          <button className="action-card demo" onClick={props.onDemo}><span className="action-icon"><Sparkles size={25} /></span><span><strong>Открыть полное демо</strong><small>7 механизмов, тест, продукт и статистика</small></span><i>→</i></button>
          <input ref={inputRef} type="file" accept=".funnel,application/json" hidden onChange={(event) => processFile(event.target.files?.[0])} />
        </section>

        <section className="drafts-section">
          <div className="drafts-heading"><div><span className="eyebrow">Локальное хранилище</span><h2>Мои воронки</h2></div><span>{props.drafts.length} {plural(props.drafts.length, ['версия', 'версии', 'версий'])}</span></div>
          {props.drafts.length > 0 && <div className="draft-tools"><label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по названию" /></label><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">Все статусы</option><option value="draft">Черновики</option><option value="published">Опубликованные</option><option value="archived">Архив</option></select><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="updated">Сначала изменённые</option><option value="name">По названию</option><option value="version">По версии</option></select></div>}
          {props.loading ? <div className="drafts-loading">Загружаем черновики…</div> : visibleDrafts.length ? (
            <div className="draft-grid">{visibleDrafts.map((draft) => <DraftCard key={draft.id} draft={draft} {...props} />)}</div>
          ) : props.drafts.length ? (
            <div className="drafts-empty"><div><Search size={30} /></div><h3>Ничего не найдено</h3><p>Измените запрос или фильтр статуса.</p><button className="button secondary" onClick={() => { setQuery(''); setStatus('all') }}>Сбросить фильтры</button></div>
          ) : (
            <div className="drafts-empty"><div><Blocks size={30} /></div><h3>Черновиков пока нет</h3><p>Создайте новую воронку или откройте демонстрационный пример.</p><button className="button primary" onClick={props.onCreate}><Plus size={17} /> Создать воронку</button></div>
          )}
        </section>
      </main>
      <footer className="home-footer"><span>Данные хранятся только в этом браузере</span><span>Упрощённый формат .funnel</span></footer>

      {dragging && <div className="drop-overlay" onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => event.target === event.currentTarget && setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); processFile(event.dataTransfer.files[0]) }}><UploadCloud size={42} /><strong>Отпустите файл .funnel</strong><span>Мы проверим его до открытия</span></div>}
      {imported && <ImportDialog result={imported} onClose={() => setImported(null)} onOpen={() => { props.onOpen(imported.document); setImported(null) }} onSave={async () => { await props.onImportSave(imported.document); setImported(null) }} />}
      {errors && <ErrorDialog errors={errors} onClose={() => setErrors(null)} />}
    </div>
  )
}

function DraftCard({ draft, onOpen, onDuplicate, onDelete, onAnalytics, onNewVersion }: { draft: DraftSummary; onOpen: (document: FunnelDocument) => void; onDuplicate: (document: FunnelDocument) => void; onDelete: (draft: DraftSummary) => void; onAnalytics: (document: FunnelDocument) => void; onNewVersion: (document: FunnelDocument) => void }) {
  return <article className="draft-card"><div className="draft-card__top"><span className="draft-file-icon"><FileJson size={21} /></span><span className={`draft-status ${draft.status}`}>{statusLabel(draft.status)}</span><span className="version-pill">v{draft.version}</span><button className="mini-icon danger draft-delete" onClick={() => onDelete(draft)} title="Удалить"><Trash2 size={16} /></button></div><h3>{draft.name}</h3><div className="draft-health">{draft.errors > 0 ? <span className="error"><XCircle size={13} /> {draft.errors} ошибок</span> : <span className="ok"><CheckCircle2 size={13} /> Без ошибок</span>}{draft.warnings > 0 && <span className="warning"><AlertTriangle size={13} /> {draft.warnings}</span>}</div><div className="draft-meta"><span><Blocks size={14} /> {draft.nodeCount} {plural(draft.nodeCount, ['блок', 'блока', 'блоков'])}</span><span><Clock3 size={14} /> {formatRelative(draft.updatedAt)}</span></div><div className="draft-card__actions"><button className="button primary" onClick={() => onOpen(draft.document)}>Открыть</button><button className="icon-button bordered" onClick={() => onDuplicate(draft.document)} title="Дублировать"><Copy size={16} /></button><button className="icon-button bordered" onClick={() => downloadFunnel(draft.document)} title="Скачать"><Download size={16} /></button>{draft.document.analytics.snapshotAt && <button className="icon-button bordered" onClick={() => onAnalytics(draft.document)} title="Статистика"><BarChart3 size={16} /></button>}</div><div className="draft-secondary-actions"><button onClick={() => onNewVersion(draft.document)}><Copy size={13} /> Новая версия</button></div></article>
}

function ImportDialog({ result, onClose, onOpen, onSave }: { result: ImportResultSuccess; onClose: () => void; onOpen: () => void; onSave: () => void }) {
  const { document } = result
  const issues = result.issues ?? []
  const errors = issues.filter((issue) => issue.severity === 'error').length
  const warnings = issues.filter((issue) => issue.severity === 'warning').length
  return <div className="modal-backdrop"><section className="dialog import-dialog"><button className="icon-button dialog-close" onClick={onClose}><X size={19} /></button><div className={`dialog-status ${errors ? 'warning' : 'success'}`}><FileJson size={27} /></div><h2>Файл успешно проверен</h2><p className="dialog-lead">«{document.funnel.name}», версия {document.funnel.version} · {document.nodes.length} {plural(document.nodes.length, ['блок', 'блока', 'блоков'])}</p><div className="import-summary"><span>Проверка <strong>{errors ? `${errors} ошибок` : warnings ? `${warnings} предупреждений` : 'готово'}</strong></span><span>Тесты <strong>{document.tests.length}</strong></span><span>Медиа <strong>{document.assets.length}</strong></span></div><div className="dialog-actions"><button className="button secondary" onClick={onSave}>Сохранить в черновики</button><button className="button primary" onClick={onOpen}>Открыть проект</button></div></section></div>
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
