import { z } from 'zod'
import { SCHEMA_VERSION } from './funnel'
import type { FunnelDocument, ImportResult } from './types'

const position = z.object({ x: z.number().finite(), y: z.number().finite() }).passthrough()
const base = z.object({ title: z.string() }).passthrough()
const messageButton = z.object({
  id: z.string().min(1),
  text: z.string(),
  action: z.enum(['branch', 'url', 'product']),
  url: z.string().optional(),
  productId: z.string().optional(),
}).passthrough()
const formField = z.object({
  id: z.string().min(1),
  type: z.enum(['name', 'username', 'phone', 'email', 'text']),
  label: z.string(),
  required: z.boolean(),
}).passthrough()

const node = <T extends string>(type: T, data: z.ZodTypeAny) => z.object({
  id: z.string().min(1),
  type: z.literal(type),
  data,
  position: position.optional(),
}).passthrough()

const nodeSchema = z.discriminatedUnion('type', [
  node('start', base),
  node('message', base.extend({ text: z.string(), buttons: z.array(messageButton) })),
  node('media', base.extend({ assetId: z.string().optional(), caption: z.string(), required: z.boolean() })),
  node('timer', base.extend({ duration: z.number().finite().positive(), unit: z.enum(['minutes', 'hours', 'days']), respectQuietHours: z.boolean() })),
  node('test', base.extend({ testId: z.string().optional(), welcomeText: z.string() })),
  node('form', base.extend({ introText: z.string(), fields: z.array(formField), submitText: z.string(), confirmationText: z.string() })),
  node('consent', base.extend({ text: z.string(), policyUrl: z.string(), acceptText: z.string(), declineEnabled: z.boolean(), declineText: z.string() })),
  node('product', base.extend({ productId: z.string().optional(), headline: z.string(), description: z.string(), price: z.number().finite().nonnegative(), payButtonText: z.string(), allowSkip: z.boolean() })),
  node('external_link', base.extend({ text: z.string(), buttonText: z.string(), url: z.string(), continueAfterClick: z.boolean() })),
  node('end', base.extend({ text: z.string() })),
])

const scoreMap = z.record(z.number().finite())
const resultButton = messageButton
const resultBase = {
  id: z.string().min(1),
  name: z.string(),
  shortText: z.string(),
  fullText: z.string(),
  recommendations: z.string(),
  assetId: z.string().optional(),
  buttons: z.array(resultButton),
}
const testSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  shuffleQuestions: z.boolean(),
  scales: z.array(z.object({
    id: z.string().min(1),
    code: z.string(),
    name: z.string(),
    color: z.string(),
  }).passthrough()),
  questions: z.array(z.object({
    id: z.string().min(1),
    text: z.string(),
    type: z.enum(['single', 'multiple', 'scale', 'number', 'text']),
    enabled: z.boolean(),
    required: z.boolean(),
    answers: z.array(z.object({ id: z.string().min(1), text: z.string(), scores: scoreMap }).passthrough()),
    shuffleAnswers: z.boolean(),
    scaleMin: z.number().optional(),
    scaleMax: z.number().optional(),
  }).passthrough()),
  results: z.array(z.object({ ...resultBase, scaleId: z.string().min(1) }).passthrough()),
  combinedResults: z.array(z.object({ ...resultBase, scaleIds: z.tuple([z.string().min(1), z.string().min(1)]) }).passthrough()),
  calculation: z.object({
    method: z.literal('dynamic_percent'),
    proximityThreshold: z.number().finite().min(0).max(100),
    useCombinedResults: z.boolean(),
    missingCombination: z.literal('primary'),
  }).passthrough(),
}).passthrough()

const assetSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  name: z.string(),
  type: z.enum(['image', 'video', 'audio', 'voice', 'video_note', 'document', 'animation']),
  required: z.boolean(),
  logicalRef: z.string(),
}).passthrough()

const productSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  name: z.string(),
  description: z.string(),
  price: z.number().finite().nonnegative(),
  active: z.boolean(),
  assetId: z.string().optional(),
  afterPurchaseText: z.string(),
}).passthrough()

const trackingLinkSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  code: z.string().min(1),
  source: z.string(),
  campaign: z.string(),
  content: z.string().optional(),
  active: z.boolean(),
}).passthrough()

