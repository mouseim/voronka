import type {
  ChoiceData, ConditionData, FunnelAnalytics, FunnelDocument, FunnelNode, FunnelNodeData,
  FunnelSettings, MediaData, MessageData, NodeOption, NodeType, Position, QuestionData,
  RandomData, ResultBlockData, TestBlockData, VariableType,
} from './types'

export const SCHEMA_VERSION = '1.0.0' as const
export const LEGACY_SCHEMA_VERSION = '0.1.0'

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`

export const SYSTEM_VARIABLES: Array<{ key: string; name: string; type: VariableType; example: unknown }> = [
  { key: 'user.id', name: 'ID пользователя', type: 'string', example: 'demo_user_42' },
  { key: 'user.username', name: 'Username', type: 'string', example: '@demo_user' },
  { key: 'user.firstName', name: 'Имя', type: 'string', example: 'Анна' },
  { key: 'user.lastName', name: 'Фамилия', type: 'string', example: 'Соколова' },
  { key: 'user.phone', name: 'Телефон', type: 'string', example: '+7 900 000-00-00' },
  { key: 'platform', name: 'Платформа', type: 'string', example: 'telegram' },
  { key: 'source', name: 'Источник', type: 'string', example: 'reels_july' },
  { key: 'utm.source', name: 'UTM source', type: 'string', example: 'instagram' },
  { key: 'utm.medium', name: 'UTM medium', type: 'string', example: 'social' },
  { key: 'utm.campaign', name: 'UTM campaign', type: 'string', example: 'diagnostic' },
  { key: 'utm.content', name: 'UTM content', type: 'string', example: 'video_1' },
  { key: 'utm.term', name: 'UTM term', type: 'string', example: '' },
  { key: 'funnel.id', name: 'ID воронки', type: 'string', example: 'funnel_demo' },
  { key: 'funnel.key', name: 'Ключ воронки', type: 'string', example: 'inner_mechanisms' },
  { key: 'funnel.version', name: 'Версия', type: 'number', example: 1 },
  { key: 'session.id', name: 'ID сессии', type: 'string', example: 'session_demo' },
  { key: 'session.startedAt', name: 'Начало сессии', type: 'dateTime', example: '2026-07-18T09:00:00.000Z' },
  { key: 'session.lastActivityAt', name: 'Последняя активность', type: 'dateTime', example: '2026-07-18T12:00:00.000Z' },
  { key: 'now', name: 'Текущее время', type: 'dateTime', example: '2026-07-18T12:00:00.000Z' },
  { key: 'result.main', name: 'Главный результат', type: 'object', example: { code: 'S1', title: 'Исследователь' } },
  { key: 'result.secondary', name: 'Второй результат', type: 'object', example: { code: 'S2', title: 'Создатель' } },
  { key: 'result.isCombined', name: 'Комбинированный результат', type: 'boolean', example: true },
  { key: 'payment.status', name: 'Статус оплаты', type: 'string', example: 'not_started' },
  { key: 'payment.productKey', name: 'Ключ продукта', type: 'string', example: '' },
]

export function defaultSettings(): FunnelSettings {
  return {
    session: {
      inactivityDays: 30,
      expirationAction: 'finish',
      keepVersionForActiveUsers: true,
      reentryPolicy: 'continue',
      retakePolicy: 'allow',
      clearVariableKeys: [],
    },
    schedule: {
      timezone: 'Europe/Moscow',
      userTimezoneMode: 'funnel',
      fallbackTimezone: 'Europe/Moscow',
      quietHours: { enabled: true, from: '23:00', to: '09:00', behavior: 'postpone' },
      weeklyWindows: [],
      maxBackgroundTouchesPerDay: 2,
    },
    sources: { expected: [], labels: {}, initialValues: {} },
    optOut: {
      command: '/stop',
      finalText: 'Вы отписались от фоновых сообщений. Вернуться можно новым явным стартом.',
      blockBackground: true,
      allowExplicitRestart: true,
    },
  }
}

export function emptyAnalytics(version: number): FunnelAnalytics {
  return {
    snapshotAt: null,
    funnelVersion: version,
    period: { from: null, to: null },
    completeness: { level: 'aggregate', sections: [] },
    summary: { totalUsers: 0, started: 0, completed: 0, active: 0, optedOut: 0 },
    nodes: {},
    edges: {},
    tests: {},
    questions: {},
    results: {},
    products: {},
    payments: [],
    reminders: {},
    sources: {},
    contacts: [],
    applications: [],
    events: [],
    journeys: [],
  }
}

const option = (text: string): NodeOption => ({ id: newId('option'), text, value: text.toLowerCase().replace(/\s+/g, '_'), enabled: true, scoring: [] })
const quietHours = () => ({ enabled: false, from: '23:00', to: '09:00', behavior: 'postpone' as const })
const common = (title: string) => ({ title, note: '', enabled: true, analyticsTags: [], abGroup: '' })

export function createNode(type: NodeType, _legacyPosition?: Position): FunnelNode {
  const id = newId(type)
  const dataByType: Record<NodeType, FunnelNodeData> = {
    start: { ...common('Старт'), entryKey: 'main', sourceDescription: '', initialValues: {}, reentryPolicy: 'continue' },
    message: { ...common('Новое сообщение'), text: 'Введите текст сообщения', parseMode: 'markdown', buttons: [{ ...option('Продолжить'), action: 'transition', style: 'primary' }], continueWithoutButton: false },
    choice: { ...common('Новый выбор'), prompt: 'Выберите вариант', selectionMode: 'single', options: [option('Вариант 1')], minSelected: 1, maxSelected: 1, shuffle: false, sharedTransition: false, confirmText: 'Подтвердить', allowOther: false },
    question: { ...common('Новый вопрос'), question: 'Введите текст вопроса', inputType: 'single_choice', answers: [option('Ответ 1'), option('Ответ 2')], required: true, maxAttempts: 3, shuffle: false },
    test: { ...common('Прохождение теста'), testId: undefined, welcomeText: 'Начинаем тест', progressText: 'Вопрос {{current}} из {{total}}', showQuestionNumber: true, mode: 'one_by_one', allowBack: false, saveImmediately: true },
    condition: { ...common('Новое условие'), branches: [{ id: newId('branch'), name: 'Условие 1', isElse: false, condition: emptyConditionGroup() }, { id: newId('branch'), name: 'Иначе', isElse: true }] },
    set_variable: { ...common('Установить переменную'), actions: [{ id: newId('action'), type: 'assign', variableKey: '', value: '' }] },
    formula: { ...common('Новый расчёт'), expression: { id: newId('expr'), kind: 'number', value: 0 } },
    timer: { ...common('Новая задержка'), duration: 24, unit: 'hours', from: 'entry', continueMode: 'automatic', buttonText: 'Продолжить', quietHours: quietHours() },
    wait_until: { ...common('Ожидание времени'), mode: 'weekday', weekday: 1, time: '10:00', timezoneMode: 'funnel', pastBehavior: 'next_period', quietHours: quietHours() },
    reminder: { ...common('Новое напоминание'), text: 'Напоминаем продолжить', duration: 2, unit: 'hours', maxSends: 1, interval: 24, intervalUnit: 'hours', background: true, quietHours: quietHours(), eventKey: 'reminder' },
    media: { ...common('Новое медиа'), assetId: undefined, assetKey: '', caption: '', sendMode: 'single', required: true, missingBehavior: 'block' },
    form: { ...common('Новая форма'), description: '', fields: [{ id: newId('field'), label: 'Имя', type: 'name', required: true, variableKey: 'contact_name' }], submitText: 'Отправить', recordType: 'contact', consentRequired: false, analyticsEvent: 'form_submitted' },
    consent: { ...common('Согласие'), text: 'Я согласен(на) на обработку персональных данных', policyUrl: '', consentVersion: '1', acceptText: 'Согласен', declineEnabled: true, declineText: 'Не согласен', analyticsEvent: 'consent_decision' },
    result: { ...common('Результат теста'), resultSetId: undefined, singleTemplate: '{{result.main.title}}', combinedTemplate: '{{result.main.title}} + {{result.secondary.title}}', visibleFields: ['title', 'text', 'recommendations'], buttons: [], analyticsEvent: 'result_shown' } as ResultBlockData,
    product: { ...common('Предложение продукта'), productId: undefined, headline: 'Персональное предложение', description: '', displayPrice: '', payButtonText: 'Купить', allowSkip: true },
    external_link: { ...common('Внешняя ссылка'), url: 'https://', buttonText: 'Открыть', openExternal: true, linkType: 'website', sourceParams: {}, analyticsEvent: 'external_link_clicked' },
    random: { ...common('Случайное распределение'), branches: [{ id: newId('branch'), name: 'Вариант A', weight: 50 }, { id: newId('branch'), name: 'Вариант B', weight: 50 }], stableByUser: true } as RandomData,
    sub_funnel: { ...common('Другая воронка'), targetFunnelKey: '', targetEntryKey: 'main', variableKeys: [], missingBehavior: 'finish', analyticsEvent: 'sub_funnel_transition' },
    end: { ...common('Завершение'), text: 'Спасибо! Воронка завершена.', reasonCode: 'completed', sessionStatus: 'completed', clearVariableKeys: [], analyticsEvent: 'funnel_completed', reentryAction: 'show_result' },
    comment: { ...common('Комментарий'), text: 'Комментарий для команды', color: '#fff4bd' },
    group: { ...common('Группа'), color: '#e9edff', collapsed: false, childNodeIds: [] },
  }
  return { id, type, data: dataByType[type] }
}

export function emptyConditionGroup() {
  return {
    id: newId('condition_group'),
    kind: 'group' as const,
    logic: 'and' as const,
    not: false,
    children: [{
      id: newId('condition_rule'), kind: 'rule' as const,
      left: { kind: 'variable' as const, key: 'source' }, operator: 'filled' as const,
    }],
  }
}

export function createEmptyFunnel(name = 'Новая воронка'): FunnelDocument {
  const now = new Date().toISOString()
  const start = createNode('start')
  const key = slugify(name).replace(/-/g, '_')
  return {
    documentType: 'funnel',
    schemaVersion: SCHEMA_VERSION,
    project: { id: newId('project'), name, description: '' },
    funnel: {
      id: newId('funnel'), key, name, description: '', version: 1, status: 'draft',
      startNodeId: start.id, entryKey: 'main', tags: [], createdAt: now, updatedAt: now,
    },
    settings: defaultSettings(),
    variables: [],
    nodes: [start],
    edges: [],
    tests: [],
    resultSets: [],
    assets: [],
    products: [],
    testScenarios: [],
    analytics: emptyAnalytics(1),
    editor: { nodePositions: { [start.id]: { x: 100, y: 160 } }, collapsedNodeIds: [], groups: [], comments: [] },
  }
}

export function syncAssets(document: FunnelDocument): FunnelDocument {
  return document
}

export function createNewVersion(source: FunnelDocument, comment = ''): FunnelDocument {
  const previousVersion = source.funnel.version
  const version = previousVersion + 1
  const copy = structuredClone(source)
  copy.funnel = { ...copy.funnel, version, parentVersion: previousVersion, changeComment: comment, status: 'draft', updatedAt: new Date().toISOString() }
  copy.analytics = emptyAnalytics(version)
  copy.editor.lastValidation = undefined
  return copy
}

export function createTemplate(source: FunnelDocument): FunnelDocument {
  const copy = structuredClone(source)
  copy.analytics = emptyAnalytics(copy.funnel.version)
  return copy
}

export function duplicateFunnel(source: FunnelDocument): FunnelDocument {
  const now = new Date().toISOString()
  const copy = structuredClone(source)
  const suffix = crypto.randomUUID().slice(0, 6)
  copy.project = { ...copy.project, id: newId('project'), name: `${copy.project.name} — копия` }
  copy.funnel = { ...copy.funnel, id: newId('funnel'), key: `${copy.funnel.key}_copy_${suffix}`, name: `${copy.funnel.name} — копия`, version: 1, parentVersion: undefined, changeComment: undefined, status: 'draft', createdAt: now, updatedAt: now }
  copy.analytics = emptyAnalytics(1)
  return copy
}

export function outgoingEdge(document: FunnelDocument, nodeId: string, handle?: string) {
  return document.edges.find((edge) => edge.source === nodeId && (handle === undefined || (edge.sourceHandle ?? 'next') === handle))
}

export function nodeTitle(node: FunnelNode): string {
  return typeof node.data.title === 'string' && node.data.title.trim() ? node.data.title : node.id
}

export function nodePosition(document: FunnelDocument, nodeId: string): Position {
  const legacy = document.nodes.find((node) => node.id === nodeId)?.position
  return document.editor.nodePositions[nodeId] ?? legacy ?? { x: 0, y: 0 }
}

export function nodeHandles(node: FunnelNode): Array<{ id: string; label: string }> {
  if (node.type === 'message') return (node.data as MessageData).buttons.filter((button) => button.action === 'transition' || button.action === 'set_variable').map((button) => ({ id: button.id, label: button.text }))
  if (node.type === 'choice') {
    const data = node.data as ChoiceData
    return data.sharedTransition ? [{ id: 'confirmed', label: data.confirmText }] : data.options.filter((item) => item.enabled !== false).map((item) => ({ id: item.id, label: item.text }))
  }
  if (node.type === 'question') {
    const data = node.data as QuestionData
    const answerHandles = ['single_choice', 'multiple_choice', 'yes_no'].includes(data.inputType)
      ? data.answers.filter((item) => item.enabled !== false).map((item) => ({ id: item.id, label: item.text }))
      : [{ id: 'success', label: 'Ответ принят' }]
    return [...answerHandles, { id: 'attempts_exceeded', label: 'Попытки закончились' }]
  }
  if (node.type === 'test') return [{ id: 'completed', label: 'Тест завершён' }, { id: 'cancelled', label: 'Тест отменён' }]
  if (node.type === 'condition') return (node.data as ConditionData).branches.map((branch) => ({ id: branch.id, label: branch.name }))
  if (node.type === 'timer') return [{ id: 'next', label: 'После задержки' }, { id: 'cancelled', label: 'Отмена' }]
  if (node.type === 'form') return [{ id: 'success', label: 'Отправлено' }, { id: 'cancelled', label: 'Отмена' }]
  if (node.type === 'consent') return [{ id: 'accepted', label: 'Принято' }, { id: 'declined', label: 'Отказ' }]
  if (node.type === 'product') return [{ id: 'success', label: 'Успешно' }, { id: 'failure', label: 'Ошибка' }, { id: 'cancelled', label: 'Отмена' }, { id: 'already_purchased', label: 'Уже куплено' }, { id: 'skip', label: 'Без покупки' }]
  if (node.type === 'random') return (node.data as RandomData).branches.map((branch) => ({ id: branch.id, label: branch.name }))
  if (['end', 'sub_funnel', 'comment', 'group'].includes(node.type)) return []
  return [{ id: 'next', label: 'Далее' }]
}

export function edgeLabel(document: FunnelDocument, sourceId: string, handle: string | null | undefined): string | undefined {
  const node = document.nodes.find((candidate) => candidate.id === sourceId)
  if (!node || !handle) return undefined
  return nodeHandles(node).find((item) => item.id === handle)?.label
}

export function slugify(value: string): string {
  const transliteration: Record<string, string> = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' }
  return value.toLowerCase().split('').map((char) => transliteration[char] ?? char).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'funnel'
}

export function analyticsForNode(document: FunnelDocument, nodeId: string) {
  const metric = document.analytics.nodes[nodeId] ?? { entered: 0, completed: 0 }
  const entered = metric.entered ?? 0
  const completed = metric.completed ?? 0
  const dropped = metric.dropped ?? Math.max(0, entered - completed)
  const conversion = entered > 0 ? (completed / entered) * 100 : 0
  return { entered, completed, dropped, conversion }
}

export function referencedVariableKeys(document: FunnelDocument): Set<string> {
  const serialized = JSON.stringify({ nodes: document.nodes, tests: document.tests, products: document.products, settings: document.settings })
  return new Set(document.variables.filter((variable) => serialized.includes(`\"${variable.key}\"`)).map((variable) => variable.key))
}

export function referencedAssetIds(document: FunnelDocument): Set<string> {
  const serialized = JSON.stringify({ nodes: document.nodes, tests: document.tests, products: document.products, resultSets: document.resultSets })
  return new Set(document.assets.filter((asset) => serialized.includes(`\"${asset.id}\"`) || serialized.includes(`\"${asset.assetKey}\"`)).map((asset) => asset.id))
}

export function referencedTestIds(document: FunnelDocument): Set<string> {
  return new Set(document.nodes.filter((node) => node.type === 'test').map((node) => (node.data as TestBlockData).testId).filter((value): value is string => Boolean(value)))
}

export function mediaNodeAsset(node: FunnelNode, document: FunnelDocument) {
  if (node.type !== 'media') return undefined
  const data = node.data as MediaData
  return document.assets.find((asset) => asset.id === data.assetId || asset.assetKey === data.assetKey)
}
