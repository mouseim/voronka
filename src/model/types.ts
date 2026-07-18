export type NodeType =
  | 'start' | 'message' | 'choice' | 'question' | 'test' | 'condition'
  | 'set_variable' | 'formula' | 'timer' | 'wait_until' | 'reminder'
  | 'media' | 'form' | 'consent' | 'result' | 'product' | 'external_link'
  | 'random' | 'sub_funnel' | 'end' | 'comment' | 'group'

export type ExecutableNodeType = Exclude<NodeType, 'comment' | 'group'>
export type TimerUnit = 'seconds' | 'minutes' | 'hours' | 'days'
export type MediaType = 'image' | 'video' | 'audio' | 'voice' | 'video_note' | 'document' | 'animation'
export type VariableType = 'string' | 'number' | 'boolean' | 'dateTime' | 'stringList' | 'numberList' | 'object'
export type VariableScope = 'session' | 'user' | 'result'
export type FunnelStatus = 'draft' | 'published' | 'archived'
export type IssueSeverity = 'error' | 'warning' | 'advice'
export type ScalarValue = string | number | boolean | null
export type VariableValue = ScalarValue | string[] | number[] | Record<string, unknown>

export interface Position { x: number; y: number }

export interface BaseNodeData {
  title: string
  note?: string
  enabled?: boolean
  analyticsTags?: string[]
  abGroup?: string
  updatedAt?: string
  [key: string]: unknown
}

export interface ScoreMap { [scale: string]: number }

export interface ScoringAction {
  id: string
  type: 'add' | 'subtract' | 'set' | 'tag' | 'variable'
  scaleId?: string
  value?: number
  tag?: string
  variableKey?: string
  variableValue?: VariableValue
  [key: string]: unknown
}

export interface NodeOption {
  id: string
  text: string
  value?: string
  enabled?: boolean
  style?: 'primary' | 'secondary' | 'danger' | 'link'
  scores?: ScoreMap
  scoring?: ScoringAction[]
  [key: string]: unknown
}

export interface StartData extends BaseNodeData {
  entryKey: string
  sourceDescription: string
  initialValues: Record<string, VariableValue>
  reentryPolicy: 'continue' | 'restart' | 'show_result' | 'branch'
}

export interface MessageButton extends NodeOption {
  action: 'transition' | 'url' | 'product' | 'funnel' | 'set_variable'
  url?: string
  productId?: string
  funnelKey?: string
  variableKey?: string
  variableValue?: VariableValue
}

export interface MessageData extends BaseNodeData {
  text: string
  parseMode: 'markdown' | 'plain'
  buttons: MessageButton[]
  continueWithoutButton: boolean
  /** Legacy UI fields are preserved for old compatible extensions. */
  continueEnabled?: boolean
  buttonText?: string
}

export interface ChoiceData extends BaseNodeData {
  prompt: string
  selectionMode: 'single' | 'multiple'
  options: NodeOption[]
  minSelected: number
  maxSelected: number
  shuffle: boolean
  variableKey?: string
  sharedTransition: boolean
  confirmText: string
  allowOther: boolean
}

export type QuestionInputType = 'single_choice' | 'multiple_choice' | 'short_text' | 'long_text' | 'integer' | 'number' | 'phone' | 'email' | 'date' | 'time' | 'scale' | 'yes_no' | 'telegram_contact'

export interface QuestionData extends BaseNodeData {
  question: string
  inputType: QuestionInputType
  answers: NodeOption[]
  required: boolean
  variableKey?: string
  placeholder?: string
  minLength?: number
  maxLength?: number
  minValue?: number
  maxValue?: number
  validationPattern?: string
  errorText?: string
  maxAttempts: number
  shuffle: boolean
}

export interface TestBlockData extends BaseNodeData {
  testId?: string
  welcomeText: string
  progressText: string
  showQuestionNumber: boolean
  mode: 'all' | 'one_by_one'
  allowBack: boolean
  saveImmediately: boolean
  resultVariableKey?: string
}

