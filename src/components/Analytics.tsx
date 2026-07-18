import {
  ArrowLeft, ArrowRight, BarChart3, Beaker, CheckCircle2, Clock3, Download, Edit3,
  Eye, FileText, Filter, GitBranch, Package, Search, TrendingUp, Users,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { applicationsCsv, contactsCsv } from '../model/csv'
import { analyticsForNode, nodeTitle } from '../model/funnel'
import type { FunnelDocument } from '../model/types'
import { downloadText } from '../services/files'
import { nodeMeta } from './nodeMeta'

interface AnalyticsProps { document: FunnelDocument; onBack: () => void; onEdit: () => void }
type AnalyticsTab = 'overview' | 'routes' | 'tests' | 'results' | 'products' | 'sources' | 'data'

const tabs: Array<{ id: AnalyticsTab; label: string }> = [
  { id: 'overview', label: 'Обзор' }, { id: 'routes', label: 'Маршруты' },
  { id: 'tests', label: 'Тесты' }, { id: 'results', label: 'Результаты' },
  { id: 'products', label: 'Продукты' }, { id: 'sources', label: 'Источники' },
  { id: 'data', label: 'Контакты и заявки' },
]

export function Analytics({ document, onBack, onEdit }: AnalyticsProps) {
  const [tab, setTab] = useState<AnalyticsTab>('overview')
  const analytics = document.analytics
  const started = analytics.summary.started ?? 0
  const completed = analytics.summary.completed ?? 0
  const total = analytics.summary.totalUsers ?? started
  const conversion = started ? completed / started * 100 : 0
  const completeness = analytics.completeness?.sections ?? []

  return <div className="analytics-page">
    <header className="analytics-header app-header"><button className="brand-button" onClick={onBack}><span className="brand-mark">В</span><span><strong>Воронка</strong><small>конструктор</small></span></button><div className="header-divider" /><div className="analytics-title"><span>Статистика</span><strong>{document.funnel.name}</strong></div><button className="button secondary" onClick={onEdit}><Edit3 size={16} /> Редактировать</button></header>
    <main className="analytics-content">
      <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> К моим воронкам</button>
      <div className="analytics-hero"><div><span className="eyebrow">Снимок данных</span><h1>Как работает воронка</h1><p>Версия {analytics.funnelVersion} · {analytics.snapshotAt ? formatDate(analytics.snapshotAt) : 'статистика ещё не загружена'}</p></div>{analytics.snapshotAt && <div className="snapshot-badge"><Clock3 size={16} /> Данные не обновляются автоматически</div>}</div>
      {!analytics.snapshotAt ? <div className="analytics-empty"><div><BarChart3 size={40} /></div><h2>В этом файле ещё нет статистики</h2><p>Конструктор не подключается к backend. Снимок появится после импорта файла, дополненного будущим Telegram-ботом.</p><button className="button primary" onClick={onEdit}><Edit3 size={16} /> Вернуться в редактор</button></div> : <>
        <section className="metric-grid"><Metric icon={Users} label="Всего пользователей" value={total.toLocaleString('ru-RU')} note={`${started} начали воронку`} color="blue" /><Metric icon={Eye} label="Начали" value={started.toLocaleString('ru-RU')} note={`${Math.max(0, total - started)} не дошли до старта`} color="violet" /><Metric icon={CheckCircle2} label="Завершили" value={completed.toLocaleString('ru-RU')} note={`${Math.max(0, started - completed)} не завершили`} color="green" /><Metric icon={TrendingUp} label="Общая конверсия" value={`${conversion.toFixed(1)}%`} note="от начавших до завершения" color="orange" /></section>
        <div className="analytics-data-status"><span><FileText size={15} /> Полнота снимка: <strong>{analytics.completeness?.level ?? 'aggregate'}</strong></span><span>{completeness.length ? `Разделы: ${completeness.join(', ')}` : 'Источник не перечислил доступные разделы'}</span></div>
        <nav className="analytics-tabs">{tabs.map((item) => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>
        {tab === 'overview' && <Overview document={document} />}
        {tab === 'routes' && <RoutesView document={document} />}
        {tab === 'tests' && <GenericMetrics title="Прохождение тестов" icon={Beaker} values={analytics.tests} empty="В снимке нет статистики тестов" />}
        {tab === 'results' && <ResultsView document={document} />}
        {tab === 'products' && <GenericMetrics title="Продукты и оплата" icon={Package} values={analytics.products} empty="В снимке нет статистики продуктов" />}
        {tab === 'sources' && <SourcesView document={document} />}
        {tab === 'data' && <DataTables document={document} />}
      </>}
    </main>
  </div>
}

function Overview({ document }: { document: FunnelDocument }) {
  return <section className="analytics-section compact-top"><div className="section-heading"><div><span className="eyebrow">Этапы</span><h2>Прохождение по блокам</h2></div><span className="muted-text">{document.nodes.length} блоков</span></div><div className="stage-list">{document.nodes.filter((node) => !['comment','group'].includes(node.type)).map((node, index) => { const metric = analyticsForNode(document, node.id); const meta = nodeMeta[node.type]; const Icon = meta.icon; return <article className="stage-card" key={node.id}><div className="stage-number">{index + 1}</div><span className="node-type-icon" style={{ color: meta.color, background: meta.background }}><Icon size={18} /></span><div className="stage-name"><strong>{nodeTitle(node)}</strong><span>{meta.label}</span></div><StageMetric label="Вошли" value={metric.entered} /><StageMetric label="Завершили" value={metric.completed} /><StageMetric label="Отсеялись" value={metric.dropped} danger={metric.dropped > 0} /><div className="stage-conversion"><span><b>Конверсия</b><strong>{metric.conversion.toFixed(1)}%</strong></span><div><i style={{ width: `${Math.min(100, metric.conversion)}%` }} /></div></div></article> })}</div></section>
}

function RoutesView({ document }: { document: FunnelDocument }) {
  const max = Math.max(1, ...document.edges.map((edge) => document.analytics.edges[edge.id]?.transitions ?? 0))
  return <section className="analytics-section compact-top"><div className="section-heading"><div><span className="eyebrow">Переходы</span><h2>Маршруты пользователей</h2></div></div><div className="route-list">{document.edges.map((edge) => { const source = document.nodes.find((node) => node.id === edge.source); const target = document.nodes.find((node) => node.id === edge.target); const transitions = document.analytics.edges[edge.id]?.transitions ?? 0; const sourceEntered = document.analytics.nodes[edge.source]?.entered ?? 0; const share = sourceEntered ? transitions / sourceEntered * 100 : 0; return <article key={edge.id}><GitBranch size={17} /><div><span>{source ? nodeTitle(source) : edge.source}<ArrowRight size={13} />{target ? nodeTitle(target) : edge.target}</span><small>{edge.label || edge.sourceHandle || 'Далее'}</small><i><b style={{ width: `${transitions / max * 100}%` }} /></i></div><strong>{transitions.toLocaleString('ru-RU')}</strong><span>{share.toFixed(1)}%</span></article> })}</div></section>
}

function ResultsView({ document }: { document: FunnelDocument }) {
  const values = Object.entries(document.analytics.results ?? {})
  const total = values.reduce((sum, [, value]) => sum + Number(asRecord(value).users ?? asRecord(value).count ?? 0), 0)
  return <section className="analytics-section compact-top"><div className="section-heading"><div><span className="eyebrow">Сегменты</span><h2>Распределение результатов</h2></div></div>{values.length ? <div className="result-stats-grid">{values.sort((a, b) => Number(asRecord(b[1]).users ?? 0) - Number(asRecord(a[1]).users ?? 0)).map(([code, value]) => { const record = asRecord(value); const users = Number(record.users ?? record.count ?? 0); return <article key={code}><span className="result-stat-code">{code}</span><h3>{String(record.name ?? code)}</h3><strong>{users.toLocaleString('ru-RU')}</strong><small>{total ? `${(users / total * 100).toFixed(1)}% результатов` : 'Доля неизвестна'}</small><div><i style={{ width: `${total ? users / total * 100 : 0}%` }} /></div></article> })}</div> : <AnalyticsSectionEmpty text="В снимке нет распределения результатов" />}</section>
}

function SourcesView({ document }: { document: FunnelDocument }) {
  const sources = Object.entries(document.analytics.sources ?? {})
  return <section className="analytics-section compact-top"><div className="section-heading"><div><span className="eyebrow">Атрибуция</span><h2>Источники трафика</h2></div></div>{sources.length ? <div className="source-table"><div className="source-table-head"><span>Источник</span><span>Начали</span><span>Завершили</span><span>Конверсия</span></div>{sources.map(([source, value]) => { const record = asRecord(value); const started = Number(record.started ?? 0); const completed = Number(record.completed ?? 0); return <div key={source}><strong>{source}</strong><span>{started.toLocaleString('ru-RU')}</span><span>{completed.toLocaleString('ru-RU')}</span><span>{started ? (completed / started * 100).toFixed(1) : '0.0'}%</span></div> })}</div> : <AnalyticsSectionEmpty text="В снимке нет разбивки по источникам" />}</section>
}

function GenericMetrics({ title, icon: Icon, values, empty }: { title: string; icon: typeof Beaker; values?: Record<string, unknown>; empty: string }) {
  const entries = Object.entries(values ?? {})
  return <section className="analytics-section compact-top"><div className="section-heading"><div><span className="eyebrow">Данные снимка</span><h2>{title}</h2></div></div>{entries.length ? <div className="generic-metric-grid">{entries.map(([key, value]) => <article key={key}><span><Icon size={19} /></span><h3>{key}</h3><div>{Object.entries(asRecord(value)).slice(0, 8).map(([name, metric]) => <p key={name}><span>{humanize(name)}</span><strong>{formatMetric(metric)}</strong></p>)}</div></article>)}</div> : <AnalyticsSectionEmpty text={empty} />}</section>
}

function DataTables({ document }: { document: FunnelDocument }) {
  const [kind, setKind] = useState<'contacts' | 'applications'>('contacts')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const rows = kind === 'contacts' ? document.analytics.contacts : document.analytics.applications
  const visible = useMemo(() => rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query.toLowerCase())), [rows, query])
  const pageSize = 10
  const paged = visible.slice(page * pageSize, (page + 1) * pageSize)
  const pages = Math.max(1, Math.ceil(visible.length / pageSize))
  const exportRows = () => downloadText(kind === 'contacts' ? contactsCsv(document) : applicationsCsv(document), `${kind}-${document.funnel.key}-v${document.funnel.version}.csv`, 'text/csv;charset=utf-8')
  return <section className="analytics-section compact-top data-section"><div className="section-heading"><div><span className="eyebrow">Данные</span><h2>Контакты и заявки</h2></div><button className="button secondary" onClick={exportRows}><Download size={15} /> CSV</button></div><div className="data-toolbar"><div><button className={kind === 'contacts' ? 'active' : ''} onClick={() => { setKind('contacts'); setPage(0) }}>Контакты <span>{document.analytics.contacts.length}</span></button><button className={kind === 'applications' ? 'active' : ''} onClick={() => { setKind('applications'); setPage(0) }}>Заявки <span>{document.analytics.applications.length}</span></button></div><label><Search size={14} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} placeholder="Поиск по таблице" /></label><span><Filter size={13} /> {visible.length} записей</span></div><div className="full-data-table"><table><thead><tr>{kind === 'contacts' ? <><th>Имя</th><th>Контакт</th><th>Источник</th><th>Результат</th><th>Дата</th></> : <><th>ID</th><th>Контакт</th><th>Статус</th><th>Источник</th><th>Результат</th><th>Дата</th><th>Комментарий</th></>}</tr></thead><tbody>{paged.map((row) => <DataRow key={row.id} kind={kind} row={row} />)}</tbody></table>{!paged.length && <AnalyticsSectionEmpty text="Записи не найдены" />}</div><div className="pagination"><button disabled={page === 0} onClick={() => setPage(page - 1)}>Назад</button><span>{page + 1} / {pages}</span><button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Далее</button></div></section>
}

