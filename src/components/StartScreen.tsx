import { BarChart3, Blocks, Clock3, Copy, FileJson, FolderOpen, Plus, Sparkles, Trash2, UploadCloud, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { DraftSummary, FunnelDocument } from '../model/types'
import { importFunnelFile } from '../services/files'

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
}

export function StartScreen(props: StartScreenProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [imported, setImported] = useState<FunnelDocument | null>(null)
  const [errors, setErrors] = useState<string[] | null>(null)

  const processFile = async (file?: File) => {
    if (!file) return
    const result = await importFunnelFile(file)
    if (result.success) setImported(result.document)
    else setErrors(result.errors)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="home-page" onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files')) setDragging(true) }}>
      <header className="home-header"><div className="home-brand"><span className="brand-mark">В</span><span><strong>Воронка</strong><small>автономный конструктор</small></span></div><span className="offline-pill"><i /> Работает локально</span></header>
      <main className="home-content">
        <section className="welcome-section">
          <div className="welcome-copy"><span className="eyebrow"><Sparkles size={14} /> Визуальный конструктор</span><h1>Соберите путь клиента<br />без кода и backend</h1><p>Создавайте Telegram-воронки, проверяйте логику и передавайте проект одним файлом <code>.funnel</code>.</p></div>
          <div className="welcome-visual" aria-hidden="true"><div className="visual-grid" /><div className="mini-node start"><span>●</span> Старт</div><div className="visual-line one" /><div className="mini-node message"><span>▣</span> Сообщение</div><div className="visual-line two" /><div className="mini-node choice"><span>☷</span> Выбор</div></div>
        </section>
        <section className="primary-actions">
          <button className="action-card create" onClick={props.onCreate}><span className="action-icon"><Plus size={25} /></span><span><strong>Создать новую воронку</strong><small>Начать с чистого полотна</small></span><i>→</i></button>
          <button className="action-card open" onClick={() => inputRef.current?.click()}><span className="action-icon"><FolderOpen size={25} /></span><span><strong>Открыть файл .funnel</strong><small>Импортировать готовый проект</small></span><i>→</i></button>
          <button className="action-card demo" onClick={props.onDemo}><span className="action-icon"><Sparkles size={25} /></span><span><strong>Открыть демо</strong><small>Все блоки и статистика</small></span><i>→</i></button>
          <input ref={inputRef} type="file" accept=".funnel,application/json" hidden onChange={(event) => processFile(event.target.files?.[0])} />
        </section>

        <section className="drafts-section">
          <div className="drafts-heading"><div><span className="eyebrow">Локальное хранилище</span><h2>Мои черновики</h2></div><span>{props.drafts.length} {plural(props.drafts.length, ['проект', 'проекта', 'проектов'])}</span></div>
          {props.loading ? <div className="drafts-loading">Загружаем черновики…</div> : props.drafts.length ? (
            <div className="draft-grid">{props.drafts.map((draft) => <DraftCard key={draft.id} draft={draft} {...props} />)}</div>
          ) : (
            <div className="drafts-empty"><div><Blocks size={30} /></div><h3>Черновиков пока нет</h3><p>Создайте новую воронку или откройте демонстрационный пример.</p><button className="button primary" onClick={props.onCreate}><Plus size={17} /> Создать воронку</button></div>
          )}
        </section>
      </main>
      <footer className="home-footer"><span>Данные хранятся только в этом браузере</span><span>Формат .funnel · schema 0.1.0</span></footer>

      {dragging && <div className="drop-overlay" onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => event.target === event.currentTarget && setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); processFile(event.dataTransfer.files[0]) }}><UploadCloud size={42} /><strong>Отпустите файл .funnel</strong><span>Мы проверим его до открытия</span></div>}
      {imported && <ImportDialog document={imported} onClose={() => setImported(null)} onOpen={() => { props.onOpen(imported); setImported(null) }} onSave={async () => { await props.onImportSave(imported); setImported(null) }} />}
      {errors && <ErrorDialog errors={errors} onClose={() => setErrors(null)} />}
    </div>
  )
}

function DraftCard({ draft, onOpen, onDuplicate, onDelete, onAnalytics }: { draft: DraftSummary; onOpen: (document: FunnelDocument) => void; onDuplicate: (document: FunnelDocument) => void; onDelete: (draft: DraftSummary) => void; onAnalytics: (document: FunnelDocument) => void }) {
  return <article className="draft-card"><div className="draft-card__top"><span className="draft-file-icon"><FileJson size={21} /></span><span className="version-pill">v{draft.version}</span><button className="mini-icon danger draft-delete" onClick={() => onDelete(draft)} title="Удалить"><Trash2 size={16} /></button></div><h3>{draft.name}</h3><div className="draft-meta"><span><Blocks size={14} /> {draft.nodeCount} {plural(draft.nodeCount, ['блок', 'блока', 'блоков'])}</span><span><Clock3 size={14} /> {formatRelative(draft.updatedAt)}</span></div><div className="draft-card__actions"><button className="button primary" onClick={() => onOpen(draft.document)}>Открыть</button><button className="icon-button bordered" onClick={() => onDuplicate(draft.document)} title="Дублировать"><Copy size={16} /></button>{draft.document.analytics.snapshotAt && <button className="icon-button bordered" onClick={() => onAnalytics(draft.document)} title="Статистика"><BarChart3 size={16} /></button>}</div></article>
}

function ImportDialog({ document, onClose, onOpen, onSave }: { document: FunnelDocument; onClose: () => void; onOpen: () => void; onSave: () => void }) {
  return <div className="modal-backdrop"><section className="dialog import-dialog"><button className="icon-button dialog-close" onClick={onClose}><X size={19} /></button><div className="dialog-status success"><FileJson size={27} /></div><h2>Файл успешно проверен</h2><p className="dialog-lead">«{document.funnel.name}», версия {document.funnel.version} · {document.nodes.length} {plural(document.nodes.length, ['блок', 'блока', 'блоков'])}</p><div className="import-summary"><span>Схема <strong>{document.schemaVersion}</strong></span><span>Статистика <strong>{document.analytics.snapshotAt ? 'есть' : 'нет'}</strong></span><span>Медиа <strong>{document.assets.length}</strong></span></div><div className="dialog-actions"><button className="button secondary" onClick={onSave}>Сохранить в черновики</button><button className="button primary" onClick={onOpen}>Открыть проект</button></div></section></div>
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
