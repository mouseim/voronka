import type {
  BotSettings,
  FunnelAnalytics,
  FunnelDocument,
  FunnelNode,
  FunnelNodeData,
  MediaData,
  MessageData,
  NodeHandle,
  NodeType,
  Position,
  ProductBlockData,
  TestBlockData,
} from './types'

export const SCHEMA_VERSION = '2.0.0' as const

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`

export function slugify(value: string): string {
  const transliteration: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh',
    щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  }
  return value.toLowerCase().split('').map((character) => transliteration[character] ?? character)
    .join('').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'funnel'
}

export function defaultBotSettings(): BotSettings {
  return {
    displayName: 'Моя воронка',
    username: '',
    timezone: 'Europe/Moscow',
    inactivityDays: 30,
    quietHours: { enabled: true, from: '23:00', to: '09:00', behavior: 'postpone' },
    reentryPolicy: 'continue',
    optOut: {
      command: '/stop',
      confirmationText: 'Вы отписались от фоновых сообщений.',
      blockBackground: true,
      allowRestart: true,
    },
    reminders: { maxCount: 3, cancelAfterContinue: true, respectQuietHours: true },
    trackingLinks: [],
  }
}

export function emptyAnalytics(version: number): FunnelAnalytics {
  return {
    snapshotAt: null,
    funnelVersion: version,
    summary: { totalUsers: 0, started: 0, completed: 0, applications: 0, purchases: 0, revenue: 0 },
    nodes: {},
    tests: {},
    questions: {},
    results: {},
    products: {},
    sources: {},
    contacts: [],
    applications: [],
  }
}

export function createNode(type: NodeType, _position?: Position): FunnelNode {
  const id = newId(type)
  const dataByType: Record<NodeType, FunnelNodeData> = {
    start: { title: 'Старт' },
    message: { title: 'Новое сообщение', text: 'Введите текст сообщения', buttons: [] },
    media: { title: 'Материал', assetId: undefined, caption: '', required: true },
    timer: { title: 'Пауза', duration: 1, unit: 'hours', respectQuietHours: true },
    test: { title: 'Психологический тест', testId: undefined, welcomeText: 'Давайте узнаем ваш результат' },
    form: {
      title: 'Форма заявки',
      introText: 'Оставьте данные, и мы свяжемся с вами.',
      fields: [{ id: newId('field'), type: 'name', label: 'Имя', required: true }],
      submitText: 'Отправить',
      confirmationText: 'Спасибо! Заявка отправлена.',
    },
    consent: {
      title: 'Согласие',
      text: 'Я согласен(на) на обработку персональных данных.',
      policyUrl: '',
      acceptText: 'Согласен',
      declineEnabled: true,
      declineText: 'Не согласен',
    },
    product: {
      title: 'Предложение',
      productId: undefined,
      headline: 'Персональное предложение',
      description: '',
      price: 0,
      payButtonText: 'Оплатить',
      allowSkip: true,
    },
    external_link: {
      title: 'Внешняя ссылка',
      text: 'Перейдите по ссылке',
      buttonText: 'Открыть',
      url: 'https://',
      continueAfterClick: true,
    },
    end: { title: 'Завершение', text: 'Спасибо! Воронка завершена.' },
  }
  return { id, type, data: dataByType[type] }
}

export function createEmptyFunnel(name = 'Новая воронка'): FunnelDocument {
  const now = new Date().toISOString()
  const start = createNode('start')
  return {
    documentType: 'funnel',
    schemaVersion: SCHEMA_VERSION,
    project: { id: newId('project'), name, description: '' },
    funnel: {
      id: newId('funnel'),
      key: slugify(name).replace(/-/g, '_'),
      name,
      description: '',
      version: 1,
      status: 'draft',
      startNodeId: start.id,
      createdAt: now,
      updatedAt: now,
    },
    bot: { ...defaultBotSettings(), displayName: name },
    nodes: [start],
    edges: [],
    tests: [],
    assets: [],
    products: [],
    analytics: emptyAnalytics(1),
    editor: { nodePositions: { [start.id]: { x: 100, y: 160 } }, collapsedNodeIds: [] },
  }
}

export function createNewVersion(source: FunnelDocument, comment = ''): FunnelDocument {
  const copy = structuredClone(source)
  const previousVersion = source.funnel.version
  copy.funnel = {
    ...copy.funnel,
    version: previousVersion + 1,
    parentVersion: previousVersion,
    changeComment: comment,
    status: 'draft',
    updatedAt: new Date().toISOString(),
  }
  copy.analytics = emptyAnalytics(copy.funnel.version)
  return copy
}

export function createTemplate(source: FunnelDocument): FunnelDocument {
  const copy = structuredClone(source)
  copy.analytics = emptyAnalytics(copy.funnel.version)
  return copy
}

export function duplicateFunnel(source: FunnelDocument): FunnelDocument {
  const copy = structuredClone(source)
  const now = new Date().toISOString()
  const suffix = crypto.randomUUID().slice(0, 6)
  copy.project = { ...copy.project, id: newId('project'), name: `${copy.project.name} — копия` }
  copy.funnel = {
    ...copy.funnel,
    id: newId('funnel'),
    key: `${copy.funnel.key}_copy_${suffix}`,
    name: `${copy.funnel.name} — копия`,
    version: 1,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    parentVersion: undefined,
    changeComment: undefined,
  }
  copy.analytics = emptyAnalytics(1)
  return copy
}

export function nodePosition(document: FunnelDocument, nodeId: string): Position {
  return document.editor.nodePositions[nodeId]
    ?? document.nodes.find((node) => node.id === nodeId)?.position
    ?? { x: 0, y: 0 }
}

export function nodeTitle(node: FunnelNode): string {
  return node.data.title.trim() || 'Без названия'
}

export function nodeHandles(node: FunnelNode, document?: FunnelDocument): NodeHandle[] {
  if (node.type === 'message') {
    const branches = (node.data as MessageData).buttons.filter((button) => button.action === 'branch')
    return branches.length ? branches.map((button) => ({ id: button.id, label: button.text || 'Кнопка' })) : [{ id: 'next', label: 'Далее' }]
  }
  if (node.type === 'test') {
    const test = document?.tests.find((item) => item.id === (node.data as TestBlockData).testId)
    if (!test) return []
    return [
      ...test.results.map((result) => ({ id: result.id, label: result.name })),
      ...test.combinedResults.map((result) => ({ id: result.id, label: result.name })),
    ]
  }
  if (node.type === 'consent') {
    const data = node.data as { declineEnabled: boolean }
    return data.declineEnabled
      ? [{ id: 'accepted', label: 'Согласился' }, { id: 'declined', label: 'Отказался' }]
      : [{ id: 'accepted', label: 'Согласился' }]
  }
  if (node.type === 'product') {
    const data = node.data as ProductBlockData
    const handles: NodeHandle[] = [
      { id: 'paid', label: 'Оплачено' },
      { id: 'failed', label: 'Ошибка или отмена' },
      { id: 'already_purchased', label: 'Уже куплено' },
    ]
    if (data.allowSkip) handles.push({ id: 'skip', label: 'Без покупки' })
    return handles
  }
  if (node.type === 'form') return [{ id: 'submitted', label: 'Форма отправлена' }, { id: 'cancelled', label: 'Отмена' }]
  if (node.type === 'end') return []
  return [{ id: 'next', label: node.type === 'timer' ? 'После паузы' : 'Далее' }]
}

export function edgeLabel(document: FunnelDocument, sourceId: string, handle: string | null | undefined): string | undefined {
  const source = document.nodes.find((node) => node.id === sourceId)
  if (!source) return undefined
  return nodeHandles(source, document).find((item) => item.id === (handle ?? 'next'))?.label
}

export function syncAssets(document: FunnelDocument): FunnelDocument {
  return document
}

export function referencedAssetIds(document: FunnelDocument): Set<string> {
  const ids = new Set<string>()
  document.nodes.forEach((node) => {
    if (node.type === 'media' && (node.data as MediaData).assetId) ids.add((node.data as MediaData).assetId!)
  })
  document.products.forEach((product) => { if (product.assetId) ids.add(product.assetId) })
  document.tests.forEach((test) => {
    ;[...test.results, ...test.combinedResults].forEach((result) => { if (result.assetId) ids.add(result.assetId) })
  })
  return ids
}

export function assetUsageCount(document: FunnelDocument, assetId: string): number {
  let count = 0
  document.nodes.forEach((node) => { if (node.type === 'media' && (node.data as MediaData).assetId === assetId) count += 1 })
  document.products.forEach((product) => { if (product.assetId === assetId) count += 1 })
  document.tests.forEach((test) => {
    ;[...test.results, ...test.combinedResults].forEach((result) => { if (result.assetId === assetId) count += 1 })
  })
  return count
}

export function productUsageCount(document: FunnelDocument, productId: string): number {
  let count = document.nodes.filter((node) => node.type === 'product' && (node.data as ProductBlockData).productId === productId).length
  document.nodes.forEach((node) => {
    if (node.type === 'message') count += (node.data as MessageData).buttons.filter((button) => button.productId === productId).length
  })
  return count
}

export function trackingCodeBase(source: string, campaign: string): string {
  const joined = [source, campaign].map((part) => slugify(part).replace(/-/g, '_')).filter(Boolean).join('_')
  return (joined || 'source').slice(0, 48)
}

export function uniqueTrackingCode(document: FunnelDocument, source: string, campaign: string): string {
  const base = trackingCodeBase(source, campaign)
  const used = new Set(document.bot.trackingLinks.map((link) => link.code))
  if (!used.has(base)) return base
  let suffix = 2
  while (used.has(`${base}_${suffix}`)) suffix += 1
  return `${base}_${suffix}`
}

export function telegramDeepLink(username: string, code: string): string | null {
  const cleanUsername = username.trim().replace(/^@/, '')
  if (!cleanUsername) return null
  return `https://t.me/${cleanUsername}?start=${encodeURIComponent(code)}`
}

