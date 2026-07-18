export type NodeType = 'start' | 'message' | 'choice' | 'question' | 'timer' | 'media' | 'end'
export type TimerUnit = 'minutes' | 'hours' | 'days'
export type MediaType = 'image' | 'video' | 'audio' | 'voice' | 'video_note' | 'document'

export interface Position {
  x: number
  y: number
}

export interface ScoreMap {
  [scale: string]: number
}

export interface NodeOption {
  id: string
  text: string
  scores?: ScoreMap
  [key: string]: unknown
}

export interface StartData {
  title: string
  note: string
  [key: string]: unknown
}

export interface MessageData {
  title: string
  text: string
  note: string
  continueEnabled: boolean
  buttonText: string
  [key: string]: unknown
}

export interface ChoiceData {
  title: string
  prompt: string
  options: NodeOption[]
  [key: string]: unknown
}

export interface QuestionData {
  title: string
  question: string
  answers: NodeOption[]
  [key: string]: unknown
}

export interface TimerData {
  title: string
  duration: number
  unit: TimerUnit
  note: string
  [key: string]: unknown
}

export interface MediaData {
  title: string
  assetKey: string
  displayName: string
  expectedType: MediaType
  caption: string
  required: boolean
  [key: string]: unknown
}

export interface EndData {
  title: string
  text: string
  note: string
  [key: string]: unknown
}

export type FunnelNodeData = StartData | MessageData | ChoiceData | QuestionData | TimerData | MediaData | EndData

export interface FunnelNode {
  id: string
  type: NodeType
  position: Position
  data: FunnelNodeData
  [key: string]: unknown
}

export interface FunnelEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  label?: string
  [key: string]: unknown
}

export interface FunnelAsset {
  assetKey: string
  displayName: string
  expectedType: MediaType
  required: boolean
  nodeId?: string
  [key: string]: unknown
}

export interface NodeAnalytics {
  entered: number
  completed: number
  dropped?: number
  [key: string]: unknown
}

export interface EdgeAnalytics {
  transitions: number
  [key: string]: unknown
}

export interface ContactRecord {
  id: string
  name?: string
  username?: string
  phone?: string
  email?: string
  createdAt?: string
  [key: string]: unknown
}

export interface ApplicationRecord {
  id: string
  contactId?: string
  status?: string
  createdAt?: string
  comment?: string
  [key: string]: unknown
}

export interface FunnelAnalytics {
  snapshotAt: string | null
  funnelVersion: number
  summary: {
    totalUsers?: number
    started: number
    completed: number
    [key: string]: unknown
  }
  nodes: Record<string, NodeAnalytics>
  edges: Record<string, EdgeAnalytics>
  questions: Record<string, unknown>
  contacts: ContactRecord[]
  applications: ApplicationRecord[]
  [key: string]: unknown
}

export interface FunnelDocument {
  documentType: 'funnel'
  schemaVersion: string
  project: {
    id: string
    name: string
    description: string
    [key: string]: unknown
  }
  funnel: {
    id: string
    name: string
    version: number
    status: 'draft' | 'published' | 'archived'
    startNodeId: string
    createdAt: string
    updatedAt: string
    [key: string]: unknown
  }
  nodes: FunnelNode[]
  edges: FunnelEdge[]
  assets: FunnelAsset[]
  analytics: FunnelAnalytics
  [key: string]: unknown
}

export interface ValidationIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
  path?: string
  nodeId?: string
  edgeId?: string
}

export interface DraftSummary {
  id: string
  name: string
  version: number
  updatedAt: string
  nodeCount: number
  document: FunnelDocument
}
