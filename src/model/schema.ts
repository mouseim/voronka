import { z } from 'zod'
import type { FunnelDocument } from './types'

const positionSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).passthrough()
const scoreSchema = z.record(z.number().finite())
const optionSchema = z.object({
  id: z.string(),
  text: z.string(),
  scores: scoreSchema.optional(),
}).passthrough()

const baseNodeSchema = {
  id: z.string(),
  position: positionSchema,
}

const nodeSchema = z.discriminatedUnion('type', [
  z.object({ ...baseNodeSchema, type: z.literal('start'), data: z.object({ title: z.string(), note: z.string() }).passthrough() }).passthrough(),
  z.object({ ...baseNodeSchema, type: z.literal('message'), data: z.object({ title: z.string(), text: z.string(), note: z.string(), continueEnabled: z.boolean(), buttonText: z.string() }).passthrough() }).passthrough(),
  z.object({ ...baseNodeSchema, type: z.literal('choice'), data: z.object({ title: z.string(), prompt: z.string(), options: z.array(optionSchema) }).passthrough() }).passthrough(),
  z.object({ ...baseNodeSchema, type: z.literal('question'), data: z.object({ title: z.string(), question: z.string(), answers: z.array(optionSchema) }).passthrough() }).passthrough(),
  z.object({ ...baseNodeSchema, type: z.literal('timer'), data: z.object({ title: z.string(), duration: z.number(), unit: z.enum(['minutes', 'hours', 'days']), note: z.string() }).passthrough() }).passthrough(),
  z.object({ ...baseNodeSchema, type: z.literal('media'), data: z.object({ title: z.string(), assetKey: z.string(), displayName: z.string(), expectedType: z.enum(['image', 'video', 'audio', 'voice', 'video_note', 'document']), caption: z.string(), required: z.boolean() }).passthrough() }).passthrough(),
  z.object({ ...baseNodeSchema, type: z.literal('end'), data: z.object({ title: z.string(), text: z.string(), note: z.string() }).passthrough() }).passthrough(),
])

const edgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
  label: z.string().optional(),
}).passthrough()

const assetSchema = z.object({
  assetKey: z.string(),
  displayName: z.string(),
  expectedType: z.enum(['image', 'video', 'audio', 'voice', 'video_note', 'document']),
  required: z.boolean(),
  nodeId: z.string().optional(),
}).passthrough()

const nodeAnalyticsSchema = z.object({ entered: z.number().nonnegative(), completed: z.number().nonnegative(), dropped: z.number().nonnegative().optional() }).passthrough()
const edgeAnalyticsSchema = z.object({ transitions: z.number().nonnegative() }).passthrough()
const contactSchema = z.object({ id: z.string(), name: z.string().optional(), username: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), createdAt: z.string().optional() }).passthrough()
const applicationSchema = z.object({ id: z.string(), contactId: z.string().optional(), status: z.string().optional(), createdAt: z.string().optional(), comment: z.string().optional() }).passthrough()

export const funnelSchema = z.object({
  documentType: z.literal('funnel'),
  schemaVersion: z.string(),
  project: z.object({ id: z.string(), name: z.string(), description: z.string() }).passthrough(),
  funnel: z.object({
    id: z.string(),
    name: z.string(),
    version: z.number().int().positive(),
    status: z.enum(['draft', 'published', 'archived']),
    startNodeId: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }).passthrough(),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
  assets: z.array(assetSchema),
  analytics: z.object({
    snapshotAt: z.string().nullable(),
    funnelVersion: z.number().int().positive(),
    summary: z.object({ totalUsers: z.number().nonnegative().optional(), started: z.number().nonnegative(), completed: z.number().nonnegative() }).passthrough(),
    nodes: z.record(nodeAnalyticsSchema),
    edges: z.record(edgeAnalyticsSchema),
    questions: z.record(z.unknown()),
    contacts: z.array(contactSchema),
    applications: z.array(applicationSchema),
  }).passthrough(),
}).passthrough()

export function parseFunnelDocument(value: unknown): { success: true; data: FunnelDocument } | { success: false; errors: string[] } {
  const result = funnelSchema.safeParse(value)
  if (result.success) return { success: true, data: result.data as FunnelDocument }
  return {
    success: false,
    errors: result.error.issues.map((issue) => `${issue.path.join('.') || 'document'}: ${issue.message}`),
  }
}
