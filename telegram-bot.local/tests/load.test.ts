import { describe, expect, it } from 'vitest'
import { calculateTestResult, parseAndMigrateFunnelDocument, validateFunnel } from '../src/core/shared'
import { toCsv } from '../src/analytics/csv'
import { loadDemo } from './helpers'

describe('нагрузочные сценарии', () => {
  it('считает 100 вопросов и сериализует несколько тысяч событий', async () => {
    const document = await loadDemo()
    const base = document.tests[0]!.questions[0]!
    const test = structuredClone(document.tests[0]!)
    test.questions = Array.from({ length: 100 }, (_, index) => ({
      ...structuredClone(base),
      id: `load-question-${index}`,
      text: `Вопрос ${index}`,
      answers: base.answers.map((answer, answerIndex) => ({ ...answer, id: `load-answer-${index}-${answerIndex}` })),
    }))
    const answers = Object.fromEntries(test.questions.map((question) => [question.id, question.answers[0]!.id]))
    const result = calculateTestResult(test, answers)
    expect(result.primary.id).toBeTruthy()

    const csv = toCsv(Array.from({ length: 3_000 }, (_, index) => ({
      id: index,
      event: 'node_entered',
      payload: { index },
    }))).toString('utf8')
    expect(csv.split('\r\n')).toHaveLength(3_002)
  })

  it('валидирует цепочку из 300 блоков и повторно импортирует её', async () => {
    const document = await loadDemo()
    const start = document.nodes.find((node) => node.type === 'start')!
    const end = document.nodes.find((node) => node.type === 'end')!
    const messages = Array.from({ length: 298 }, (_, index) => ({
      id: `load-node-${index}`,
      type: 'message' as const,
      data: { title: `Шаг ${index}`, text: `Текст ${index}`, buttons: [] },
      position: { x: index * 10, y: 0 },
    }))
    document.nodes = [start, ...messages, end]
    document.funnel.startNodeId = start.id
    document.edges = document.nodes.slice(0, -1).map((node, index) => ({
      id: `load-edge-${index}`,
      source: node.id,
      target: document.nodes[index + 1]!.id,
      sourceHandle: 'next',
    }))
    document.tests = []
    document.assets = []
    document.products = []
    expect(validateFunnel(document).filter((issue) => issue.severity === 'error')).toEqual([])
    expect(parseAndMigrateFunnelDocument(JSON.parse(JSON.stringify(document))).success).toBe(true)
  })
})
