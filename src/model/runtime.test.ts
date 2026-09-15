import { describe, expect, it } from 'vitest'
import { freshDemoFunnel } from './demo'
import { nodeHandles } from './funnel'
import { calculateTestResult } from './scoring'
import { parseAndMigrateFunnelDocument } from './schema'

describe('подробный scoring', () => {
  it('результаты теста создают подписанные выходы на графе', () => {
    const document = freshDemoFunnel()
    const node = document.nodes.find((item) => item.type === 'test')!
    const test = document.tests[0]!
    const handles = nodeHandles(node, document)

    expect(handles).toHaveLength(test.results.length + test.combinedResults.length)
    expect(handles.map((handle) => handle.id)).toContain('result_s1')
    expect(handles.map((handle) => handle.id)).toContain('result_s1_s2')
  })

  it('полный демонстрационный scoring детерминирован', () => {
    const test = freshDemoFunnel().tests[0]
    const answers = Object.fromEntries(test.questions.map((question) => {
      const answer = [...question.answers].sort(
        (left, right) => (right.scores.scale_s1 ?? 0) - (left.scores.scale_s1 ?? 0),
      )[0]!
      return [question.id, answer.id]
    }))

    const first = calculateTestResult(test, answers)
    const second = calculateTestResult(test, answers)

    expect(first).toEqual(second)
    expect(first.primary.id).toBe('result_s1')
    expect(first.percentages.scale_s1).toBe(100)
  })

  it('динамический максимум учитывает только активные вопросы', () => {
    const test = structuredClone(freshDemoFunnel().tests[0])
    const disabled = test.questions.find((question) =>
      Math.max(...question.answers.map((answer) => answer.scores.scale_s1 ?? 0)) > 0
    )!
    disabled.enabled = false

    const answers = Object.fromEntries(test.questions.map((question) => {
      const answer = [...question.answers].sort(
        (left, right) => (right.scores.scale_s1 ?? 0) - (left.scores.scale_s1 ?? 0),
      )[0]!
      return [question.id, answer.id]
    }))

    const expectedMaximum = test.questions
      .filter((question) => question.enabled)
      .reduce((sum, question) =>
        sum + Math.max(...question.answers.map((answer) => answer.scores.scale_s1 ?? 0)),
      0)

    const result = calculateTestResult(test, answers)

    expect(result.maximums.scale_s1).toBe(expectedMaximum)
    expect(result.scores.scale_s1).toBe(expectedMaximum)
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

  it('округляет проценты и не считает ровно 8 п.п. близкими', () => {
    const test = structuredClone(freshDemoFunnel().tests[0])
    test.scales = test.scales.slice(0, 2)
    test.results = test.results.filter((result) => test.scales.some((scale) => scale.id === result.scaleId))
    test.questions = [{
      id: 'q_exact_8',
      text: 'Проверка',
      type: 'single',
      enabled: true,
      required: true,
      shuffleAnswers: false,
      answers: [
        { id: 'chosen', text: 'Выбранный', scores: { scale_s1: 100, scale_s2: 92 } },
        { id: 'maximum', text: 'Максимум', scores: { scale_s1: 100, scale_s2: 100 } },
      ],
    }]
    const result = calculateTestResult(test, { q_exact_8: 'chosen' })
    expect(result.percentages).toMatchObject({ scale_s1: 100, scale_s2: 92 })
    expect(result.combined).toBeUndefined()
    expect(result.chosenResultId).toBe('result_s1')
  })

  it('при трёх шкалах в коридоре выбирает топ-2 по сырым баллам', () => {
    const test = structuredClone(freshDemoFunnel().tests[0])
    test.scales = test.scales.slice(0, 3)
    test.results = test.results.filter((result) => test.scales.some((scale) => scale.id === result.scaleId))
    test.questions = [{
      id: 'q_three',
      text: 'Проверка трёх шкал',
      type: 'single',
      enabled: true,
      required: true,
      shuffleAnswers: false,
      answers: [
        { id: 'chosen', text: 'Выбранный', scores: { scale_s1: 90, scale_s2: 80, scale_s3: 70 } },
        { id: 'maximum', text: 'Максимум', scores: { scale_s1: 100, scale_s2: 88, scale_s3: 76 } },
      ],
    }]
    const result = calculateTestResult(test, { q_three: 'chosen' })
    expect(result.percentages).toMatchObject({ scale_s1: 90, scale_s2: 91, scale_s3: 92 })
    expect(result.primary.id).toBe('result_s1')
    expect(result.secondary?.id).toBe('result_s2')
    expect(result.combined?.id).toBe('result_s1_s2')
  })
})

describe('цикл файла', () => {
  it('принимает таймеры в секундах без смены версии схемы', () => {
    const source = freshDemoFunnel()
    const timer = source.nodes.find((node) => node.type === 'timer')
    if (!timer) throw new Error('Timer fixture missing')
    const timerData = timer.data as { unit: 'seconds' | 'minutes' | 'hours' | 'days'; duration: number }
    timerData.unit = 'seconds'
    timerData.duration = 2
    ;(timer.data as { background?: boolean }).background = false
    const result = parseAndMigrateFunnelDocument(JSON.parse(JSON.stringify(source)))
    expect(result.success).toBe(true)
    if (result.success) expect(result.document.nodes.find((node) => node.id === timer.id)?.data).toMatchObject({ unit: 'seconds', duration: 2, background: false })
  })

  it('фоновый таймер имеет два независимых выхода', () => {
    const document = freshDemoFunnel()
    const timer = document.nodes.find((node) => node.type === 'timer')
    if (!timer) throw new Error('Timer fixture missing')
    ;(timer.data as { background?: boolean }).background = true
    expect(nodeHandles(timer, document)).toEqual([
      { id: 'immediate', label: 'Сразу' },
      { id: 'delayed', label: 'После таймера' },
    ])
  })

  it('экспорт и повторный импорт не теряют ветки, scoring и статистику', () => {
    const source = freshDemoFunnel()
    const serialized = JSON.parse(JSON.stringify(source))
    const result = parseAndMigrateFunnelDocument(serialized)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.document.edges).toEqual(source.edges)
    expect(result.document.tests).toEqual(source.tests)
    expect(result.document.analytics).toEqual(source.analytics)
    expect(result.document.bot.trackingLinks).toEqual(
      source.bot.trackingLinks.map((link) => ({ ...link, platform: link.platform ?? 'telegram' })),
    )
  })

  it('статистика источника читается по стабильному ID ссылки', () => {
    const document = freshDemoFunnel()
    const link = {
      id: 'tracking_fixture',
      name: 'Fixture',
      code: 'fixture',
      platform: 'telegram' as const,
      source: 'fixture',
      campaign: 'fixture',
      active: true,
      locked: true,
    }
    document.bot.trackingLinks.push(link)
    document.analytics.sources[link.id] = {
      arrived: 1000,
      started: 840,
      completed: 548,
      applications: 261,
      purchases: 184,
      revenue: 10000,
    }

    expect(document.analytics.sources[link.id]).toMatchObject({
      started: 840,
      completed: 548,
      applications: 261,
      purchases: 184,
    })
  })
})