function DataRow({ kind, row }: { kind: 'contacts' | 'applications'; row: { id: string; [key: string]: unknown } }) {
  const date = typeof row.createdAt === 'string' ? formatShortDate(row.createdAt) : '—'
  if (kind === 'contacts') return <tr><td><strong>{String(row.name || 'Без имени')}</strong><small>{String(row.username ?? '')}</small></td><td>{String(row.email || row.phone || '—')}</td><td>{String(row.source || '—')}</td><td>{String(row.resultCode || '—')}</td><td>{date}</td></tr>
  return <tr><td><code>{row.id}</code></td><td>{String(row.contactId || '—')}</td><td><span className="status-pill">{String(row.status || 'Новая')}</span></td><td>{String(row.source || '—')}</td><td>{String(row.resultCode || '—')}</td><td>{date}</td><td>{String(row.comment || '—')}</td></tr>
}

function Metric({ icon: Icon, label, value, note, color }: { icon: typeof Users; label: string; value: string; note: string; color: string }) { return <article className={`metric-card ${color}`}><div className="metric-icon"><Icon size={20} /></div><span>{label}</span><strong>{value}</strong><small>{note}</small></article> }
function StageMetric({ label, value, danger }: { label: string; value: number; danger?: boolean }) { return <div className={`stage-metric ${danger ? 'danger' : ''}`}><span>{label}</span><strong>{value.toLocaleString('ru-RU')}</strong></div> }
function AnalyticsSectionEmpty({ text }: { text: string }) { return <div className="analytics-section-empty"><BarChart3 size={28} /><strong>{text}</strong><span>Раздел останется доступным для будущих снимков.</span></div> }
function asRecord(value: unknown) { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : { value } }
function humanize(value: string) { return ({ started: 'Начали', completed: 'Завершили', averageSeconds: 'Среднее время', viewed: 'Просмотры', initiated: 'Начали оплату', paid: 'Оплатили', revenueMinor: 'Выручка' } as Record<string, string>)[value] ?? value }
function formatMetric(value: unknown) { return typeof value === 'number' ? value.toLocaleString('ru-RU') : typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—') }
function formatDate(value: string) { return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(value)) }
function formatShortDate(value: string) { return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }
