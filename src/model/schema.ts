import { z } from 'zod'
import { defaultSettings, emptyAnalytics, LEGACY_SCHEMA_VERSION, SCHEMA_VERSION, slugify } from './funnel'
import type { FunnelAnalytics, FunnelDocument, FunnelNode, ImportResult, MediaData, MigrationNotice, NodeOption } from './types'

const positionSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).passthrough()
const variableValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string()), z.array(z.number()), z.record(z.unknown())])
const nodeTypes = ['start','message','choice','question','test','condition','set_variable','formula','timer','wait_until','reminder','media','form','consent','result','product','external_link','random','sub_funnel','end','comment','group'] as const
const mediaTypes = ['image','video','audio','voice','video_note','document','animation'] as const

const baseDataSchema = z.object({ title: z.string(), note: z.string().optional(), enabled: z.boolean().optional(), analyticsTags: z.array(z.string()).optional(), abGroup: z.string().optional(), updatedAt: z.string().optional() }).passthrough()
const scoringActionSchema = z.object({ id: z.string(), type: z.enum(['add','subtract','set','tag','variable']), scaleId: z.string().optional(), value: z.number().optional(), tag: z.string().optional(), variableKey: z.string().optional(), variableValue: variableValueSchema.optional() }).passthrough()
const optionSchema = z.object({ id: z.string(), text: z.string(), value: z.string().optional(), enabled: z.boolean().optional(), style: z.enum(['primary','secondary','danger','link']).optional(), scores: z.record(z.number()).optional(), scoring: z.array(scoringActionSchema).optional() }).passthrough()
const messageButtonSchema = optionSchema.extend({ action: z.enum(['transition','url','product','funnel','set_variable']), url: z.string().optional(), productId: z.string().optional(), funnelKey: z.string().optional(), variableKey: z.string().optional(), variableValue: variableValueSchema.optional() }).passthrough()
const quietHoursSchema = z.object({ enabled: z.boolean(), from: z.string(), to: z.string(), behavior: z.enum(['postpone','skip']) }).passthrough()
const operandSchema = z.union([z.object({ kind: z.literal('variable'), key: z.string() }).passthrough(), z.object({ kind: z.literal('constant'), value: variableValueSchema, valueType: z.enum(['string','number','boolean','dateTime','stringList','numberList','object']) }).passthrough()])
const conditionRuleSchema = z.object({ id: z.string(), kind: z.literal('rule'), left: operandSchema, operator: z.enum(['eq','neq','gt','gte','lt','lte','contains','not_contains','starts_with','ends_with','in','not_in','filled','empty','is_true','is_false','date_before','date_after','date_between','number_between','result_is','product_paid','product_not_paid','source_is']), right: operandSchema.optional(), rightTo: operandSchema.optional() }).passthrough()
type ConditionSchemaValue = { id: string; kind: 'group'; logic: 'and' | 'or'; not: boolean; children: Array<ConditionSchemaValue | z.infer<typeof conditionRuleSchema>> }
const conditionGroupSchema: z.ZodType<ConditionSchemaValue> = z.lazy(() => z.object({ id: z.string(), kind: z.literal('group'), logic: z.enum(['and','or']), not: z.boolean(), children: z.array(z.union([conditionGroupSchema, conditionRuleSchema])) }).passthrough())
type FormulaSchemaValue = { id: string; kind: 'number'; value: number } | { id: string; kind: 'variable'; key: string } | { id: string; kind: 'binary'; operator: '+' | '-' | '*' | '/'; left: FormulaSchemaValue; right: FormulaSchemaValue } | { id: string; kind: 'function'; name: 'min' | 'max' | 'round' | 'floor' | 'ceil'; args: FormulaSchemaValue[] }
const formulaSchema: z.ZodType<FormulaSchemaValue> = z.lazy(() => z.union([
  z.object({ id:z.string(), kind:z.literal('number'), value:z.number().finite() }).passthrough(),
  z.object({ id:z.string(), kind:z.literal('variable'), key:z.string() }).passthrough(),
  z.object({ id:z.string(), kind:z.literal('binary'), operator:z.enum(['+','-','*','/']), left:formulaSchema, right:formulaSchema }).passthrough(),
  z.object({ id:z.string(), kind:z.literal('function'), name:z.enum(['min','max','round','floor','ceil']), args:z.array(formulaSchema) }).passthrough(),
]))
const variableActionSchema = z.object({ id:z.string(), type:z.enum(['assign','copy','clear','increment','decrement','list_add','list_remove','now','test_result','template']), variableKey:z.string(), value:variableValueSchema.optional(), sourceVariableKey:z.string().optional(), template:z.string().optional() }).passthrough()
const formFieldSchema = z.object({ id:z.string(), label:z.string(), type:z.enum(['name','username','phone','email','short_text','long_text','number','date','choice','checkbox','consent','hidden']), required:z.boolean(), variableKey:z.string().optional(), placeholder:z.string().optional(), options:z.array(optionSchema).optional(), validationPattern:z.string().optional(), min:z.number().optional(), max:z.number().optional(), errorText:z.string().optional() }).passthrough()

const nodeSchema = <T extends typeof nodeTypes[number]>(type: T, data: z.ZodTypeAny) => z.object({ id:z.string(), type:z.literal(type), data, position:positionSchema.optional() }).passthrough()
const currentNodeSchema = z.union([
  nodeSchema('start', baseDataSchema.extend({ entryKey:z.string(), sourceDescription:z.string(), initialValues:z.record(variableValueSchema), reentryPolicy:z.enum(['continue','restart','show_result','branch']) })),
  nodeSchema('message', baseDataSchema.extend({ text:z.string(), parseMode:z.enum(['markdown','plain']), buttons:z.array(messageButtonSchema), continueWithoutButton:z.boolean(), continueEnabled:z.boolean().optional(), buttonText:z.string().optional() })),
  nodeSchema('choice', baseDataSchema.extend({ prompt:z.string(), selectionMode:z.enum(['single','multiple']), options:z.array(optionSchema), minSelected:z.number().int(), maxSelected:z.number().int(), shuffle:z.boolean(), variableKey:z.string().optional(), sharedTransition:z.boolean(), confirmText:z.string(), allowOther:z.boolean() })),
  nodeSchema('question', baseDataSchema.extend({ question:z.string(), inputType:z.enum(['single_choice','multiple_choice','short_text','long_text','integer','number','phone','email','date','time','scale','yes_no','telegram_contact']), answers:z.array(optionSchema), required:z.boolean(), variableKey:z.string().optional(), placeholder:z.string().optional(), minLength:z.number().int().optional(), maxLength:z.number().int().optional(), minValue:z.number().optional(), maxValue:z.number().optional(), validationPattern:z.string().optional(), errorText:z.string().optional(), maxAttempts:z.number().int(), shuffle:z.boolean() })),
  nodeSchema('test', baseDataSchema.extend({ testId:z.string().optional(), welcomeText:z.string(), progressText:z.string(), showQuestionNumber:z.boolean(), mode:z.enum(['all','one_by_one']), allowBack:z.boolean(), saveImmediately:z.boolean(), resultVariableKey:z.string().optional() })),
  nodeSchema('condition', baseDataSchema.extend({ branches:z.array(z.object({ id:z.string(), name:z.string(), isElse:z.boolean(), condition:conditionGroupSchema.optional() }).passthrough()) })),
  nodeSchema('set_variable', baseDataSchema.extend({ actions:z.array(variableActionSchema) })),
  nodeSchema('formula', baseDataSchema.extend({ expression:formulaSchema, targetVariableKey:z.string().optional() })),
  nodeSchema('timer', baseDataSchema.extend({ duration:z.number(), unit:z.enum(['seconds','minutes','hours','days']), from:z.enum(['entry','system_event']), systemEvent:z.string().optional(), continueMode:z.enum(['automatic','button']), buttonText:z.string(), quietHours:quietHoursSchema })),
  nodeSchema('wait_until', baseDataSchema.extend({ mode:z.enum(['fixed','weekday']), dateTime:z.string().optional(), weekday:z.number().int().optional(), time:z.string(), timezoneMode:z.enum(['user','funnel']), pastBehavior:z.enum(['immediate','next_period','skip']), quietHours:quietHoursSchema })),
  nodeSchema('reminder', baseDataSchema.extend({ text:z.string(), duration:z.number(), unit:z.enum(['seconds','minutes','hours','days']), maxSends:z.number().int(), interval:z.number(), intervalUnit:z.enum(['seconds','minutes','hours','days']), cancelCondition:conditionGroupSchema.optional(), background:z.boolean(), quietHours:quietHoursSchema, eventKey:z.string() })),
  nodeSchema('media', baseDataSchema.extend({ assetId:z.string().optional(), assetKey:z.string(), displayName:z.string().optional(), expectedType:z.enum(mediaTypes).optional(), caption:z.string(), sendMode:z.enum(['single','album']), required:z.boolean(), missingBehavior:z.enum(['placeholder','skip','block']) })),
  nodeSchema('form', baseDataSchema.extend({ description:z.string(), fields:z.array(formFieldSchema), submitText:z.string(), recordType:z.enum(['contact','application','custom']), applicationStatus:z.string().optional(), consentRequired:z.boolean(), analyticsEvent:z.string() })),
  nodeSchema('consent', baseDataSchema.extend({ text:z.string(), policyUrl:z.string().optional(), consentVersion:z.string(), acceptText:z.string(), declineEnabled:z.boolean(), declineText:z.string(), variableKey:z.string().optional(), analyticsEvent:z.string() })),
  nodeSchema('result', baseDataSchema.extend({ resultSetId:z.string().optional(), sourceVariableKey:z.string().optional(), singleTemplate:z.string(), combinedTemplate:z.string(), visibleFields:z.array(z.string()), buttons:z.array(messageButtonSchema), analyticsEvent:z.string() })),
  nodeSchema('product', baseDataSchema.extend({ productId:z.string().optional(), headline:z.string(), description:z.string(), displayPrice:z.string(), payButtonText:z.string(), allowSkip:z.boolean() })),
  nodeSchema('external_link', baseDataSchema.extend({ url:z.string(), buttonText:z.string(), openExternal:z.boolean(), linkType:z.enum(['website','channel','contact','bot','document']), sourceParams:z.record(z.string()), analyticsEvent:z.string() })),
  nodeSchema('random', baseDataSchema.extend({ branches:z.array(z.object({ id:z.string(), name:z.string(), weight:z.number() }).passthrough()), stableByUser:z.boolean(), variableKey:z.string().optional(), analyticsTag:z.string().optional() })),
  nodeSchema('sub_funnel', baseDataSchema.extend({ targetFunnelKey:z.string(), targetEntryKey:z.string(), variableKeys:z.array(z.string()), missingBehavior:z.enum(['finish','error']), analyticsEvent:z.string() })),
  nodeSchema('end', baseDataSchema.extend({ text:z.string(), reasonCode:z.string(), sessionStatus:z.enum(['completed','cancelled','opted_out','external']), clearVariableKeys:z.array(z.string()), analyticsEvent:z.string().optional(), reentryAction:z.enum(['restart','show_result','stay_finished']) })),
  nodeSchema('comment', baseDataSchema.extend({ text:z.string(), color:z.string() })),
  nodeSchema('group', baseDataSchema.extend({ color:z.string(), collapsed:z.boolean(), childNodeIds:z.array(z.string()) })),
])

