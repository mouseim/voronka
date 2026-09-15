import { ArrowLeft, BarChart3, CheckCircle2, Download, Edit3, Eye, FileText, Package, Search, TrendingDown, TrendingUp, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { analyticsForNode, nodeTitle } from '../model/funnel'
import type { FunnelDocument } from '../model/types'
import { applicationsCsv, contactsCsv } from '../model/csv'
import { downloadText } from '../services/files'
import { getServerFunnelVersion, getServerFunnelVersions, integrationConnection, type ServerFunnelVersion } from '../services/integrations'
import { nodeMeta } from './nodeMeta'

type Tab = 'overview' | 'stages' | 'questions' | 'results' | 'sources' | 'products' | 'data'
const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Обзор' },
  { id: 'stages', label: 'Этапы и отвал' },
  { id: 'questions', label: 'Вопросы теста' },
  { id: 'results', label: 'Результаты' },
  { id: 'sources', label: 'Источники' },
  { id: 'products', label: 'Продукты и оплаты' },
  { id: 'data', label: 'Контакты и заявки' },
]

export function Analytics({ document, onBack, onEdit }: { document: FunnelDocument; onBack: () => void; onEdit: () => void }) {
  const [tab, setTab] = useState<Tab>('overview')
  const [viewDocument, setViewDocument] = useState(document)
  const [versions, setVersions] = useState<ServerFunnelVersion[]>([])
  const [selectedVersion, setSelectedVersion] = useState(document.funnel.version)
  const [loadingVersion, setLoadingVersion] = useState(false)
  useEffect(() => {
    let cancelled = false
    setViewDocument(document)
    setVersions([])
    setSelectedVersion(document.funnel.version)
    const connection = integrationConnection()
    if (!connection.runtimeUrl || !connection.adminToken) return () => { cancelled = true }
    void getServerFunnelVersions(document.funnel.id).then(async (available) => {
      if (cancelled || !available.length) return
      const initial = available.some((item) => item.version === document.funnel.version)
        ? document.funnel.version
        : (available.find((item) => item.active)?.version ?? available[0]!.version)
      const liveDocument = await getServerFunnelVersion(document.funnel.id, initial)
      if (cancelled) return
      setVersions(available)
      setSelectedVersion(initial)
      setViewDocument(liveDocument)
    }).catch(() => {
      if (!cancelled) {
        setVersions([])
        setViewDocument(document)
      }
    })
    return () => { cancelled = true }
  }, [document])
  const selectVersion = async (version: number) => {
    const previous = selectedVersion
    setSelectedVersion(version)
    setLoadingVersion(true)
    try {
      setViewDocument(await getServerFunnelVersion(document.funnel.id, version))
    } catch {
      setSelectedVersion(previous)
    } finally {
      setLoadingVersion(false)
    }
  }
  const analytics = viewDocument.analytics
  const started = analytics.summary.started
  const completed = analytics.summary.completed
  const conversion = started ? completed / started * 100 : 0
  return <div className="analytics-page">
    <header className="analytics-header app-header"><button className="brand-button" onClick={onBack}><span className="brand-mark">В</span><span><strong>Воронка</strong><small>конструктор</small></span></button><div className="header-divider" /><div className="analytics-title"><span>Статистика</span><strong>{document.funnel.name}</strong></div><button className="button secondary" onClick={onEdit}><Edit3 size={16} /> Редактировать</button></header>
    <main className="analytics-content">
      <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> К моим воронкам</button>
      <div className="analytics-hero"><div><span className="eyebrow">{versions.length ? 'Данные runtime' : 'Снимок из файла'}</span><h1>Как работает воронка</h1><p>Версия {analytics.funnelVersion} · {analytics.snapshotAt ? formatDate(analytics.snapshotAt) : 'данных ещё нет'}</p>{versions.length > 0 && <label>Версия <select value={selectedVersion} disabled={loadingVersion} onChange={(event) => void selectVersion(Number(event.target.value))}>{versions.map((item) => <option key={item.version} value={item.version}>{item.emoji ? `${item.emoji} ` : ''}v{item.version}{item.active ? ' · текущая' : ''}</option>)}</select></label>}</div>{analytics.snapshotAt && <div className="snapshot-badge"><FileText size={16} /> {versions.length ? 'Актуальные данные сервера' : 'Не обновляется автоматически'}</div>}</div>
      {!analytics.snapshotAt ? <div className="analytics-empty"><div><BarChart3 size={40} /></div><h2>В этом файле ещё нет статистики</h2><p>Она появится после запуска воронки в Telegram-боте и импорта обновлённого файла.</p><button className="button primary" onClick={onEdit}>Вернуться к схеме</button></div> : <>
        <section className="metric-grid"><Metric icon={Users} label="Пришли" value={analytics.summary.totalUsers} note={`${started} начали`} color="blue" /><Metric icon={Eye} label="Начали" value={started} note={`${Math.max(0, analytics.summary.totalUsers - started)} не начали`} color="violet" /><Metric icon={CheckCircle2} label="Завершили" value={completed} note={`${Math.max(0, started - completed)} не завершили`} color="green" /><Metric icon={TrendingUp} label="Конверсия" value={`${conversion.toFixed(1)}%`} note="от начала до завершения" color="orange" /></section>
        <nav className="analytics-tabs">{tabs.map((item) => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>
        {tab === 'overview' && <Overview document={viewDocument} />}
        {tab === 'stages' && <Stages document={viewDocument} />}
        {tab === 'questions' && <SimpleMetrics title="Ответы на вопросы" values={viewDocument.analytics.questions} empty="В снимке пока нет данных по вопросам теста." />}
        {tab === 'results' && <Results document={viewDocument} />}
        {tab === 'sources' && <Sources document={viewDocument} />}
        {tab === 'products' && <Products document={viewDocument} />}
        {tab === 'data' && <DataTables document={viewDocument} />}
      </>}
    </main>
  </div>
}

function Overview({ document }: { document: FunnelDocument }) {
  const summary = document.analytics.summary
  return <section className="analytics-section compact-top"><div className="section-heading"><div><span className="eyebrow">Главное</span><h2>Путь пользователя</h2></div></div><div className="overview-facts"><article><strong>{summary.applications.toLocaleString('ru-RU')}</strong><span>оставили заявку</span></article><article><strong>{summary.purchases.toLocaleString('ru-RU')}</strong><span>купили</span></article><article><strong>{money(summary.revenue)}</strong><span>выручка в снимке</span></article></div><Stages document={document} compact /></section>
}

function Stages({ document, compact = false }: { document: FunnelDocument; compact?: boolean }) {
  return <section className={compact ? 'nested-stages' : 'analytics-section compact-top'}>{!compact && <div className="section-heading"><div><span className="eyebrow">Этапы</span><h2>Где пользователи уходят</h2></div></div>}<div className="stage-list">{document.nodes.map((node, index) => { const metric = analyticsForNode(document, node.id); const meta = nodeMeta[node.type]; const Icon = meta.icon; return <article className="stage-card" key={node.id}><div className="stage-number">{index + 1}</div><span className="node-type-icon" style={{ color: meta.color, background: meta.background }}><Icon size={18} /></span><div className="stage-name"><strong>{nodeTitle(node)}</strong><span>{meta.label}</span></div><StageMetric label="Вошли" value={metric.entered} /><StageMetric label="Прошли" value={metric.completed} /><StageMetric label="Ушли" value={metric.dropped} danger={metric.dropped > 0} /><div className="stage-conversion"><span><b>Конверсия</b><strong>{metric.conversion.toFixed(1)}%</strong></span><div><i style={{ width: `${Math.min(100, metric.conversion)}%` }} /></div></div></article> })}</div></section>
}

function Results({ document }: { document: FunnelDocument }) {
  const values = Object.entries(document.analytics.results)
  const total = values.reduce((sum, [, value]) => sum + Number(value.users ?? value.count ?? 0), 0)
  const experiments = Object.values(document.analytics.abButtons ?? {})
  return <section className="analytics-section compact-top"><div className="section-heading"><div><span className="eyebrow">Диагностика</span><h2>Какие результаты встречаются чаще</h2></div></div>{values.length ? <div className="result-stats-grid">{values.map(([id, value]) => { const users = Number(value.users ?? value.count ?? 0); return <article key={id}><h3>{String(value.name ?? 'Результат')}</h3><strong>{users.toLocaleString('ru-RU')}</strong><small>{total ? `${(users / total * 100).toFixed(1)}% результатов` : 'Нет данных о доле'}</small><div><i style={{ width: `${total ? users / total * 100 : 0}%` }} /></div></article> })}</div> : <Empty text="В снимке пока нет распределения результатов." />}{experiments.length > 0 && <><div className="section-heading"><div><span className="eyebrow">A/B кнопок</span><h2>Тексты кнопок результата</h2></div></div><div className="result-stats-grid">{experiments.map((experiment) => { const ctrA = abCtr(experiment.A.clicked, experiment.A.shown); const ctrB = abCtr(experiment.B.clicked, experiment.B.shown); return <article key={experiment.buttonId}><h3>{experiment.A.text} / {experiment.B.text}</h3>{([['A', experiment.A, ctrA], ['B', experiment.B, ctrB]] as const).map(([variant, data, ctr]) => <p key={variant}><strong>Вариант {variant}</strong><br />Показы: {data.shown} · Клики: {data.clicked} · CTR: {ctr.toFixed(1)}%{ctr > (variant === 'A' ? ctrB : ctrA) ? ' · Лучший CTR' : ''}</p>)}</article> })}</div></>}</section>
}

function Sources({ document }: { document: FunnelDocument }) {
  const [platform, setPlatform] = useState<'all' | 'telegram' | 'vk'>('all')
  const links = document.bot.trackingLinks.filter((link) => platform === 'all' || (link.platform ?? 'telegram') === platform)
  return <section className="analytics-section compact-top"><div className="section-heading"><div><span className="eyebrow">Привлечение</span><h2>Ссылки и источники</h2></div></div>{document.bot.trackingLinks.length > 0 && <div className="data-toolbar"><div>{([['all', 'Все'], ['telegram', 'Telegram'], ['vk', 'VK']] as const).map(([value, label]) => <button key={value} className={platform === value ? 'active' : ''} onClick={() => setPlatform(value)}>{label}</button>)}</div></div>}<div className="source-cards">{links.map((link) => { const linkPlatform = link.platform ?? 'telegram'; const label = linkPlatform === 'vk' ? 'VK' : 'Telegram'; const details = link.description?.trim() || [link.source, link.campaign, link.content].filter(Boolean).join(' · '); const data = document.analytics.sources[link.id] ?? document.analytics.sources[link.code]; if (!data) return <article className="source-empty-card" key={link.id}><small>{label}</small><strong>{link.name}</strong><span>{details || 'Поля источника не заполнены'}</span><p>Ссылка опубликована, переходов пока нет.</p></article>; const conversion = data.started ? data.completed / data.started * 100 : 0; return <article className="source-stat-card" key={link.id}><div><small>{label}</small><strong>{link.name}</strong><span>{details || 'Поля источника не заполнены'}</span></div><dl><div><dt>Пришли</dt><dd>{data.arrived}</dd></div><div><dt>Начали</dt><dd>{data.started}</dd></div><div><dt>Завершили</dt><dd>{data.completed}</dd></div><div><dt>Конверсия</dt><dd>{conversion.toFixed(1)}%</dd></div><div><dt>Заявки</dt><dd>{data.applications}</dd></div><div><dt>Покупки</dt><dd>{data.purchases}</dd></div><div><dt>Выручка</dt><dd>{money(data.revenue)}</dd></div></dl></article> })}</div>{!document.bot.trackingLinks.length ? <Empty text="Источники пока не созданы." /> : !links.length && <Empty text="Для выбранной платформы источников пока нет." />}</section>
}

function Products({ document }: { document: FunnelDocument }) {
  const values = Object.entries(document.analytics.products)
  return <section className="analytics-section compact-top"><div className="section-heading"><div><span className="eyebrow">Продажи</span><h2>Продукты и оплаты</h2></div></div>{values.length ? <div className="generic-metric-grid">{values.map(([id, data]) => { const product = document.products.find((item) => item.id === id); return <article key={id}><span><Package size={19} /></span><h3>{product?.name ?? 'Продукт'}</h3><div>{Object.entries(data).map(([name, value]) => <p key={name}><span>{metricLabel(name)}</span><strong>{name.includes('revenue') ? money(value) : value.toLocaleString('ru-RU')}</strong></p>)}</div></article> })}</div> : <Empty text="В снимке пока нет данных по продуктам и оплатам." />}</section>
}

function SimpleMetrics({ title, values, empty }: { title: string; values: Record<string, Record<string, number>>; empty: string }) {
  const entries = Object.values(values)
  return <section className="analytics-section compact-top"><div className="section-heading"><div><span className="eyebrow">Тест</span><h2>{title}</h2></div></div>{entries.length ? <div className="generic-metric-grid">{entries.map((data, index) => <article key={index}><span><BarChart3 size={19} /></span><h3>Вопрос {index + 1}</h3><div>{Object.entries(data).map(([name, value]) => <p key={name}><span>{metricLabel(name)}</span><strong>{value.toLocaleString('ru-RU')}</strong></p>)}</div></article>)}</div> : <Empty text={empty} />}</section>
}

function DataTables({ document }: { document: FunnelDocument }) {
  const [kind, setKind] = useState<'contacts' | 'applications'>('contacts')
  const [query, setQuery] = useState('')
  const rows = kind === 'contacts' ? document.analytics.contacts : document.analytics.applications
  const visible = useMemo(() => rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query.toLowerCase())), [rows, query])
  return <section className="analytics-section compact-top data-section"><div className="section-heading"><div><span className="eyebrow">Данные</span><h2>Контакты и заявки</h2></div><button className="button secondary" onClick={() => downloadText(kind === 'contacts' ? contactsCsv(document) : applicationsCsv(document), `${kind}-${document.funnel.key}.csv`, 'text/csv;charset=utf-8')}><Download size={15} /> CSV</button></div><div className="data-toolbar"><div><button className={kind === 'contacts' ? 'active' : ''} onClick={() => setKind('contacts')}>Контакты <span>{document.analytics.contacts.length}</span></button><button className={kind === 'applications' ? 'active' : ''} onClick={() => setKind('applications')}>Заявки <span>{document.analytics.applications.length}</span></button></div><label><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" /></label></div><div className="full-data-table"><table><thead><tr><th>Имя / контакт</th><th>Источник</th><th>Результат</th><th>Статус / дата</th></tr></thead><tbody>{visible.map((row) => { const record = row as Record<string, string | undefined>; return <tr key={row.id}><td><strong>{record.name || record.email || record.phone || record.contact || 'Без контакта'}</strong></td><td>{record.source || '—'}</td><td>{record.result || '—'}</td><td>{record.status || (record.createdAt ? formatShortDate(record.createdAt) : '—')}</td></tr> })}</tbody></table>{!visible.length && <Empty text="Записи не найдены." />}</div></section>
}

