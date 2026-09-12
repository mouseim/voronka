import { describe, expect, it } from 'vitest'
import {
  calculateTestResult,
  nodeHandles,
  parseAndMigrateFunnelDocument,
  validateFunnel,
  type FunnelNode,
} from '../src/core/shared'
import { loadDemo } from './helpers'

describe('единый .funnel 3.0 contract', () => {
  it('импортирует demo 3.0 и сохраняет passthrough-поля', async () => {
    const demo = await loadDemo()
    const withFutureFields = structuredClone(demo) as typeof demo & { futureRuntime?: { enabled: boolean } }
    withFutureFields.futureRuntime = { enabled: true }
    const parsed = parseAndMigrateFunnelDocument(withFutureFields)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect((parsed.document as typeof withFutureFields).futureRuntime).toEqual({ enabled: true })
      expect(JSON.parse(JSON.stringify(parsed.document)).nodes).toHaveLength(demo.nodes.length)
    }
    expect(validateFunnel(demo).filter((issue) => issue.severity === 'error')).toEqual([])
  })

  it('отклоняет старый major и неподдерживаемую новую minor', async () => {
    const demo = await loadDemo()
    expect(parseAndMigrateFunnelDocument({ ...demo, schemaVersion: '1.9.0' }).success).toBe(false)
    expect(parseAndMigrateFunnelDocument({ ...demo, schemaVersion: '3.1.0' }).success).toBe(false)
  })

  it('имеет серверную семантику handles для всех 12 типов блоков', async () => {
    const demo = await loadDemo()
    const handles = Object.fromEntries(demo.nodes.map((node) => [node.type, nodeHandles(node as FunnelNode, demo)]))
    const externalLink: FunnelNode = {
      id: 'contract-external-link',
      type: 'external_link',
      data: { title: 'Ссылка', text: 'Открыть', buttonText: 'Открыть', url: 'https://example.com', continueAfterClick: true },
    }
    handles.external_link = nodeHandles(externalLink, demo)
    expect(Object.keys(handles).sort()).toEqual([
      'condition', 'consent', 'end', 'external_link', 'form', 'media', 'message', 'product', 'start', 'test', 'timer', 'variable',
    ])
    expect(handles.condition.map((handle) => handle.id)).toEqual(['true', 'false'])
    expect(handles.consent.map((handle) => handle.id)).toEqual(expect.arrayContaining(['accepted', 'declined']))
    expect(handles.form.map((handle) => handle.id)).toEqual(expect.arrayContaining(['submitted', 'cancelled']))
    expect(handles.product.map((handle) => handle.id)).toEqual(expect.arrayContaining(['paid', 'failed', 'already_purchased', 'skip']))
  })

  it('использует тот же scoring и детерминированную ничью', async () => {
    const demo = await loadDemo()
    const test = demo.tests[0]!
    const answers = Object.fromEntries(test.questions.map((question) => [question.id, question.answers[0]!.id]))
    const first = calculateTestResult(test, answers)
    const second = calculateTestResult(test, answers)
    expect(second).toEqual(first)
    expect(first.maximums).toBeDefined()
    expect(first.primary.id).toBeTruthy()
  })
})