const currentEdgeSchema = z.object({
  id: z.string(), source: z.string(), target: z.string(),
  sourceHandle: z.string().nullable().optional(), targetHandle: z.string().nullable().optional(),
  label: z.string().optional(), visual: z.object({ lineType: z.enum(['bezier','straight','step']).optional(), color: z.string().optional() }).passthrough().optional(),
}).passthrough()

const variableSchema = z.object({
  id: z.string(), key: z.string(), name: z.string(), type: z.enum(['string','number','boolean','dateTime','stringList','numberList','object']),
  description: z.string(), defaultValue: variableValueSchema, scope: z.enum(['session','user','result']),
  sensitive: z.boolean(), transferable: z.boolean(), printable: z.boolean(),
}).passthrough()

const testSchema = z.object({
  id: z.string(), key: z.string(), name: z.string(), description: z.string(), status: z.enum(['draft','published','archived']),
  questions: z.array(z.object({ id: z.string(), type: z.enum(['single','multiple','scale','number','text']), text: z.string(), enabled: z.boolean(), required: z.boolean(), answers: z.array(z.object({ id: z.string(), text: z.string(), scoring: z.array(z.object({ id: z.string(), type: z.enum(['add','subtract','set','tag','variable']) }).passthrough()) }).passthrough()), shuffleAnswers: z.boolean() }).passthrough()),
  scales: z.array(z.object({ id: z.string(), code: z.string(), name: z.string(), description: z.string(), color: z.string(), direction: z.enum(['strength','resource']), normalization: z.enum(['raw','fixed_percent','dynamic_percent','range']), precision: z.number().int().nonnegative() }).passthrough()),
  shuffleQuestions: z.boolean(), resultSetId: z.string().optional(), resultVariableKey: z.string().optional(),
}).passthrough()