const analyticsSchema = z.object({
  snapshotAt: z.string().nullable(),
  funnelVersion: z.number().int().positive(),
  summary: z.object({
    totalUsers: z.number().nonnegative(),
    started: z.number().nonnegative(),
    completed: z.number().nonnegative(),
    applications: z.number().nonnegative(),
    purchases: z.number().nonnegative(),
    revenue: z.number().nonnegative(),
  }).passthrough(),
  nodes: z.record(z.object({ entered: z.number().nonnegative(), completed: z.number().nonnegative(), dropped: z.number().nonnegative().optional() }).passthrough()),
  tests: z.record(z.record(z.number())),
  questions: z.record(z.record(z.number())),
  results: z.record(z.record(z.union([z.number(), z.string()]))),
  products: z.record(z.record(z.number())),
  sources: z.record(z.object({
    arrived: z.number().nonnegative(),
    started: z.number().nonnegative(),
    completed: z.number().nonnegative(),
    applications: z.number().nonnegative(),
    purchases: z.number().nonnegative(),
    revenue: z.number().nonnegative(),
  }).passthrough()),
  contacts: z.array(z.object({ id: z.string() }).passthrough()),
  applications: z.array(z.object({ id: z.string() }).passthrough()),
}).passthrough()

const documentSchema = z.object({
  documentType: z.literal('funnel'),
  schemaVersion: z.literal(SCHEMA_VERSION),
  project: z.object({ id: z.string().min(1), name: z.string(), description: z.string() }).passthrough(),
  funnel: z.object({
    id: z.string().min(1),
    key: z.string().min(1),
    name: z.string(),
    description: z.string(),
    version: z.number().int().positive(),
    status: z.enum(['draft', 'published', 'archived']),
    startNodeId: z.string().min(1),
    createdAt: z.string(),
    updatedAt: z.string(),
    parentVersion: z.number().int().positive().optional(),
    changeComment: z.string().optional(),
  }).passthrough(),
  bot: z.object({
    displayName: z.string(),
    username: z.string(),
    timezone: z.string(),
    inactivityDays: z.number().int().positive(),
    quietHours: z.object({ enabled: z.boolean(), from: z.string(), to: z.string(), behavior: z.enum(['postpone', 'skip']) }).passthrough(),
    reentryPolicy: z.enum(['continue', 'restart', 'show_result']),
    optOut: z.object({ command: z.string(), confirmationText: z.string(), blockBackground: z.boolean(), allowRestart: z.boolean() }).passthrough(),
    reminders: z.object({ maxCount: z.number().int().nonnegative(), cancelAfterContinue: z.boolean(), respectQuietHours: z.boolean() }).passthrough(),
    trackingLinks: z.array(trackingLinkSchema),
  }).passthrough(),
  nodes: z.array(nodeSchema),
  edges: z.array(z.object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    sourceHandle: z.string().nullable().optional(),
    targetHandle: z.string().nullable().optional(),
    label: z.string().optional(),
  }).passthrough()),
  tests: z.array(testSchema),
  assets: z.array(assetSchema),
  products: z.array(productSchema),
  analytics: analyticsSchema,
  editor: z.object({ nodePositions: z.record(position), collapsedNodeIds: z.array(z.string()) }).passthrough(),
}).passthrough()

export function parseAndMigrateFunnelDocument(raw: unknown): ImportResult {
  if (!raw || typeof raw !== 'object') return { success: false, errors: ['Файл не содержит объект воронки.'] }
  const version = (raw as { schemaVersion?: unknown }).schemaVersion
  if (typeof version !== 'string') return { success: false, errors: ['В файле не указана версия формата.'] }
  if (!version.startsWith('2.')) {
    return {
      success: false,
      errors: ['Этот файл создан в старой расширенной версии конструктора и не поддерживается новым упрощённым форматом.'],
    }
  }
  if (version !== SCHEMA_VERSION) {
    return { success: false, errors: [`Формат ${version} пока не поддерживается. Откройте файл в совместимой версии конструктора.`] }
  }
  const result = documentSchema.safeParse(raw)
  if (!result.success) {
    const errors = result.error.issues.slice(0, 12).map((issue) => {
      const place = issue.path.length ? issue.path.join(' → ') : 'файл'
      return `Не удалось прочитать «${place}»: ${humanizeZodMessage(issue.message)}.`
    })
    return { success: false, errors }
  }
  return { success: true, document: result.data as FunnelDocument }
}

function humanizeZodMessage(message: string): string {
  if (message.includes('Required')) return 'обязательное значение отсутствует'
  if (message.includes('Expected')) return 'значение имеет неверный тип'
  return message
}
