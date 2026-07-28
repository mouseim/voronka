export type NodeType =
  | 'start'
  | 'message'
  | 'media'
  | 'timer'
  | 'variable'
  | 'condition'
  | 'test'
  | 'form'
  | 'consent'
  | 'product'
  | 'external_link'
  | 'end'

export type FunnelStatus = 'draft' | 'published' | 'archived'
export type TimerUnit = 'minutes' | 'hours' | 'days'
export type MediaType = 'image' | 'video' | 'audio' | 'voice' | 'video_note' | 'document' | 'animation'
export type QuestionType = 'single' | 'multiple' | 'scale' | 'number' | 'text'
export type IssueSeverity = 'error' | 'warning' | 'advice'
export type WorkspaceSection = 'variables' | 'tests' | 'media' | 'products' | 'bot'
export type VariableType = 'text' | 'number' | 'boolean'
export type VariableValue = string | number | boolean
export type VariableOperationKind = 'set' | 'add' | 'subtract' | 'toggle' | 'reset'
export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'greater'
  | 'greater_or_equal'
  | 'less'
  | 'less_or_equal'
  | 'contains'
  | 'not_contains'
  | 'is_empty'
  | 'is_not_empty'
  | 'is_true'
  | 'is_false'

export interface Position {
  x: number
  y: number
}

export interface BaseNodeData {
  title: string
}

export interface StartData extends BaseNodeData {}

export interface MessageButton {
  id: string
  text: string
  action: 'branch' | 'url' | 'product'
  url?: string
  productId?: string
}

export interface MessageData extends BaseNodeData {
  text: string
  buttons: MessageButton[]
}

export interface MediaData extends BaseNodeData {
  assetId?: string
  caption: string
  required: boolean
}

export interface TimerData extends BaseNodeData {
  duration: number
  unit: TimerUnit
  respectQuietHours: boolean
}

export interface VariableOperation {
  id: string
  variableId?: string
  operation: VariableOperationKind
  value?: VariableValue
}

export interface VariableData extends BaseNodeData {
  operations: VariableOperation[]
}

export interface ConditionData extends BaseNodeData {
  variableId?: string
  operator: ConditionOperator
  value?: VariableValue
}

export interface TestBlockData extends BaseNodeData {
  testId?: string
  welcomeText: string
}

export type FormFieldType = 'name' | 'username' | 'phone' | 'email' | 'text'

export interface FormField {
  id: string
  type: FormFieldType
  label: string
  required: boolean
}

export interface FormData extends BaseNodeData {
  introText: string
  fields: FormField[]
  submitText: string
  confirmationText: string
}

export interface ConsentData extends BaseNodeData {
  text: string
  policyUrl: string
  acceptText: string
  declineEnabled: boolean
  declineText: string
}

export interface ProductBlockData extends BaseNodeData {
  productId?: string
  headline: string
  description: string
  price: number
  payButtonText: string
  allowSkip: boolean
}

export interface ExternalLinkData extends BaseNodeData {
  text: string
  buttonText: string
  url: string
  continueAfterClick: boolean
}

export interface EndData extends BaseNodeData {
  text: string
}

export type FunnelNodeData =
  | StartData
  | MessageData
  | MediaData
  | TimerData
  | VariableData
  | ConditionData
  | TestBlockData
  | FormData
  | ConsentData
  | ProductBlockData
  | ExternalLinkData
  | EndData

export interface FunnelNode {
  id: string
  type: NodeType
  data: FunnelNodeData
  position?: Position
}

export interface FunnelEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  label?: string
}

export interface TestScale {
  id: string
  code: string
  name: string
  color: string
}

export interface TestAnswer {
  id: string
  text: string
  scores: Record<string, number>
}

export interface TestQuestion {
  id: string
  text: string
  type: QuestionType
  enabled: boolean
  required: boolean
  answers: TestAnswer[]
  shuffleAnswers: boolean
  scaleMin?: number
  scaleMax?: number
}

export interface ResultButton {
  id: string
  text: string
  action: 'branch' | 'url' | 'product'
  url?: string
  productId?: string
}

export interface TestResult {
  id: string
  scaleId: string
  name: string
  shortText: string
  fullText: string
  recommendations: string
  assetId?: string
  buttons: ResultButton[]
}

export interface CombinedTestResult {
  id: string
  scaleIds: [string, string]
  name: string
  shortText: string
  fullText: string
  recommendations: string
  assetId?: string
  buttons: ResultButton[]
}