const resultSetSchema = z.object({
  id: z.string(), key: z.string(), name: z.string(),
  results: z.array(z.object({ id: z.string(), code: z.string(), title: z.string(), shortText: z.string(), text: z.string(), sections: z.array(z.object({ id: z.string(), title: z.string(), text: z.string() }).passthrough()), recommendations: z.array(z.string()), assetIds: z.array(z.string()), buttons: z.array(z.unknown()), contentVersion: z.number().int().positive(), scaleIds: z.array(z.string()), combined: z.boolean() }).passthrough()),
  rules: z.array(z.object({ id: z.string(), type: z.enum(['top','threshold','range','combination','closeness','fallback']), priority: z.number().int() }).passthrough()),
  fallbackResultCode: z.string().optional(), tieBreaker: z.enum(['scale_order','code']),
}).passthrough()

const assetSchema = z.object({
  id: z.string(), assetKey: z.string(), displayName: z.string(), expectedType: z.enum(mediaTypes), required: z.boolean(),
  description: z.string(), expectedMimeTypes: z.array(z.string()), recommendedFilename: z.string().optional(), maxSizeMb: z.number().positive().optional(), maxDurationSeconds: z.number().positive().optional(), nodeId: z.string().optional(),
}).passthrough()

const productSchema = z.object({
  id: z.string(), productKey: z.string(), name: z.string(), description: z.string(), type: z.enum(['digital','consultation','course','preorder','other']),
  priceMinor: z.number().int(), currency: z.string(), active: z.boolean(), provider: z.enum(['yookassa','future']), assetIds: z.array(z.string()),
  personalization: z.array(z.object({ resultCode: z.string(), assetId: z.string() }).passthrough()), fallbackAssetId: z.string().optional(),
  successText: z.string(), repurchasePolicy: z.enum(['allow','deny','redeliver']), analytics: z.record(z.string()),
}).passthrough()

const settingsSchema = z.object({
  session: z.object({ inactivityDays: z.number().int(), expirationAction: z.literal('finish'), keepVersionForActiveUsers: z.boolean(), reentryPolicy: z.enum(['continue','restart','show_result','branch']), retakePolicy: z.enum(['allow','deny','after_period']), clearVariableKeys: z.array(z.string()) }).passthrough(),
  schedule: z.object({ timezone: z.string(), userTimezoneMode: z.enum(['telegram','ask','funnel']), fallbackTimezone: z.string(), quietHours: z.object({ enabled: z.boolean(), from: z.string(), to: z.string(), behavior: z.enum(['postpone','skip']) }).passthrough(), weeklyWindows: z.array(z.unknown()), maxBackgroundTouchesPerDay: z.number().int() }).passthrough(),
  sources: z.object({ expected: z.array(z.string()), labels: z.record(z.string()), initialValues: z.record(z.record(variableValueSchema)) }).passthrough(),
  optOut: z.object({ command: z.string(), finalText: z.string(), blockBackground: z.boolean(), allowExplicitRestart: z.boolean() }).passthrough(),
}).passthrough()

const analyticsSchema = z.object({
  snapshotAt: z.string().nullable(), funnelVersion: z.number().int().positive(),
  period: z.object({ from: z.string().nullable(), to: z.string().nullable() }).passthrough().optional(),
  completeness: z.object({ level: z.enum(['aggregate','events','journeys']), sections: z.array(z.string()) }).passthrough().optional(),
  summary: z.object({ totalUsers: z.number().nonnegative().optional(), started: z.number().nonnegative(), completed: z.number().nonnegative(), active: z.number().nonnegative().optional(), optedOut: z.number().nonnegative().optional(), averageDurationSeconds: z.number().nonnegative().optional(), medianDurationSeconds: z.number().nonnegative().optional() }).passthrough(),
  nodes: z.record(z.object({ entered: z.number(), completed: z.number(), dropped: z.number().optional() }).passthrough()),
  edges: z.record(z.object({ transitions: z.number() }).passthrough()),
  tests: z.record(z.unknown()).optional(), questions: z.record(z.unknown()), results: z.record(z.unknown()).optional(), products: z.record(z.unknown()).optional(),
  payments: z.array(z.record(z.unknown())).optional(), reminders: z.record(z.unknown()).optional(), sources: z.record(z.unknown()).optional(),
  contacts: z.array(z.object({ id: z.string() }).passthrough()), applications: z.array(z.object({ id: z.string() }).passthrough()),
  events: z.array(z.record(z.unknown())).optional(), journeys: z.array(z.record(z.unknown())).optional(),
}).passthrough()

