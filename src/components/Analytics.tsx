import { ArrowLeft, ArrowRight, BarChart3, CheckCircle2, Clock3, Edit3, Eye, TrendingUp, Users, XCircle } from 'lucide-react'
import { analyticsForNode, nodeTitle } from '../model/funnel'
import type { FunnelDocument } from '../model/types'
import { nodeMeta } from './nodeMeta'

interface AnalyticsProps {
  document: FunnelDocument
  onBack: () => void
  onEdit: () => void
}

export function Analytics({ document, onBack, onEdit }: AnalyticsProps) {
  const analytics = document.analytics
  const started = analytics.summary.started ?? 0
  const completed = analytics.summary.completed ?? 0
  const total = analytics.summary.totalUsers ?? started
  const conversion = started ? (completed / started) * 100 : 0

  return (
    <div className="analytics-page">
      <header className="analytics-header app-header">
        <button className="brand-button" onClick={onBack}><span className="brand-mark">В</span><span><strong>Воронка</strong><small>конструктор</small></span></button>
        <div className="header-divider" />
        <div className="analytics-title"><span>Статистика</span><strong>{document.funnel.name}</strong></div>
        <button className="button secondary" onClick={onEdit}><Edit3 size={16} /> Редактировать</button>
      </header>
      <main className="analytics-content">
        <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> К моим воронкам</button>
        <div className="analytics-hero">
          <div><span className="eyebrow">Снимок данных</span><h1>Как работает воронка</h1><p>Версия {analytics.funnelVersion} · {analytics.snapshotAt ? formatDate(analytics.snapshotAt) : 'статистика ещё не загружена'}</p></div>
          {analytics.snapshotAt && <div className="snapshot-badge"><Clock3 size={16} /> Данные не обновляются автоматически</div>}
        </div>

        {!analytics.snapshotAt ? (
          <div className="analytics-empty">
            <div><BarChart3 size={40} /></div>
            <h2>В этом файле ещё нет статистики</h2>
            <p>Она появится после использования воронки в Telegram-боте и последующего экспорта.</p>
            <button className="button primary" onClick={onEdit}><Edit3 size={16} /> Вернуться в редактор</button>
          </div>
        ) : (
          <>
            <section className="metric-grid">
              <Metric icon={Users} label="Всего пользователей" value={total.toLocaleString('ru-RU')} note={`${started} начали воронку`} color="blue" />
              <Metric icon={Eye} label="Начали" value={started.toLocaleString('ru-RU')} note={`${Math.max(0, total - started)} не дошли до старта`} color="violet" />
              <Metric icon={CheckCircle2} label="Завершили" value={completed.toLocaleString('ru-RU')} note={`${Math.max(0, started - completed)} не завершили`} color="green" />
              <Metric icon={TrendingUp} label="Общая конверсия" value={`${conversion.toFixed(1)}%`} note="от начавших до завершения" color="orange" />
            </section>

            <section className="analytics-section">
              <div className="section-heading"><div><span className="eyebrow">Этапы</span><h2>Прохождение по блокам</h2></div><span className="muted-text">{document.nodes.length} блоков</span></div>
              <div className="stage-list">
                {document.nodes.map((node, index) => {
                  const metric = analyticsForNode(document, node.id)
                  const meta = nodeMeta[node.type]
                  const Icon = meta.icon
                  return <article className="stage-card" key={node.id}>
                    <div className="stage-number">{index + 1}</div>
                    <span className="node-type-icon" style={{ color: meta.color, background: meta.background }}><Icon size={18} /></span>
                    <div className="stage-name"><strong>{nodeTitle(node)}</strong><span>{meta.label}</span></div>
                    <StageMetric label="Вошли" value={metric.entered} />
                    <StageMetric label="Завершили" value={metric.completed} />
                    <StageMetric label="Отсеялись" value={metric.dropped} danger={metric.dropped > 0} />
                    <div className="stage-conversion"><span><b>Конверсия</b><strong>{metric.conversion.toFixed(1)}%</strong></span><div><i style={{ width: `${Math.min(100, metric.conversion)}%` }} /></div></div>
                  </article>
                })}
              </div>
            </section>

            <section className="analytics-section">
              <div className="section-heading"><div><span className="eyebrow">Маршруты</span><h2>Переходы по связям</h2></div></div>
              <div className="edge-stats">
                {document.edges.map((edge) => {
                  const source = document.nodes.find((node) => node.id === edge.source)
                  const target = document.nodes.find((node) => node.id === edge.target)
                  return <div className="edge-stat-row" key={edge.id}><span>{source ? nodeTitle(source) : edge.source}</span><ArrowRight size={16} /><span>{target ? nodeTitle(target) : edge.target}</span><strong>{analytics.edges[edge.id]?.transitions ?? 0} переходов</strong></div>
                })}
              </div>
            </section>

            {(analytics.contacts.length > 0 || analytics.applications.length > 0) && <DataTables document={document} />}
          </>
        )}
      </main>
    </div>
  )
}

function Metric({ icon: Icon, label, value, note, color }: { icon: typeof Users; label: string; value: string; note: string; color: string }) {
  return <article className={`metric-card ${color}`}><div className="metric-icon"><Icon size={20} /></div><span>{label}</span><strong>{value}</strong><small>{note}</small></article>
}

function StageMetric({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return <div className={`stage-metric ${danger ? 'danger' : ''}`}><span>{label}</span><strong>{value.toLocaleString('ru-RU')}</strong></div>
}

function DataTables({ document }: { document: FunnelDocument }) {
  const { contacts, applications } = document.analytics
  return <section className="analytics-section data-section">
    <div className="section-heading"><div><span className="eyebrow">Данные</span><h2>Контакты и заявки</h2></div></div>
    <div className="data-grid">
      <div className="data-table-wrap"><h3>Контакты <span>{contacts.length}</span></h3>{contacts.length ? <table><thead><tr><th>Имя</th><th>Контакт</th><th>Дата</th></tr></thead><tbody>{contacts.map((contact) => <tr key={contact.id}><td><strong>{contact.name || 'Без имени'}</strong><small>{contact.username}</small></td><td>{contact.email || contact.phone || '—'}</td><td>{contact.createdAt ? formatShortDate(contact.createdAt) : '—'}</td></tr>)}</tbody></table> : <p className="table-empty">Контактов нет</p>}</div>
      <div className="data-table-wrap"><h3>Заявки <span>{applications.length}</span></h3>{applications.length ? <table><thead><tr><th>Статус</th><th>Комментарий</th><th>Дата</th></tr></thead><tbody>{applications.map((item) => <tr key={item.id}><td><span className="status-pill">{item.status || 'Новая'}</span></td><td>{item.comment || '—'}</td><td>{item.createdAt ? formatShortDate(item.createdAt) : '—'}</td></tr>)}</tbody></table> : <p className="table-empty">Заявок нет</p>}</div>
    </div>
  </section>
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(value))
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}
