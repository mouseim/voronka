import type {
  ConditionData,
  ConditionOperator,
  FunnelVariable,
  VariableOperation,
  VariableOperationKind,
  VariableType,
  VariableValue,
} from './types'

export type VariableState = Record<string, VariableValue>

export const VARIABLE_TYPE_LABELS: Record<VariableType, string> = {
  text: 'Текст',
  number: 'Число',
  boolean: 'Да / нет',
}

export const VARIABLE_OPERATION_LABELS: Record<VariableOperationKind, string> = {
  set: 'Присвоить значение',
  add: 'Увеличить на',
  subtract: 'Уменьшить на',
  toggle: 'Переключить да / нет',
  reset: 'Вернуть начальное значение',
}

export const CONDITION_OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: 'Равно',
  not_equals: 'Не равно',
  greater: 'Больше',
  greater_or_equal: 'Больше или равно',
  less: 'Меньше',
  less_or_equal: 'Меньше или равно',
  contains: 'Содержит текст',
  not_contains: 'Не содержит текст',
  is_empty: 'Пустое',
  is_not_empty: 'Не пустое',
  is_true: 'Да',
  is_false: 'Нет',
}

export function defaultValueForType(type: VariableType): VariableValue {
  if (type === 'number') return 0
  if (type === 'boolean') return false
  return ''
}

export function operatorsForType(type?: VariableType): ConditionOperator[] {
  if (type === 'number') return ['equals', 'not_equals', 'greater', 'greater_or_equal', 'less', 'less_or_equal']
  if (type === 'boolean') return ['is_true', 'is_false']
  return ['equals', 'not_equals', 'contains', 'not_contains', 'is_empty', 'is_not_empty']
}

export function operationsForType(type?: VariableType): VariableOperationKind[] {
  if (type === 'number') return ['set', 'add', 'subtract', 'reset']
  if (type === 'boolean') return ['set', 'toggle', 'reset']
  return ['set', 'reset']
}

export function operatorNeedsValue(operator: ConditionOperator): boolean {
  return !['is_empty', 'is_not_empty', 'is_true', 'is_false'].includes(operator)
}

export function operationNeedsValue(operation: VariableOperationKind): boolean {
  return !['toggle', 'reset'].includes(operation)
}

export function coerceVariableValue(value: unknown, type: VariableType): VariableValue {
  if (type === 'number') {
    const number = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'))
    return Number.isFinite(number) ? number : 0
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value
    return ['true', '1', 'yes', 'да'].includes(String(value ?? '').trim().toLowerCase())
  }
  return String(value ?? '')
}

export function initialVariableValues(variables: FunnelVariable[]): VariableState {
  return Object.fromEntries(variables.map((variable) => [
    variable.id,
    coerceVariableValue(variable.defaultValue, variable.type),
  ]))
}

export function applyVariableOperations(
  definitions: FunnelVariable[],
  current: VariableState,
  operations: VariableOperation[],
): VariableState {
  const next = { ...current }
  operations.forEach((operation) => {
    const definition = definitions.find((variable) => variable.id === operation.variableId)
    if (!definition) return
    const existing = coerceVariableValue(next[definition.id] ?? definition.defaultValue, definition.type)
    if (operation.operation === 'reset') {
      next[definition.id] = coerceVariableValue(definition.defaultValue, definition.type)
    } else if (operation.operation === 'toggle' && definition.type === 'boolean') {
      next[definition.id] = !Boolean(existing)
    } else if (operation.operation === 'add' && definition.type === 'number') {
      next[definition.id] = Number(existing) + Number(coerceVariableValue(operation.value, 'number'))
    } else if (operation.operation === 'subtract' && definition.type === 'number') {
      next[definition.id] = Number(existing) - Number(coerceVariableValue(operation.value, 'number'))
    } else if (operation.operation === 'set') {
      next[definition.id] = coerceVariableValue(operation.value, definition.type)
    }
  })
  return next
}

export function evaluateCondition(
  definitions: FunnelVariable[],
  current: VariableState,
  condition: ConditionData,
): boolean {
  const definition = definitions.find((variable) => variable.id === condition.variableId)
  if (!definition) return false
  const actual = coerceVariableValue(current[definition.id] ?? definition.defaultValue, definition.type)
  const expected = coerceVariableValue(condition.value, definition.type)
  switch (condition.operator) {
    case 'equals': return actual === expected
    case 'not_equals': return actual !== expected
    case 'greater': return Number(actual) > Number(expected)
    case 'greater_or_equal': return Number(actual) >= Number(expected)
    case 'less': return Number(actual) < Number(expected)
    case 'less_or_equal': return Number(actual) <= Number(expected)
    case 'contains': return String(actual).toLocaleLowerCase('ru').includes(String(expected).toLocaleLowerCase('ru'))
    case 'not_contains': return !String(actual).toLocaleLowerCase('ru').includes(String(expected).toLocaleLowerCase('ru'))
    case 'is_empty': return String(actual).trim() === ''
    case 'is_not_empty': return String(actual).trim() !== ''
    case 'is_true': return actual === true
    case 'is_false': return actual === false
  }
}

export function formatVariableValue(value: VariableValue): string {
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  return String(value)
}

export function renderVariableTemplate(
  text: string,
  definitions: FunnelVariable[],
  current: VariableState,
): string {
  const byKey = new Map(definitions.map((variable) => [variable.key, variable]))
  return text.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (match, key: string) => {
    const variable = byKey.get(key)
    return variable ? formatVariableValue(current[variable.id] ?? variable.defaultValue) : match
  })
}
