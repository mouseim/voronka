import type { FunnelTest, ResultContent, ResultRule, ResultSet, ScoringAction, TestQuestion, VariableValue } from './types'

export interface ScaleScore { scaleId: string; raw: number; maximum: number; normalized: number }
export interface ScoringResult {
  scores: Record<string, ScaleScore>
  ranking: ScaleScore[]
  result?: ResultContent
  secondary?: ResultContent
  matchedRule?: ResultRule
  tags: string[]
  variableChanges: Record<string, VariableValue>
}

export function calculateTestResult(test: FunnelTest, resultSet: ResultSet | undefined, answers: Record<string, VariableValue>): ScoringResult {
  const raw: Record<string, number> = Object.fromEntries(test.scales.map((scale) => [scale.id, 0]))
  const tags: string[] = []
  const variableChanges: Record<string, VariableValue> = {}
  for (const question of test.questions.filter((item) => item.enabled)) {
    const answer = answers[question.id]
    selectedAnswers(question, answer).forEach((selected) => applyScoring(selected.scoring, raw, tags, variableChanges))
  }
  const maxima = dynamicMaxima(test)
  const scores: Record<string, ScaleScore> = {}
  test.scales.forEach((scale) => {
    const value = raw[scale.id] ?? 0
    const maximum = scale.normalization === 'fixed_percent' ? (scale.maxValue ?? 0) : maxima[scale.id] ?? 0
    let normalized = value
    if (scale.normalization === 'fixed_percent' || scale.normalization === 'dynamic_percent') normalized = maximum === 0 ? 0 : (value / maximum) * 100
    if (scale.normalization === 'range') {
      const sourceMax = maximum || scale.maxValue || 0
      const targetMin = scale.rangeMin ?? 0
      const targetMax = scale.rangeMax ?? 100
      normalized = sourceMax === 0 ? targetMin : targetMin + (value / sourceMax) * (targetMax - targetMin)
    }
    const precision = Math.max(0, scale.precision)
    normalized = Number(normalized.toFixed(precision))
    scores[scale.id] = { scaleId: scale.id, raw: value, maximum, normalized }
  })
  const scaleOrder = new Map(test.scales.map((scale, index) => [scale.id, index]))
  const ranking = Object.values(scores).sort((a, b) => b.normalized - a.normalized || (scaleOrder.get(a.scaleId) ?? 0) - (scaleOrder.get(b.scaleId) ?? 0) || a.scaleId.localeCompare(b.scaleId))
  const resolved = resolveResult(resultSet, ranking)
  return { scores, ranking, result: resolved.result, secondary: resolved.secondary, matchedRule: resolved.rule, tags, variableChanges }
}

export function dynamicMaxima(test: FunnelTest): Record<string, number> {
  const maxima: Record<string, number> = Object.fromEntries(test.scales.map((scale) => [scale.id, 0]))
  for (const question of test.questions.filter((item) => item.enabled)) {
    const perAnswer = question.answers.filter((answer) => answer.enabled !== false).map((answer) => scoreContribution(answer.scoring))
    for (const scale of test.scales) {
      const values = perAnswer.map((entry) => entry[scale.id] ?? 0)
      const contribution = question.type === 'multiple' ? values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0) : Math.max(0, ...values)
      maxima[scale.id] += contribution
    }
  }
  return maxima
}

