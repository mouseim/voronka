import type { CalculatedTestResult, FunnelTest, TestQuestion, TestResult } from './types'

type AnswerValue = string | string[] | number

export function calculateTestResult(test: FunnelTest, answers: Record<string, AnswerValue>): CalculatedTestResult {
  if (!test.scales.length || !test.results.length) throw new Error('Добавьте шкалы и основные результаты теста.')

  const scores = Object.fromEntries(test.scales.map((scale) => [scale.id, 0]))
  const maximums = Object.fromEntries(test.scales.map((scale) => [scale.id, 0]))

  test.questions.filter((question) => question.enabled).forEach((question) => {
    addMaximums(question, test.scales.map((scale) => scale.id), maximums)
    const selected = selectedAnswerIds(answers[question.id])
    question.answers.filter((answer) => selected.includes(answer.id)).forEach((answer) => {
      Object.entries(answer.scores).forEach(([scaleId, value]) => {
        if (scaleId in scores) scores[scaleId] += Number(value) || 0
      })
    })
  })

  const percentages = Object.fromEntries(test.scales.map((scale) => {
    const maximum = maximums[scale.id]
    return [scale.id, maximum > 0 ? Math.max(0, Math.min(100, scores[scale.id] / maximum * 100)) : 0]
  }))

  const ordered = [...test.scales].sort((left, right) => {
    const difference = percentages[right.id] - percentages[left.id]
    return difference || test.scales.indexOf(left) - test.scales.indexOf(right)
  })
  const primaryScale = ordered[0]
  const secondaryScale = ordered[1]
  const primary = resultForScale(test, primaryScale.id)
  const secondary = secondaryScale ? test.results.find((result) => result.scaleId === secondaryScale.id) : undefined
  const close = Boolean(secondary && Math.abs(percentages[primaryScale.id] - percentages[secondaryScale.id]) <= test.calculation.proximityThreshold)
  const combined = close && test.calculation.useCombinedResults
    ? test.combinedResults.find((result) => samePair(result.scaleIds, [primaryScale.id, secondaryScale.id]))
    : undefined
  const chosenResultId = combined?.id ?? primary.id
  const primaryPercent = percentages[primaryScale.id].toFixed(1)
  const secondaryPercent = secondaryScale ? percentages[secondaryScale.id].toFixed(1) : null
  const explanation = combined
    ? `Два ведущих результата близки: ${primary.name} — ${primaryPercent}%, ${secondary!.name} — ${secondaryPercent}%. Разница не превышает ${test.calculation.proximityThreshold} п.п., поэтому выбран комбинированный результат.`
    : `Наибольший процент у результата «${primary.name}» — ${primaryPercent}%.${close ? ' Подходящего комбинированного текста нет, поэтому показан главный результат.' : ''}`

  return { scores, maximums, percentages, primary, secondary, combined, chosenResultId, explanation }
}

function addMaximums(question: TestQuestion, scaleIds: string[], maximums: Record<string, number>) {
  scaleIds.forEach((scaleId) => {
    const values = question.answers.map((answer) => Math.max(0, Number(answer.scores[scaleId]) || 0))
    maximums[scaleId] += question.type === 'multiple'
      ? values.reduce((sum, value) => sum + value, 0)
      : Math.max(0, ...values)
  })
}

function selectedAnswerIds(value: AnswerValue | undefined): string[] {
  if (Array.isArray(value)) return value
  return typeof value === 'string' ? [value] : []
}

function resultForScale(test: FunnelTest, scaleId: string): TestResult {
  const result = test.results.find((item) => item.scaleId === scaleId)
  if (!result) throw new Error('Для одной из шкал не создан основной результат.')
  return result
}

function samePair(left: [string, string], right: [string, string]) {
  return [...left].sort().join('|') === [...right].sort().join('|')
}
