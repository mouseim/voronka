import { describe, expect, it } from 'vitest'
import { createEmptyFunnel, createNode, nodeHandles } from './funnel'
import {
  applyVariableOperations,
  evaluateCondition,
  initialVariableValues,
  renderVariableTemplate,
} from './variables'
import type { ConditionData, FunnelVariable, VariableData } from './types'
import { validateFunnel } from './validation'

const definitions: FunnelVariable[] = [
  { id: 'name', key: 'client_name', name: 'Имя', type: 'text', defaultValue: '' },
  { id: 'score', key: 'score', name: 'Баллы', type: 'number', defaultValue: 1 },
  { id: 'ready', key: 'ready', name: 'Готов', type: 'boolean', defaultValue: false },
]

describe('переменные и условия 3.0', () => {
  it('последовательно присваивает, изменяет, переключает и сбрасывает значения', () => {
    const initial = initialVariableValues(definitions)
    const changed = applyVariableOperations(definitions, initial, [
      { id: '1', variableId: 'name', operation: 'set', value: 'Анна' },
      { id: '2', variableId: 'score', operation: 'add', value: 4 },
      { id: '3', variableId: 'score', operation: 'subtract', value: 2 },
      { id: '4', variableId: 'ready', operation: 'toggle' },
    ])
    expect(changed).toEqual({ name: 'Анна', score: 3, ready: true })
    expect(applyVariableOperations(definitions, changed, [{ id: '5', variableId: 'score', operation: 'reset' }]).score).toBe(1)
  })

  it('сравнивает числа, текст и логические значения', () => {
    const values = { name: 'Анна Смирнова', score: 7, ready: true }
    expect(evaluateCondition(definitions, values, { title: '', variableId: 'score', operator: 'greater_or_equal', value: 7 })).toBe(true)
    expect(evaluateCondition(definitions, values, { title: '', variableId: 'name', operator: 'contains', value: 'смир' })).toBe(true)
    expect(evaluateCondition(definitions, values, { title: '', variableId: 'ready', operator: 'is_true' })).toBe(true)
  })

  it('подставляет значения по стабильному коду', () => {
    expect(renderVariableTemplate('Привет, {{ client_name }}! Баллы: {{score}}. Готов: {{ready}}.', definitions, { name: 'Анна', score: 5, ready: true }))
      .toBe('Привет, Анна! Баллы: 5. Готов: Да.')
  })

  it('условие имеет два стабильных выхода', () => {
    expect(nodeHandles(createNode('condition')).map((handle) => handle.id)).toEqual(['true', 'false'])
  })

  it('проверка находит удалённую переменную в обоих новых блоках', () => {
    const document = createEmptyFunnel()
    const variable = createNode('variable')
    const condition = createNode('condition')
    ;(variable.data as VariableData).operations[0].variableId = 'missing'
    ;(condition.data as ConditionData).variableId = 'missing'
    document.nodes.push(variable, condition)
    const codes = validateFunnel(document).map((issue) => issue.code)
    expect(codes).toContain('operation_variable_missing')
    expect(codes).toContain('condition_variable_missing')
  })
})
