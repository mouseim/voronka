import type {
  ChoiceData,
  FunnelAnalytics,
  FunnelAsset,
  FunnelDocument,
  FunnelNode,
  MediaData,
  NodeType,
  QuestionData,
} from './types'

export const SCHEMA_VERSION = '0.1.0'

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`

export function emptyAnalytics(version: number): FunnelAnalytics {
  return {
    snapshotAt: null,
    funnelVersion: version,
    summary: { totalUsers: 0, started: 0, completed: 0 },
    nodes: {},
    edges: {},
    questions: {},
    contacts: [],
    applications: [],
  }
}

export function createNode(type: NodeType, position: { x: number; y: number }): FunnelNode {
  const id = newId(type)
  const option = (text: string) => ({ id: newId('option'), text })
  const dataByType = {
    start: { title: 'Старт', note: 'Точка входа в воронку' },
    message: { title: 'Новое сообщение', text: 'Введите текст сообщения', note: '', continueEnabled: true, buttonText: 'Продолжить' },
    choice: { title: 'Новый выбор', prompt: 'Выберите вариант', options: [option('Вариант 1')] },
    question: { title: 'Новый вопрос', question: 'Введите текст вопроса', answers: [option('Ответ 1'), option('Ответ 2')] },
    timer: { title: 'Новая задержка', duration: 24, unit: 'hours' as const, note: '' },
    media: { title: 'Новое медиа', assetKey: '', displayName: '', expectedType: 'image' as const, caption: '', required: true },
    end: { title: 'Завершение', text: 'Спасибо! Воронка завершена.', note: '' },
  }
  return { id, type, position, data: dataByType[type] }
}

export function createEmptyFunnel(name = 'Новая воронка'): FunnelDocument {
  const now = new Date().toISOString()
  const start = createNode('start', { x: 100, y: 160 })
  return {
    documentType: 'funnel',
    schemaVersion: SCHEMA_VERSION,
    project: { id: newId('project'), name, description: '' },
    funnel: {
      id: newId('funnel'),
      name,
      version: 1,
      status: 'draft',
      startNodeId: start.id,
      createdAt: now,
      updatedAt: now,
    },
    nodes: [start],
    edges: [],
    assets: [],
    analytics: emptyAnalytics(1),
  }
}

export function syncAssets(document: FunnelDocument): FunnelDocument {
  const known = new Map(document.assets.map((asset) => [asset.nodeId ?? asset.assetKey, asset]))
  const assets: FunnelAsset[] = document.nodes
    .filter((node) => node.type === 'media')
    .map((node) => {
      const data = node.data as MediaData
      const previous = known.get(node.id) ?? known.get(data.assetKey)
      return {
        ...previous,
        assetKey: data.assetKey,
        displayName: data.displayName,
        expectedType: data.expectedType,
        required: data.required,
        nodeId: node.id,
      }
    })
  const referencedKeys = new Set(assets.map((asset) => asset.assetKey))
  const compatibleOrphans = document.assets.filter((asset) => !asset.nodeId && !referencedKeys.has(asset.assetKey))
  return { ...document, assets: [...assets, ...compatibleOrphans] }
}

export function createNewVersion(source: FunnelDocument): FunnelDocument {
  const version = source.funnel.version + 1
  const copy = structuredClone(source)
  copy.funnel = { ...copy.funnel, version, status: 'draft', updatedAt: new Date().toISOString() }
  copy.analytics = emptyAnalytics(version)
  return copy
}

export function duplicateFunnel(source: FunnelDocument): FunnelDocument {
  const now = new Date().toISOString()
  const copy = structuredClone(source)
  copy.project = { ...copy.project, id: newId('project'), name: `${copy.project.name} — копия` }
  copy.funnel = { ...copy.funnel, id: newId('funnel'), name: `${copy.funnel.name} — копия`, createdAt: now, updatedAt: now }
  return copy
}

export function outgoingEdge(document: FunnelDocument, nodeId: string, handle?: string) {
  return document.edges.find((edge) => edge.source === nodeId && (handle === undefined || (edge.sourceHandle ?? 'next') === handle))
}

export function nodeTitle(node: FunnelNode): string {
  return typeof node.data.title === 'string' && node.data.title.trim() ? node.data.title : node.id
}

export function edgeLabel(document: FunnelDocument, sourceId: string, handle: string | null | undefined): string | undefined {
  const node = document.nodes.find((candidate) => candidate.id === sourceId)
  if (!node || !handle) return undefined
  if (node.type === 'choice') return (node.data as ChoiceData).options.find((item) => item.id === handle)?.text
  if (node.type === 'question') return (node.data as QuestionData).answers.find((item) => item.id === handle)?.text
  return undefined
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