export type ConditionOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'not_contains'
  | 'starts_with' | 'ends_with' | 'in' | 'not_in' | 'filled' | 'empty'
  | 'is_true' | 'is_false' | 'date_before' | 'date_after' | 'date_between'
  | 'number_between' | 'result_is' | 'product_paid' | 'product_not_paid' | 'source_is'

export interface VariableOperand { kind: 'variable'; key: string }
export interface ConstantOperand { kind: 'constant'; value: VariableValue; valueType: VariableType }
export type ConditionOperand = VariableOperand | ConstantOperand

export interface ConditionRule {
  id: string
  kind: 'rule'
  left: ConditionOperand
  operator: ConditionOperator
  right?: ConditionOperand
  rightTo?: ConditionOperand
}

export interface ConditionGroup {
  id: string
  kind: 'group'
  logic: 'and' | 'or'
  not: boolean
  children: Array<ConditionGroup | ConditionRule>
}

export interface ConditionBranch {
  id: string
  name: string
  isElse: boolean
  condition?: ConditionGroup
}

export interface ConditionData extends BaseNodeData { branches: ConditionBranch[] }

export interface VariableAction {
  id: string
  type: 'assign' | 'copy' | 'clear' | 'increment' | 'decrement' | 'list_add' | 'list_remove' | 'now' | 'test_result' | 'template'
  variableKey: string
  value?: VariableValue
  sourceVariableKey?: string
  template?: string
}

export interface SetVariableData extends BaseNodeData { actions: VariableAction[] }

export type FormulaExpression =
  | { id: string; kind: 'number'; value: number }
  | { id: string; kind: 'variable'; key: string }
  | { id: string; kind: 'binary'; operator: '+' | '-' | '*' | '/'; left: FormulaExpression; right: FormulaExpression }
  | { id: string; kind: 'function'; name: 'min' | 'max' | 'round' | 'floor' | 'ceil'; args: FormulaExpression[] }

export interface FormulaData extends BaseNodeData { expression: FormulaExpression; targetVariableKey?: string }

export interface QuietHoursRule { enabled: boolean; from: string; to: string; behavior: 'postpone' | 'skip' }

export interface TimerData extends BaseNodeData {
  duration: number
  unit: TimerUnit
  from: 'entry' | 'system_event'
  systemEvent?: string
  continueMode: 'automatic' | 'button'
  buttonText: string
  quietHours: QuietHoursRule
}

export interface WaitUntilData extends BaseNodeData {
  mode: 'fixed' | 'weekday'
  dateTime?: string
  weekday?: number
  time: string
  timezoneMode: 'user' | 'funnel'
  pastBehavior: 'immediate' | 'next_period' | 'skip'
  quietHours: QuietHoursRule
}

export interface ReminderData extends BaseNodeData {
  text: string
  duration: number
  unit: TimerUnit
  maxSends: number
  interval: number
  intervalUnit: TimerUnit
  cancelCondition?: ConditionGroup
  background: boolean
  quietHours: QuietHoursRule
  eventKey: string
}

export interface MediaData extends BaseNodeData {
  assetId?: string
  assetKey: string
  displayName?: string
  expectedType?: MediaType
  caption: string
  sendMode: 'single' | 'album'
  required: boolean
  missingBehavior: 'placeholder' | 'skip' | 'block'
}

export type FormFieldType = 'name' | 'username' | 'phone' | 'email' | 'short_text' | 'long_text' | 'number' | 'date' | 'choice' | 'checkbox' | 'consent' | 'hidden'

export interface FormField {
  id: string
  label: string
  type: FormFieldType
  required: boolean
  variableKey?: string
  placeholder?: string
  options?: NodeOption[]
  validationPattern?: string
  min?: number
  max?: number
  errorText?: string
}

export interface FormData extends BaseNodeData {
  description: string
  fields: FormField[]
  submitText: string
  recordType: 'contact' | 'application' | 'custom'
  applicationStatus?: string
  consentRequired: boolean
  analyticsEvent: string
}