function Metric({ icon: Icon, label, value, note, color }: { icon: typeof Users; label: string; value: number | string; note: string; color: string }) { return <article className={`metric-card ${color}`}><div className="metric-icon"><Icon size={20} /></div><span>{label}</span><strong>{typeof value === 'number' ? value.toLocaleString('ru-RU') : value}</strong><small>{note}</small></article> }
function StageMetric({ label, value, danger }: { label: string; value: number; danger?: boolean }) { return <div className={`stage-metric ${danger ? 'danger' : ''}`}><span>{label}</span><strong>{value.toLocaleString('ru-RU')}</strong></div> }
function Empty({ text }: { text: string }) { return <div className="analytics-section-empty"><TrendingDown size={28} /><strong>{text}</strong></div> }
function metricLabel(value: string) { return ({ answered: 'Ответили', skipped: 'Пропустили', viewed: 'Увидели', paid: 'Оплатили', revenue: 'Выручка', started: 'Начали', completed: 'Завершили' } as Record<string, string>)[value] ?? value }
function money(value: number) { return `${new Intl.NumberFormat('ru-RU').format(value)} ₽` }
export function abCtr(clicked: number, shown: number) { return shown > 0 ? clicked / shown * 100 : 0 }
function formatDate(value: string) { return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(value)) }
function formatShortDate(value: string) { return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }
