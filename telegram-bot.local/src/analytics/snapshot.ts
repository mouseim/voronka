import type { FunnelDocument } from '../core/shared'
import type { DatabasePool } from '../db/pool'

export async function buildAnalyticsSnapshot(pool: DatabasePool, versionId: string): Promise<FunnelDocument> {
  const versionResult = await pool.query<{ raw_document: FunnelDocument }>('SELECT raw_document FROM funnel_versions WHERE id = $1', [versionId])
  const source = versionResult.rows[0]?.raw_document
  if (!source) throw new Error('VERSION_NOT_FOUND')
  const document = structuredClone(source)

  const [sessionStats, nodeStats, eventStats, contacts, applications, payments] = await Promise.all([
    pool.query<{
      total_users: string
      started: string
      completed: string
    }>(`
      SELECT count(DISTINCT user_id)::text AS total_users,
             count(*)::text AS started,
             count(*) FILTER (WHERE status = 'completed')::text AS completed
      FROM sessions WHERE version_id = $1
    `, [versionId]),
    pool.query<{ node_id: string; entered: string; completed: string }>(`
      SELECT node_id,
             count(*) FILTER (WHERE event_type = 'node_entered')::text AS entered,
             count(*) FILTER (WHERE event_type = 'node_completed')::text AS completed
      FROM analytics_events
      WHERE version_id = $1 AND node_id IS NOT NULL AND event_type IN ('node_entered', 'node_completed')
      GROUP BY node_id
    `, [versionId]),
    pool.query<{ event_type: string; tracking_id: string | null; payload: Record<string, unknown>; count: string }>(`
      SELECT event_type, tracking_id, payload, count(*)::text AS count
      FROM analytics_events
      WHERE version_id = $1
      GROUP BY event_type, tracking_id, payload
    `, [versionId]),
    pool.query<{ id: string; fields: Record<string, string>; source_tracking_id: string | null; result_id: string | null; created_at: Date }>(`
      SELECT id, fields, source_tracking_id, result_id, created_at
      FROM contacts WHERE version_id = $1 ORDER BY created_at
    `, [versionId]),
    pool.query<{ id: string; status: string; payload: Record<string, string>; source_tracking_id: string | null; result_id: string | null; created_at: Date }>(`
      SELECT a.id, a.status, a.payload, c.source_tracking_id, c.result_id, a.created_at
      FROM applications a
      JOIN contacts c ON c.id = a.contact_id
      WHERE c.version_id = $1 ORDER BY a.created_at
    `, [versionId]),
    pool.query<{ product_id: string; currency: string; amount_minor: number; status: string; paid_at: Date | null }>(`
      SELECT product_id, currency, amount_minor, status, paid_at
      FROM payments WHERE version_id = $1
    `, [versionId]),
  ])

  const session = sessionStats.rows[0] ?? { total_users: '0', started: '0', completed: '0' }
  const successful = payments.rows.filter((payment) => payment.status === 'paid')
  const revenueByCurrency = sumBy(successful, (payment) => payment.currency, (payment) => payment.amount_minor)
  const rubRevenue = (revenueByCurrency.RUB ?? 0) / 100
  document.analytics = {
    snapshotAt: new Date().toISOString(),
    funnelVersion: document.funnel.version,
    summary: {
      totalUsers: Number(session.total_users),
      started: Number(session.started),
      completed: Number(session.completed),
      applications: applications.rowCount ?? 0,
      purchases: successful.length,
      revenue: rubRevenue,
    },
    nodes: Object.fromEntries(nodeStats.rows.map((row) => {
      const entered = Number(row.entered)
      const completed = Number(row.completed)
      return [row.node_id, { entered, completed, dropped: Math.max(0, entered - completed) }]
    })),
    tests: aggregatePayload(eventStats.rows, ['test_started', 'test_completed'], 'testId') as Record<string, Record<string, number>>,
    questions: aggregatePayload(eventStats.rows, ['question_answered'], 'questionId') as Record<string, Record<string, number>>,
    results: aggregatePayload(eventStats.rows, ['result_viewed'], 'resultId', 'name'),
    abButtons: abButtonSnapshot(document, eventStats.rows),
    products: productSnapshot(document, eventStats.rows, payments.rows),
    sources: sourceSnapshot(document, eventStats.rows),
    contacts: contacts.rows.map((row) => contactForFunnel(document, row)),
    applications: applications.rows.map((row) => ({
      id: row.id,
      contact: Object.values(row.payload).filter(Boolean).join(' · '),
      source: row.source_tracking_id ?? undefined,
      status: row.status,
      result: row.result_id ?? undefined,
      createdAt: new Date(row.created_at).toISOString(),
      comment: '',
    })),
  }
  ;(document.analytics as unknown as Record<string, unknown>).paymentCurrencies = Object.fromEntries(
    Object.entries(revenueByCurrency).map(([currency, amountMinor]) => [currency, { amountMinor }]),
  )
  return document
}