export interface ConsentData extends BaseNodeData {
  text: string
  policyUrl?: string
  consentVersion: string
  acceptText: string
  declineEnabled: boolean
  declineText: string
  variableKey?: string
  analyticsEvent: string
}

export interface ResultBlockData extends BaseNodeData {
  resultSetId?: string
  sourceVariableKey?: string
  singleTemplate: string
  combinedTemplate: string
  visibleFields: string[]
  buttons: MessageButton[]
  analyticsEvent: string
}

export interface ProductBlockData extends BaseNodeData {
  productId?: string
  headline: string
  description: string
  displayPrice: string
  payButtonText: string
  allowSkip: boolean
}

export interface ExternalLinkData extends BaseNodeData {
  url: string
  buttonText: string
  openExternal: boolean
  linkType: 'website' | 'channel' | 'contact' | 'bot' | 'document'
  sourceParams: Record<string, string>
  analyticsEvent: string
}

export interface RandomBranch { id: string; name: string; weight: number }
export interface RandomData extends BaseNodeData {
  branches: RandomBranch[]
  stableByUser: boolean
  variableKey?: string
  analyticsTag?: string
}

export interface SubFunnelData extends BaseNodeData {
  targetFunnelKey: string
  targetEntryKey: string
  variableKeys: string[]
  missingBehavior: 'finish' | 'error'
  analyticsEvent: string
}

export interface EndData extends BaseNodeData {
  text: string
  reasonCode: string
  sessionStatus: 'completed' | 'cancelled' | 'opted_out' | 'external'
  clearVariableKeys: string[]
  analyticsEvent?: string
  reentryAction: 'restart' | 'show_result' | 'stay_finished'
}

export interface CommentData extends BaseNodeData { text: string; color: string }
export interface GroupData extends BaseNodeData { color: string; collapsed: boolean; childNodeIds: string[] }

export type FunnelNodeData = StartData | MessageData | ChoiceData | QuestionData | TestBlockData | ConditionData | SetVariableData | FormulaData | TimerData | WaitUntilData | ReminderData | MediaData | FormData | ConsentData | ResultBlockData | ProductBlockData | ExternalLinkData | RandomData | SubFunnelData | EndData | CommentData | GroupData

export interface FunnelNode {
  id: string
  type: NodeType
  data: FunnelNodeData
  /** Only accepted for legacy passthrough. Runtime layout lives in editor.nodePositions. */
  position?: Position
  [key: string]: unknown
}

export interface FunnelEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  label?: string
  visual?: { lineType?: 'bezier' | 'straight' | 'step'; color?: string }
  [key: string]: unknown
}

export interface FunnelVariable {
  id: string
  key: string
  name: string
  type: VariableType
  description: string
  defaultValue: VariableValue
  scope: VariableScope
  sensitive: boolean
  transferable: boolean
  printable: boolean
  [key: string]: unknown
}

export interface TestScale {
  id: string
  code: string
  name: string
  description: string
  color: string
  direction: 'strength' | 'resource'
  normalization: 'raw' | 'fixed_percent' | 'dynamic_percent' | 'range'
  maxValue?: number
  rangeMin?: number
  rangeMax?: number
  precision: number
  [key: string]: unknown
}

export interface TestAnswer extends NodeOption { scoring: ScoringAction[] }

export interface TestQuestion {
  id: string
  type: 'single' | 'multiple' | 'scale' | 'number' | 'text'
  text: string
  description?: string
  enabled: boolean
  required: boolean
  answers: TestAnswer[]
  min?: number
  max?: number
  assetId?: string
  explanation?: string
  shuffleAnswers: boolean
  analyticsTag?: string
  abGroup?: string
  [key: string]: unknown
}