export const funnelSchema = z.object({
  documentType: z.literal('funnel'), schemaVersion: z.literal(SCHEMA_VERSION),
  project: z.object({ id: z.string(), name: z.string(), description: z.string() }).passthrough(),
  funnel: z.object({ id: z.string(), key: z.string(), name: z.string(), description: z.string(), version: z.number().int().positive(), parentVersion: z.number().int().positive().optional(), changeComment: z.string().optional(), status: z.enum(['draft','published','archived']), startNodeId: z.string(), entryKey: z.string(), tags: z.array(z.string()), createdAt: z.string(), updatedAt: z.string() }).passthrough(),
  settings: settingsSchema,
  variables: z.array(variableSchema), nodes: z.array(currentNodeSchema), edges: z.array(currentEdgeSchema), tests: z.array(testSchema), resultSets: z.array(resultSetSchema), assets: z.array(assetSchema), products: z.array(productSchema),
  testScenarios: z.array(z.object({ id: z.string(), name: z.string(), systemValues: z.record(variableValueSchema), answers: z.record(variableValueSchema), paymentOutcomes: z.record(z.string()), seed: z.string(), expectedVariables: z.record(variableValueSchema) }).passthrough()),
  analytics: z.unknown(),
  editor: z.object({ nodePositions: z.record(positionSchema), collapsedNodeIds: z.array(z.string()), groups: z.array(z.unknown()), comments: z.array(z.unknown()) }).passthrough(),
}).passthrough()

const legacyOptionSchema = z.object({ id: z.string(), text: z.string(), scores: z.record(z.number()).optional() }).passthrough()
const legacyNodeSchema = z.discriminatedUnion('type', [
  z.object({ id:z.string(), type:z.literal('start'), position:positionSchema, data:z.object({title:z.string(),note:z.string()}).passthrough() }).passthrough(),
  z.object({ id:z.string(), type:z.literal('message'), position:positionSchema, data:z.object({title:z.string(),text:z.string(),note:z.string(),continueEnabled:z.boolean(),buttonText:z.string()}).passthrough() }).passthrough(),
  z.object({ id:z.string(), type:z.literal('choice'), position:positionSchema, data:z.object({title:z.string(),prompt:z.string(),options:z.array(legacyOptionSchema)}).passthrough() }).passthrough(),
  z.object({ id:z.string(), type:z.literal('question'), position:positionSchema, data:z.object({title:z.string(),question:z.string(),answers:z.array(legacyOptionSchema)}).passthrough() }).passthrough(),
  z.object({ id:z.string(), type:z.literal('timer'), position:positionSchema, data:z.object({title:z.string(),duration:z.number(),unit:z.enum(['minutes','hours','days']),note:z.string()}).passthrough() }).passthrough(),
  z.object({ id:z.string(), type:z.literal('media'), position:positionSchema, data:z.object({title:z.string(),assetKey:z.string(),displayName:z.string(),expectedType:z.enum(['image','video','audio','voice','video_note','document']),caption:z.string(),required:z.boolean()}).passthrough() }).passthrough(),
  z.object({ id:z.string(), type:z.literal('end'), position:positionSchema, data:z.object({title:z.string(),text:z.string(),note:z.string()}).passthrough() }).passthrough(),
])

export const legacyFunnelSchema = z.object({
  documentType:z.literal('funnel'), schemaVersion:z.literal(LEGACY_SCHEMA_VERSION),
  project:z.object({id:z.string(),name:z.string(),description:z.string()}).passthrough(),
  funnel:z.object({id:z.string(),name:z.string(),version:z.number().int().positive(),status:z.enum(['draft','published','archived']),startNodeId:z.string(),createdAt:z.string(),updatedAt:z.string()}).passthrough(),
  nodes:z.array(legacyNodeSchema),
  edges:z.array(z.object({id:z.string(),source:z.string(),target:z.string(),sourceHandle:z.string().nullable().optional(),targetHandle:z.string().nullable().optional(),label:z.string().optional()}).passthrough()),
  assets:z.array(z.object({assetKey:z.string(),displayName:z.string(),expectedType:z.enum(['image','video','audio','voice','video_note','document']),required:z.boolean(),nodeId:z.string().optional()}).passthrough()),
  analytics:z.unknown(),
}).passthrough()

type LegacyDocument = z.infer<typeof legacyFunnelSchema>

function issueMessages(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.join('.') || 'document'}: ${issue.message}`)
}

export function parseFunnelDocument(value: unknown): { success: true; data: FunnelDocument; analyticsIsolated?: boolean } | { success: false; errors: string[] } {
  const result = funnelSchema.safeParse(value)
  if (!result.success) return { success: false, errors: issueMessages(result.error) }
  const parsed = result.data as unknown as FunnelDocument
  const analytics = analyticsSchema.safeParse(result.data.analytics)
  if (!analytics.success) {
    parsed.analytics = emptyAnalytics(parsed.funnel.version)
    return { success: true, data: parsed, analyticsIsolated: true }
  }
  parsed.analytics = analytics.data as FunnelAnalytics
  return { success: true, data: parsed }
}

export function parseAndMigrateFunnelDocument(value: unknown): ImportResult {
  if (!value || typeof value !== 'object') return { success: false, errors: ['document: ожидается JSON-объект'] }
  const raw = value as Record<string, unknown>
  if (raw.documentType !== 'funnel') return { success: false, errors: ['documentType: ожидается значение «funnel»'] }
  const version = typeof raw.schemaVersion === 'string' ? raw.schemaVersion : ''
  if (version === SCHEMA_VERSION) {
    const parsed = parseFunnelDocument(value)
    if (!parsed.success) return parsed
    return { success: true, document: parsed.data, issues: [], analyticsIsolated: parsed.analyticsIsolated }
  }
  if (version === LEGACY_SCHEMA_VERSION) {
    const legacy = legacyFunnelSchema.safeParse(value)
    if (!legacy.success) return { success: false, errors: issueMessages(legacy.error) }
    const { document, notice, analyticsIsolated } = migrateLegacyDocument(legacy.data)
    return { success: true, document, issues: [], migration: notice, analyticsIsolated }
  }
  const major = Number(version.split('.')[0])
  if (Number.isFinite(major) && major > 1) return { success: false, errors: [`schemaVersion: версия ${version} новее поддерживаемой ${SCHEMA_VERSION}. Обновите приложение.`] }
  return { success: false, errors: [`schemaVersion: версия «${version || 'не указана'}» не поддерживается`] }
}

export function migrateLegacyDocument(raw: LegacyDocument): { document: FunnelDocument; notice: MigrationNotice; analyticsIsolated: boolean } {
  const positions: Record<string, { x: number; y: number }> = {}
  const messageHandles = new Map<string, string>()
  const assets = raw.assets.map((asset) => ({
    ...asset,
    id: `asset_${asset.assetKey || asset.nodeId || 'legacy'}`,
    expectedType: asset.expectedType,
    description: '',
    expectedMimeTypes: [],
  }))

  const nodes: FunnelNode[] = raw.nodes.map((legacyNode) => {
    positions[legacyNode.id] = { x: legacyNode.position.x, y: legacyNode.position.y }
    const { position: _position, ...nodeWithoutPosition } = legacyNode
    const base = { note: '', enabled: true, analyticsTags: [] as string[], abGroup: '' }
    let data: FunnelNode['data']
    if (legacyNode.type === 'start') data = { ...legacyNode.data, ...base, note: legacyNode.data.note, entryKey: 'main', sourceDescription: '', initialValues: {}, reentryPolicy: 'continue' }
    else if (legacyNode.type === 'message') {
      const buttonId = `legacy_${legacyNode.id}_continue`
      if (legacyNode.data.continueEnabled) messageHandles.set(legacyNode.id, buttonId)
      data = { ...legacyNode.data, ...base, note: legacyNode.data.note, parseMode: 'markdown', buttons: legacyNode.data.continueEnabled ? [{ id: buttonId, text: legacyNode.data.buttonText || 'Продолжить', value: 'continue', enabled: true, style: 'primary', scoring: [], action: 'transition' }] : [], continueWithoutButton: !legacyNode.data.continueEnabled }
    } else if (legacyNode.type === 'choice') data = { ...legacyNode.data, ...base, selectionMode: 'single', options: legacyNode.data.options.map(migrateOption), minSelected: 1, maxSelected: 1, shuffle: false, sharedTransition: false, confirmText: 'Подтвердить', allowOther: false }
    else if (legacyNode.type === 'question') data = { ...legacyNode.data, ...base, inputType: 'single_choice', answers: legacyNode.data.answers.map(migrateOption), required: true, maxAttempts: 3, shuffle: false }
    else if (legacyNode.type === 'timer') data = { ...legacyNode.data, ...base, note: legacyNode.data.note, unit: legacyNode.data.unit, from: 'entry', continueMode: 'automatic', buttonText: 'Продолжить', quietHours: { enabled: false, from: '23:00', to: '09:00', behavior: 'postpone' } }
    else if (legacyNode.type === 'media') {
      const asset = assets.find((item) => item.assetKey === legacyNode.data.assetKey)
      data = { ...legacyNode.data, ...base, assetId: asset?.id, sendMode: 'single', missingBehavior: legacyNode.data.required ? 'block' : 'skip' } as MediaData
    } else data = { ...legacyNode.data, ...base, note: legacyNode.data.note, reasonCode: 'completed', sessionStatus: 'completed', clearVariableKeys: [], analyticsEvent: 'funnel_completed', reentryAction: 'show_result' }
    return { ...nodeWithoutPosition, data } as FunnelNode
  })

  const edges = raw.edges.map((edge) => ({
    ...edge,
    sourceHandle: messageHandles.has(edge.source) && (edge.sourceHandle ?? 'next') === 'next' ? messageHandles.get(edge.source)! : edge.sourceHandle,
    visual: { lineType: 'bezier' as const },
  }))

  const legacyAnalytics = analyticsSchema.safeParse(normalizeLegacyAnalytics(raw.analytics, raw.funnel.version))
  const analyticsIsolated = !legacyAnalytics.success
  const analytics = analyticsIsolated ? emptyAnalytics(raw.funnel.version) : legacyAnalytics.data as FunnelAnalytics
  const key = slugify(raw.funnel.name).replace(/-/g, '_')
  const document: FunnelDocument = {
    ...raw,
    documentType: 'funnel',
    schemaVersion: SCHEMA_VERSION,
    project: { ...raw.project },
    funnel: { ...raw.funnel, key, description: String(raw.project.description ?? ''), entryKey: 'main', tags: [] },
    settings: defaultSettings(), variables: [], nodes, edges, tests: [], resultSets: [], assets, products: [], testScenarios: [], analytics,
    editor: { nodePositions: positions, collapsedNodeIds: [], groups: [], comments: [], migration: { from: LEGACY_SCHEMA_VERSION, at: new Date().toISOString() } },
  }
  const notice = { from: LEGACY_SCHEMA_VERSION, to: SCHEMA_VERSION, messages: ['Сохранены ID блоков и связей', 'Координаты перенесены в editor.nodePositions', 'Старые баллы преобразованы в scoring', 'Реестр медиа обновлён'] }
  return { document, notice, analyticsIsolated }
}

function migrateOption(option: z.infer<typeof legacyOptionSchema>): NodeOption {
  return {
    ...option,
    value: option.text.toLowerCase().replace(/\s+/g, '_'), enabled: true,
    scoring: Object.entries(option.scores ?? {}).map(([scaleId, value], index) => ({ id: `score_${option.id}_${index}`, type: value >= 0 ? 'add' : 'subtract', scaleId, value: Math.abs(value) })),
  }
}

function normalizeLegacyAnalytics(value: unknown, version: number): unknown {
  if (!value || typeof value !== 'object') return emptyAnalytics(version)
  const raw = value as Record<string, unknown>
  return {
    ...emptyAnalytics(version), ...raw,
    period: raw.period ?? { from: null, to: null },
    completeness: raw.completeness ?? { level: 'aggregate', sections: ['summary','nodes','edges','contacts','applications'] },
    tests: raw.tests ?? {}, results: raw.results ?? {}, products: raw.products ?? {}, payments: raw.payments ?? [], reminders: raw.reminders ?? {}, sources: raw.sources ?? {}, events: raw.events ?? [], journeys: raw.journeys ?? [],
  }
}
