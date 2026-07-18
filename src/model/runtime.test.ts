import { describe, expect, it } from 'vitest'
import { applyVariableActions, evaluateConditionGroup, evaluateFormula, renderTemplate, seededFraction } from './expressions'
import { demoFunnel } from './demo'
import { calculateTestResult, dynamicMaxima } from './scoring'
import { createSimulatorState, performSimulationAction } from './simulator'

describe('безопасные выражения', () => {
  it('вычисляет вложенные AND/OR/NOT без eval', () => {
    const condition = { id: 'g', kind: 'group' as const, logic: 'and' as const, not: false, children: [
      { id: 'r1', kind: 'rule' as const, left: { kind: 'variable' as const, key: 'age' }, operator: 'gte' as const, right: { kind: 'constant' as const, value: 18, valueType: 'number' as const } },
      { id: 'g2', kind: 'group' as const, logic: 'or' as const, not: true, children: [{ id: 'r2', kind: 'rule' as const, left: { kind: 'variable' as const, key: 'blocked' }, operator: 'is_true' as const }] },
    ] }
    expect(evaluateConditionGroup(condition, { age: 21, blocked: false })).toBe(true)
    expect(evaluateConditionGroup(condition, { age: 15, blocked: false })).toBe(false)
  })

  it('считает формулы, действия и шаблоны', () => {
    const expression = { id: 'x', kind: 'binary' as const, operator: '*' as const, left: { id: 'a', kind: 'variable' as const, key: 'price' }, right: { id: 'b', kind: 'number' as const, value: 1.2 } }
    expect(evaluateFormula(expression, { price: 100 })).toBe(120)
    expect(() => evaluateFormula({ ...expression, operator: '/', right: { id: 'zero', kind: 'number', value: 0 } }, { price: 100 })).toThrow('Деление на ноль')
    const applied = applyVariableActions([{ id: 'a', type: 'increment', variableKey: 'count', value: 2 }], { count: 3 })
    expect(applied.values.count).toBe(5)
    expect(renderTemplate('Привет, {{name | default: "друг"}}!', {})).toBe('Привет, друг!')
  })

  it('даёт устойчивое псевдослучайное значение', () => {
    expect(seededFraction('same')).toBe(seededFraction('same'))
    expect(seededFraction('same')).not.toBe(seededFraction('different'))
  })
})

describe('scoring и симулятор', () => {
  it('вычисляет динамические максимумы и детерминированный результат', () => {
    const test = demoFunnel.tests[0]
    expect(Object.values(dynamicMaxima(test)).every((value) => value === 7)).toBe(true)
    const answers = Object.fromEntries(test.questions.map((question) => [question.id, question.answers[0].id]))
    const result = calculateTestResult(test, demoFunnel.resultSets[0], answers)
    expect(result.result?.code).toBe('S1')
    expect(result.scores.scale_control.normalized).toBe(100)
  })

  it('проходит интерактивные и автоматические шаги демо до результата', () => {
    const scenario = demoFunnel.testScenarios[0]
    let state = createSimulatorState(demoFunnel, scenario)
    state = performSimulationAction(demoFunnel, state) // start
    state = performSimulationAction(demoFunnel, state, { handle: 'btn_begin' })
    state = performSimulationAction(demoFunnel, state, { handle: 'source_social', value: 'source_social' })
    expect(state.currentNodeId).toBe('demo_test')
    state = performSimulationAction(demoFunnel, state, { handle: 'completed', answers: scenario.answers })
    expect(state.currentNodeId).toBe('demo_result')
    expect(state.resultCode).toBe('S1')
    expect(state.values.lead_score).toBe(5)
    expect(state.status).toBe('running')
  })

  it('не выполняет произвольный JavaScript из шаблонов', () => {
    const source = '{{constructor.constructor("return globalThis")()}}'
    expect(renderTemplate(source, {})).toBe(source)
  })
})