export interface FunnelTest {
  id: string
  key: string
  name: string
  description: string
  status: FunnelStatus
  questions: TestQuestion[]
  scales: TestScale[]
  shuffleQuestions: boolean
  resultSetId?: string
  resultVariableKey?: string
  [key: string]: unknown
}

export interface ResultContent {
  id: string
  code: string
  title: string
  shortText: string
  text: string
  sections: Array<{ id: string; title: string; text: string }>
  recommendations: string[]
  assetIds: string[]
  buttons: MessageButton[]
  applicability?: ConditionGroup
  contentVersion: number
  scaleIds: string[]
  combined: boolean
  [key: string]: unknown
}

export interface ResultRule {
  id: string
  type: 'top' | 'threshold' | 'range' | 'combination' | 'closeness' | 'fallback'
  resultCode?: string
  scaleIds?: string[]
  topN?: number
  threshold?: number
  min?: number
  max?: number
  closenessPoints?: number
  priority: number
  [key: string]: unknown
}

export interface ResultSet {
  id: string
  key: string
  name: string
  results: ResultContent[]
  rules: ResultRule[]
  fallbackResultCode?: string
  tieBreaker: 'scale_order' | 'code'
  [key: string]: unknown
}

export interface FunnelAsset {
  id: string
  assetKey: string
  displayName: string
  expectedType: MediaType
  required: boolean
  description: string
  expectedMimeTypes: string[]
  recommendedFilename?: string
  maxSizeMb?: number
  maxDurationSeconds?: number
  nodeId?: string
  [key: string]: unknown
}

export interface FunnelProduct {
  id: string
  productKey: string
  name: string
  description: string
  type: 'digital' | 'consultation' | 'course' | 'preorder' | 'other'
  priceMinor: number
  currency: string
  active: boolean
  provider: 'yookassa' | 'future'
  assetIds: string[]
  personalization: Array<{ resultCode: string; assetId: string }>
  fallbackAssetId?: string
  successText: string
  repurchasePolicy: 'allow' | 'deny' | 'redeliver'
  analytics: Record<string, string>
  [key: string]: unknown
}

export interface FunnelSettings {
  session: {
    inactivityDays: number
    expirationAction: 'finish'
    keepVersionForActiveUsers: boolean
    reentryPolicy: 'continue' | 'restart' | 'show_result' | 'branch'
    retakePolicy: 'allow' | 'deny' | 'after_period'
    clearVariableKeys: string[]
  }
  schedule: {
    timezone: string
    userTimezoneMode: 'telegram' | 'ask' | 'funnel'
    fallbackTimezone: string
    quietHours: QuietHoursRule
    weeklyWindows: Array<{ id: string; weekdays: number[]; from: string; to: string }>
    maxBackgroundTouchesPerDay: number
  }
  sources: {
    expected: string[]
    labels: Record<string, string>
    initialValues: Record<string, Record<string, VariableValue>>
  }
  optOut: {
    command: string
    finalText: string
    blockBackground: boolean
    allowExplicitRestart: boolean
  }
  [key: string]: unknown
}

export interface NodeAnalytics { entered: number; completed: number; dropped?: number; averageSeconds?: number; errors?: number; reentries?: number; [key: string]: unknown }
export interface EdgeAnalytics { transitions: number; uniqueUsers?: number; abGroup?: string; [key: string]: unknown }

export interface ContactRecord {
  id: string
  name?: string
  username?: string
  phone?: string
  email?: string
  source?: string
  resultCode?: string
  createdAt?: string
  [key: string]: unknown
}

export interface ApplicationRecord {
  id: string
  contactId?: string
  status?: string
  source?: string
  resultCode?: string
  createdAt?: string
  comment?: string
  [key: string]: unknown
}