export function resolveResult(resultSet: ResultSet | undefined, ranking: ScaleScore[]): { result?: ResultContent; secondary?: ResultContent; rule?: ResultRule } {
  if (!resultSet || !ranking.length) return {}
  const byCode = new Map(resultSet.results.map((result) => [result.code, result]))
  const byScale = (scaleId?: string) => resultSet.results.find((result) => !result.combined && result.scaleIds.includes(scaleId ?? ''))
  const rules = [...resultSet.rules].sort((a, b) => a.priority - b.priority)
  for (const rule of rules) {
    if (rule.type === 'closeness' && ranking.length > 1 && Math.abs(ranking[0].normalized - ranking[1].normalized) <= (rule.closenessPoints ?? 0)) {
      const pair = [ranking[0].scaleId, ranking[1].scaleId].sort()
      const combined = resultSet.results.find((result) => result.combined && [...result.scaleIds].sort().join('|') === pair.join('|'))
      if (combined) return { result: combined, secondary: byScale(ranking[1].scaleId), rule }
      return { result: byScale(ranking[0].scaleId), secondary: byScale(ranking[1].scaleId), rule }
    }
    if (rule.type === 'combination' && rule.scaleIds?.every((scaleId) => ranking.slice(0, rule.scaleIds?.length).some((item) => item.scaleId === scaleId))) {
      const result = rule.resultCode ? byCode.get(rule.resultCode) : resultSet.results.find((item) => item.combined && rule.scaleIds?.every((id) => item.scaleIds.includes(id)))
      if (result) return { result, rule }
    }
    if (rule.type === 'threshold') {
      const score = ranking.find((item) => !rule.scaleIds?.length || rule.scaleIds.includes(item.scaleId))
      if (score && score.normalized >= (rule.threshold ?? 0)) return { result: rule.resultCode ? byCode.get(rule.resultCode) : byScale(score.scaleId), rule }
    }
    if (rule.type === 'range') {
      const score = ranking.find((item) => !rule.scaleIds?.length || rule.scaleIds.includes(item.scaleId))
      if (score && score.normalized >= (rule.min ?? -Infinity) && score.normalized <= (rule.max ?? Infinity)) return { result: rule.resultCode ? byCode.get(rule.resultCode) : byScale(score.scaleId), rule }
    }
    if (rule.type === 'top') {
      const result = rule.resultCode ? byCode.get(rule.resultCode) : byScale(ranking[0].scaleId)
      if (result) return { result, secondary: rule.topN && rule.topN > 1 ? byScale(ranking[1]?.scaleId) : undefined, rule }
    }
    if (rule.type === 'fallback') {
      const result = rule.resultCode ? byCode.get(rule.resultCode) : resultSet.fallbackResultCode ? byCode.get(resultSet.fallbackResultCode) : undefined
      if (result) return { result, rule }
    }
  }
  return { result: resultSet.fallbackResultCode ? byCode.get(resultSet.fallbackResultCode) : byScale(ranking[0].scaleId) }
}

function selectedAnswers(question: TestQuestion, value: VariableValue | undefined) {
  const values = Array.isArray(value) ? value.map(String) : value === undefined || value === null ? [] : [String(value)]
  return question.answers.filter((answer) => values.includes(answer.id) || values.includes(String(answer.value)))
}

function applyScoring(actions: ScoringAction[], raw: Record<string, number>, tags: string[], variableChanges: Record<string, VariableValue>) {
  actions.forEach((action) => {
    if ((action.type === 'add' || action.type === 'subtract' || action.type === 'set') && action.scaleId) {
      const value = Number(action.value ?? 0)
      if (action.type === 'add') raw[action.scaleId] = (raw[action.scaleId] ?? 0) + value
      if (action.type === 'subtract') raw[action.scaleId] = (raw[action.scaleId] ?? 0) - value
      if (action.type === 'set') raw[action.scaleId] = value
    }
    if (action.type === 'tag' && action.tag) tags.push(action.tag)
    if (action.type === 'variable' && action.variableKey) variableChanges[action.variableKey] = action.variableValue ?? null
  })
}

function scoreContribution(actions: ScoringAction[]) {
  const result: Record<string, number> = {}
  actions.forEach((action) => {
    if (!action.scaleId) return
    if (action.type === 'add') result[action.scaleId] = (result[action.scaleId] ?? 0) + Number(action.value ?? 0)
    if (action.type === 'subtract') result[action.scaleId] = (result[action.scaleId] ?? 0) - Number(action.value ?? 0)
    if (action.type === 'set') result[action.scaleId] = Number(action.value ?? 0)
  })
  return result
}