export interface FunnelTest {
  id: string
  name: string
  description: string
  shuffleQuestions: boolean
  scales: TestScale[]
  questions: TestQuestion[]
  results: TestResult[]
  combinedResults: CombinedTestResult[]
  calculation: {
    method: 'dynamic_percent'
    proximityThreshold: number
    useCombinedResults: boolean
    missingCombination: 'primary'
  }
}

export interface MediaAsset {
  id: string
  key: string
  name: string
  type: MediaType
  required: boolean
  logicalRef: string
}

export interface Product {
  id: string
  key: string
  name: string
  description: string
  price: number
  active: boolean
  assetId?: string
  afterPurchaseText: string
}

export interface FunnelVariable {
  id: string
  key: string
  name: string
  type: VariableType
  defaultValue: VariableValue
}

export interface TrackingLink {
  id: string
  name: string
  code: string
  source: string
  campaign: string
  content?: string
  active: boolean
}

export interface BotSettings {
  displayName: string
  username: string
  timezone: string
  inactivityDays: number
  quietHours: {
    enabled: boolean
    from: string
    to: string
    behavior: 'postpone' | 'skip'
  }
  reentryPolicy: 'continue' | 'restart' | 'show_result'
  optOut: {
    command: string
    confirmationText: string
    blockBackground: boolean
    allowRestart: boolean
  }
  reminders: {
    maxCount: number
    cancelAfterContinue: boolean
    respectQuietHours: boolean
  }
  trackingLinks: TrackingLink[]
}

export interface NodeAnalytics {
  entered: number
  completed: number
  dropped?: number
}

export interface SourceAnalytics {
  arrived: number
  started: number
  completed: number
  applications: number
  purchases: number
  revenue: number
}

export interface FunnelAnalytics {
  snapshotAt: string | null
  funnelVersion: number
  summary: {
    totalUsers: number
    started: number
    completed: number
    applications: number
    purchases: number
    revenue: number
  }
  nodes: Record<string, NodeAnalytics>
  tests: Record<string, Record<string, number>>
  questions: Record<string, Record<string, number>>
  results: Record<string, Record<string, number | string>>
  products: Record<string, Record<string, number>>
  sources: Record<string, SourceAnalytics>
  contacts: Array<{ id: string; name?: string; username?: string; phone?: string; email?: string; source?: string; result?: string; createdAt?: string }>
  applications: Array<{ id: string; contact?: string; source?: string; status?: string; result?: string; createdAt?: string; comment?: string }>
}

export interface FunnelEditor {
  nodePositions: Record<string, Position>
  collapsedNodeIds: string[]
}

export interface FunnelDocument {
  documentType: 'funnel'
  schemaVersion: '3.0.0'
  project: {
    id: string
    name: string
    description: string
  }
  funnel: {
    id: string
    key: string
    name: string
    description: string
    version: number
    status: FunnelStatus
    startNodeId: string
    createdAt: string
    updatedAt: string
    parentVersion?: number
    changeComment?: string
  }
  bot: BotSettings
  variables: FunnelVariable[]
  nodes: FunnelNode[]
  edges: FunnelEdge[]
  tests: FunnelTest[]
  assets: MediaAsset[]
  products: Product[]
  analytics: FunnelAnalytics
  editor: FunnelEditor
}

export interface ValidationIssue {
  severity: IssueSeverity
  section: 'structure' | 'content' | 'variables' | 'tests' | 'media' | 'products' | 'bot' | 'analytics'
  code: string
  message: string
  nodeId?: string
  path?: string
}

export interface NodeHandle {
  id: string
  label: string
}

export interface MigrationNotice {
  level: 'info' | 'warning'
  message: string
}

export type ImportResult =
  | { success: true; document: FunnelDocument; issues?: ValidationIssue[]; notices?: MigrationNotice[] }
  | { success: false; errors: string[] }

export type ImportResultSuccess = Extract<ImportResult, { success: true }>

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

export interface CalculatedTestResult {
  scores: Record<string, number>
  maximums: Record<string, number>
  percentages: Record<string, number>
  primary: TestResult
  secondary?: TestResult
  combined?: CombinedTestResult
  chosenResultId: string
  explanation: string
}

export interface SimulationStep {
  nodeId: string
  nodeType: NodeType
  title: string
  text: string
  choices?: NodeHandle[]
}

export interface SimulationState {
  currentNodeId: string | null
  steps: SimulationStep[]
  finished: boolean
  elapsedMinutes: number
  answers: Record<string, string | string[] | number>
  variables: Record<string, VariableValue>
  testResult?: CalculatedTestResult
}
