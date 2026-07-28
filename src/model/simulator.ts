import { nodeHandles, nodeTitle } from './funnel'
import { initialVariableValues } from './variables'
import type { FunnelDocument, FunnelNode, SimulationState, SimulationStep, TestBlockData } from './types'

export function createSimulation(document: FunnelDocument): SimulationState {
  return {
    currentNodeId: document.funnel.startNodeId,
    steps: [],
    finished: false,
    elapsedMinutes: 0,
    answers: {},
    variables: initialVariableValues(document.variables),
  }
}

export function visibleStep(document: FunnelDocument, node: FunnelNode): SimulationStep {
  const data = node.data as unknown as Record<string, unknown>
  const text = String(
    data.text
    ?? data.welcomeText
    ?? data.introText
    ?? data.caption
    ?? data.headline
    ?? '',
  )
  return { nodeId: node.id, nodeType: node.type, title: nodeTitle(node), text, choices: nodeHandles(node, document) }
}

export function nextNodeId(document: FunnelDocument, sourceId: string, handleId = 'next'): string | null {
  return document.edges.find((edge) => edge.source === sourceId && (edge.sourceHandle ?? 'next') === handleId)?.target ?? null
}

export function testForNode(document: FunnelDocument, node: FunnelNode) {
  return node.type === 'test'
    ? document.tests.find((test) => test.id === (node.data as TestBlockData).testId)
    : undefined
}