export function abButtonSnapshot(
  document: FunnelDocument,
  events: Array<{ event_type: string; payload: Record<string, unknown>; count: string }>,
) {
  const result: NonNullable<FunnelDocument['analytics']['abButtons']> = {}

  const add = (buttonId: string, contextId: string, contextLabel: string, textA: string, textB?: string) => {
    if (!textB?.trim()) return
    result[buttonId] = {
      buttonId,
      resultId: contextId,
      contextLabel,
      A: { text: textA, shown: 0, clicked: 0 },
      B: { text: textB, shown: 0, clicked: 0 },
    }
  }

  for (const node of document.nodes ?? []) {
    const title = String(node.data.title || 'Этап')
    if (node.type === 'message') {
      const data = node.data as { buttons: Array<{ id: string; text: string; abText?: string }> }
      data.buttons.forEach((button) => add(button.id, node.id, title, button.text, button.abText))
    }
    if (node.type === 'consent') {
      const data = node.data as { acceptText: string; acceptAbText?: string; declineText: string; declineAbText?: string; declineEnabled: boolean }
      add(`${node.id}:accept`, node.id, `${title} · согласие`, data.acceptText, data.acceptAbText)
      if (data.declineEnabled) add(`${node.id}:decline`, node.id, `${title} · отказ`, data.declineText, data.declineAbText)
    }
    if (node.type === 'product') {
      const data = node.data as { payButtonText: string; payButtonAbText?: string }
      add(`${node.id}:pay`, node.id, `${title} · оплата`, data.payButtonText, data.payButtonAbText)
    }
    if (node.type === 'external_link') {
      const data = node.data as { buttonText: string; buttonAbText?: string }
      add(`${node.id}:link`, node.id, `${title} · ссылка`, data.buttonText, data.buttonAbText)
    }
  }

  for (const test of document.tests ?? []) {
    for (const testResult of [...test.results, ...test.combinedResults]) {
      for (const button of testResult.buttons) {
        add(button.id, testResult.id, `Результат · ${testResult.name}`, button.text, button.abText)
      }
    }
  }

  for (const event of events.filter((item) => item.event_type === 'ab_button_shown' || item.event_type === 'ab_button_clicked')) {
    const entry = result[String(event.payload.buttonId ?? '')]
    const variant = event.payload.variant === 'A' || event.payload.variant === 'B' ? event.payload.variant : null
    if (!entry || !variant) continue
    const metric = event.event_type === 'ab_button_shown' ? 'shown' : 'clicked'
    entry[variant][metric] += Number(event.count)
  }

  return result
}

function aggregatePayload(
  rows: Array<{ event_type: string; payload: Record<string, unknown>; count: string }>,
  eventTypes: string[],
  idField: string,
  nameField?: string,
) {
  const result: Record<string, Record<string, number | string>> = {}
  rows.filter((row) => eventTypes.includes(row.event_type)).forEach((row) => {
    const id = String(row.payload[idField] ?? '')
    if (!id) return
    result[id] ??= {}
    const metric = eventName(row.event_type)
    result[id]![metric] = Number(result[id]![metric] ?? 0) + Number(row.count)
    if (nameField && row.payload[nameField]) result[id]!.name = String(row.payload[nameField])
  })
  return result
}

function eventName(eventType: string) {
  if (eventType.endsWith('_started')) return 'started'
  if (eventType.endsWith('_completed')) return 'completed'
  if (eventType === 'question_answered') return 'answered'
  if (eventType === 'result_viewed') return 'users'
  return eventType
}

function productSnapshot(
  document: FunnelDocument,
  events: Array<{ event_type: string; payload: Record<string, unknown>; count: string }>,
  payments: Array<{ product_id: string; currency: string; amount_minor: number; status: string }>,
) {
  const result: Record<string, Record<string, number>> = Object.fromEntries(
    document.products.map((product) => [product.id, { viewed: 0, paid: 0, revenue: 0 }]),
  )
  events.filter((event) => event.event_type === 'product_viewed').forEach((event) => {
    const productId = String(event.payload.productId ?? '')
    if (result[productId]) result[productId]!.viewed += Number(event.count)
  })
  payments.forEach((payment) => {
    const metric = result[payment.product_id] ??= { viewed: 0, paid: 0, revenue: 0 }
    if (payment.status === 'paid') {
      metric.paid += 1
      if (payment.currency === 'RUB') metric.revenue += payment.amount_minor / 100
    }
  })
  return result
}

function sourceSnapshot(
  document: FunnelDocument,
  events: Array<{ event_type: string; tracking_id: string | null; payload: Record<string, unknown>; count: string }>,
) {
  const result = Object.fromEntries(document.bot.trackingLinks.map((link) => [link.id, {
    arrived: 0,
    started: 0,
    completed: 0,
    applications: 0,
    purchases: 0,
    revenue: 0,
  }]))
  events.filter((event) => event.tracking_id && result[event.tracking_id]).forEach((event) => {
    const metric = result[event.tracking_id!]!
    const count = Number(event.count)
    if (event.event_type === 'source_attributed') metric.arrived += count
    if (event.event_type === 'session_started') metric.started += count
    if (event.event_type === 'session_completed') metric.completed += count
    if (event.event_type === 'application_created') metric.applications += count
    if (event.event_type === 'payment_succeeded') {
      metric.purchases += count
      if (event.payload.currency === 'RUB') metric.revenue += Number(event.payload.amountMinor ?? 0) * count / 100
    }
  })
  return result
}

function contactForFunnel(
  document: FunnelDocument,
  row: { id: string; fields: Record<string, string>; source_tracking_id: string | null; result_id: string | null; created_at: Date },
) {
  const fieldTypes = new Map(document.nodes.flatMap((node) => node.type === 'form'
    ? (node.data as { fields: Array<{ id: string; type: string }> }).fields.map((field) => [field.id, field.type] as const)
    : []))
  const byType = Object.fromEntries(Object.entries(row.fields).map(([id, value]) => [fieldTypes.get(id) ?? id, value]))
  return {
    id: row.id,
    name: byType.name,
    username: byType.username,
    phone: byType.phone,
    email: byType.email,
    source: row.source_tracking_id ?? undefined,
    result: row.result_id ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

function sumBy<T>(items: T[], key: (item: T) => string, value: (item: T) => number) {
  const result: Record<string, number> = {}
  items.forEach((item) => { result[key(item)] = (result[key(item)] ?? 0) + value(item) })
  return result
}
