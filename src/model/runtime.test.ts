import { describe, expect, it } from 'vitest'
import { freshDemoFunnel } from './demo'
import { nodeHandles } from './funnel'
import { calculateTestResult } from './scoring'
import { parseAndMigrateFunnelDocument } from './schema'

describe('подробный scoring', () => {
  it('результаты теста создают подписанные выходы на графе', () => {
    const document = freshDemoFunnel()
    const node = document.nodes.find((item) => item.type === 'test')!
    const handles = nodeHandles(node, document)
    expect(handles).toHaveLength(8)
    expect(handles).toContainEqual({ id: 'result_s1', label: 'Быть нужной' })
    expect(handles).toContainEqual({ id: 'result_s1_s2', label: 'Быть нужной + Контроль' })
  })

  it('полный демонстрационный scoring детерминирован', () => {
    const test = freshDemoFunnel().tests[0]
    const answers = Object.fromEntries(test.questions.map((question) => [question.id, question.answers[0].id]))
    const first = calculateTestResult(test, answers)
    const second = calculateTestResult(test, answers)
    expect(first).toEqual(second)
    expect(first.primary.name).toBe('Быть нужной')
    expect(first.percentages.scale_s1).toBe(100)
  })

  it('динамический максимум учитывает только активные вопросы', () => {
    const test = structuredClone(freshDemoFunnel().tests[0])
    test.questions[1].enabled = false
    const answers = Object.fromEntries(test.questions.map((question) => [question.id, question.answers[0].id]))
    const result = calculateTestResult(test, answers)
    expect(result.maximums.scale_s1).toBe(18)
    expect(result.scores.scale_s1).toBe(18)
    expect(result.percentages.scale_s1).toBe(100)
  })

  it('выбирает комбинированный результат при близких процентах', () => {
    const test = structuredClone(freshDemoFunnel().tests[0])
    test.questions.forEach((question, index) => {
      question.answers.forEach((answer) => { answer.scores = {} })
      question.answers[0].scores.scale_s1 = index < 4 ? 3 : 2
      question.answers[0].scores.scale_s2 = index < 3 ? 3 : 2
    })
    const answers = Object.fromEntries(test.questions.map((question) => [question.id, question.answers[0].id]))
    const result = calculateTestResult(test, answers)
    expect(result.combined?.id).toBe('result_s1_s2')
    expect(result.chosenResultId).toBe('result_s1_s2')
  })
})

describe('цикл файла', () => {
  it('экспорт и повторный импорт не теряют ветки, scoring и статистику', () => {
    const source = freshDemoFunnel()
    const serialized = JSON.parse(JSON.stringify(source))
    const result = parseAndMigrateFunnelDocument(serialized)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.document.edges).toEqual(source.edges)
    expect(result.document.tests).toEqual(source.tests)
    expect(result.document.analytics).toEqual(source.analytics)
    expect(result.document.bot.trackingLinks).toEqual(source.bot.trackingLinks)
  })

  it('статистика источника читается по стабильному ID ссылки', () => {
    const document = freshDemoFunnel()
    const link = document.bot.trackingLinks[0]
    expect(document.analytics.sources[link.id]).toMatchObject({ started: 840, completed: 548, applications: 261, purchases: 184 })
  })
})