export interface FunnelAnalytics {
  snapshotAt: string | null
  funnelVersion: number
  period?: { from: string | null; to: string | null }
  completeness?: { level: 'aggregate' | 'events' | 'journeys'; sections: string[] }
  summary: {
    totalUsers?: number
    started: number
    completed: number
    active?: number
    optedOut?: number
    averageDurationSeconds?: number
    medianDurationSeconds?: number
    [key: string]: unknown
  }
  nodes: Record<string, NodeAnalytics>
  edges: Record<string, EdgeAnalytics>
  tests?: Record<string, unknown>
  questions: Record<string, unknown>
  results?: Record<string, unknown>
  products?: Record<string, unknown>
  payments?: Array<Record<string, unknown>>
  reminders?: Record<string, unknown>
  sources?: Record<string, unknown>
  contacts: ContactRecord[]
  applications: ApplicationRecord[]
  events?: Array<Record<string, unknown>>
  journeys?: Array<Record<string, unknown>>
  [key: string]: unknown
}

export interface TestScenario {
  id: string
  name: string
  systemValues: Record<string, VariableValue>
  answers: Record<string, VariableValue>
  paymentOutcomes: Record<string, string>
  seed: string
  expectedEndNodeId?: string
  expectedResultCode?: string
  expectedVariables: Record<string, VariableValue>
  [key: string]: unknown
}

export interface FunnelEditorData {
  nodePositions: Record<string, Position>
  viewport?: { x: number; y: number; zoom: number }
  collapsedNodeIds: string[]
  groups: Array<{ id: string; title: string; color: string; nodeIds: string[]; collapsed: boolean }>
  comments: Array<{ id: string; text: string; position: Position; color: string }>
  lastValidation?: { at: string; errors: number; warnings: number; advice: number }
  migration?: { from: string; at: string }
  [key: string]: unknown
}

export interface FunnelDocument {
  documentType: 'funnel'
  schemaVersion: '1.0.0'
  project: { id: string; name: string; description: string; [key: string]: unknown }
  funnel: {
    id: string
    key: string
    name: string
    description: string
    version: number
    parentVersion?: number
    changeComment?: string
    status: FunnelStatus
    startNodeId: string
    entryKey: string
    tags: string[]
    createdAt: string
    updatedAt: string
    [key: string]: unknown
  }
  settings: FunnelSettings
  variables: FunnelVariable[]
  nodes: FunnelNode[]
  edges: FunnelEdge[]
  tests: FunnelTest[]
  resultSets: ResultSet[]
  assets: FunnelAsset[]
  products: FunnelProduct[]
  testScenarios: TestScenario[]
  analytics: FunnelAnalytics
  editor: FunnelEditorData
  [key: string]: unknown
}

export interface ValidationIssue {
  severity: IssueSeverity
  section: 'structure' | 'graph' | 'variables' | 'content' | 'tests' | 'media' | 'products' | 'schedule' | 'analytics'
  code: string
  message: string
  path?: string
  nodeId?: string
  edgeId?: string
  entityId?: string
  fix?: 'remove_orphan_edge' | 'create_else_branch' | 'reset_analytics'
}

export interface DraftSummary {
  id: string
  name: string
  version: number
  status: FunnelStatus
  schemaVersion: string
  updatedAt: string
  nodeCount: number
  errors: number
  warnings: number
  document: FunnelDocument
}

export interface DraftRevision {
  id: string
  draftId: string
  createdAt: string
  reason: string
  nodeCount: number
  document: FunnelDocument
}

export interface MigrationNotice { from: string; to: string; messages: string[] }

export interface ImportResultSuccess {
  success: true
  document: FunnelDocument
  issues: ValidationIssue[]
  migration?: MigrationNotice
  analyticsIsolated?: boolean
}

export interface ImportResultFailure { success: false; errors: string[] }
export type ImportResult = ImportResultSuccess | ImportResultFailure

export interface EntityDiff<T = unknown> { id: string; status: 'added' | 'removed' | 'changed'; before?: T; after?: T; changes?: string[] }
export interface FunnelDiff {
  sameFunnel: boolean
  summary: { added: number; removed: number; changed: number }
  sections: Record<string, EntityDiff[]>
  analytics: { startedDelta: number; completedDelta: number; conversionDelta: number }
}