export function addMessageBranch(document: FunnelDocument, nodeId: string, text = 'Новая кнопка') {
  const copy = structuredClone(document)
  const node = copy.nodes.find((item) => item.id === nodeId)
  if (!node || node.type !== 'message') throw new Error('Сообщение не найдено.')
  const id = newId('button')
  ;(node.data as MessageData).buttons.push({ id, text, action: 'branch' })
  return { document: copy, buttonId: id }
}

export function renameMessageButton(document: FunnelDocument, nodeId: string, buttonId: string, text: string): FunnelDocument {
  const copy = structuredClone(document)
  const node = copy.nodes.find((item) => item.id === nodeId)
  if (!node || node.type !== 'message') throw new Error('Сообщение не найдено.')
  const button = (node.data as MessageData).buttons.find((item) => item.id === buttonId)
  if (!button) throw new Error('Кнопка не найдена.')
  button.text = text
  copy.edges.filter((edge) => edge.source === nodeId && edge.sourceHandle === buttonId).forEach((edge) => { edge.label = text })
  return copy
}

export function removeMessageButton(document: FunnelDocument, nodeId: string, buttonId: string): FunnelDocument {
  const copy = structuredClone(document)
  const node = copy.nodes.find((item) => item.id === nodeId)
  if (!node || node.type !== 'message') throw new Error('Сообщение не найдено.')
  ;(node.data as MessageData).buttons = (node.data as MessageData).buttons.filter((item) => item.id !== buttonId)
  copy.edges = copy.edges.filter((edge) => !(edge.source === nodeId && edge.sourceHandle === buttonId))
  return copy
}

export function analyticsForNode(document: FunnelDocument, nodeId: string) {
  const metric = document.analytics.nodes[nodeId] ?? { entered: 0, completed: 0 }
  const entered = metric.entered ?? 0
  const completed = metric.completed ?? 0
  return {
    entered,
    completed,
    dropped: metric.dropped ?? Math.max(0, entered - completed),
    conversion: entered ? completed / entered * 100 : 0,
  }
}
