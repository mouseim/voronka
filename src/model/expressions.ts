import type {
  ConditionGroup, ConditionOperand, ConditionOperator, ConditionRule, FormulaExpression,
  FunnelVariable, VariableAction, VariableType, VariableValue,
} from './types'

export interface RuntimeValues { [key: string]: VariableValue | undefined }

export function getRuntimeValue(values: RuntimeValues, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(values, key)) return values[key]
  const parts = key.split('.')
  let current: unknown = values[parts[0]]
  for (const part of parts.slice(1)) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function operandValue(operand: ConditionOperand | undefined, values: RuntimeValues): unknown {
  if (!operand) return undefined
  return operand.kind === 'variable' ? getRuntimeValue(values, operand.key) : operand.value
}

export function evaluateConditionRule(rule: ConditionRule, values: RuntimeValues): boolean {
  const left = operandValue(rule.left, values)
  const right = operandValue(rule.right, values)
  const rightTo = operandValue(rule.rightTo, values)
  return evaluateOperator(rule.operator, left, right, rightTo)
}

export function evaluateOperator(operator: ConditionOperator, left: unknown, right?: unknown, rightTo?: unknown): boolean {
  switch (operator) {
    case 'eq': return Object.is(left, right) || String(left) === String(right)
    case 'neq': return !evaluateOperator('eq', left, right)
    case 'gt': return asNumber(left) > asNumber(right)
    case 'gte': return asNumber(left) >= asNumber(right)
    case 'lt': return asNumber(left) < asNumber(right)
    case 'lte': return asNumber(left) <= asNumber(right)
    case 'contains': return Array.isArray(left) ? left.some((item) => Object.is(item, right)) : String(left ?? '').includes(String(right ?? ''))
    case 'not_contains': return !evaluateOperator('contains', left, right)
    case 'starts_with': return String(left ?? '').startsWith(String(right ?? ''))
    case 'ends_with': return String(left ?? '').endsWith(String(right ?? ''))
    case 'in': return Array.isArray(right) && right.some((item) => Object.is(item, left) || String(item) === String(left))
    case 'not_in': return !evaluateOperator('in', left, right)
    case 'filled': return left !== undefined && left !== null && left !== '' && (!Array.isArray(left) || left.length > 0)
    case 'empty': return !evaluateOperator('filled', left)
    case 'is_true': return left === true
    case 'is_false': return left === false
    case 'date_before': return asTime(left) < asTime(right)
    case 'date_after': return asTime(left) > asTime(right)
    case 'date_between': return asTime(left) >= asTime(right) && asTime(left) <= asTime(rightTo)
    case 'number_between': return asNumber(left) >= asNumber(right) && asNumber(left) <= asNumber(rightTo)
    case 'result_is': return String((left as { code?: unknown } | null)?.code ?? left) === String(right)
    case 'product_paid': return left === 'paid' || left === true
    case 'product_not_paid': return left !== 'paid' && left !== true
    case 'source_is': return String(left ?? '') === String(right ?? '')
  }
}

export function evaluateConditionGroup(group: ConditionGroup, values: RuntimeValues): boolean {
  const results = group.children.map((child) => child.kind === 'group' ? evaluateConditionGroup(child, values) : evaluateConditionRule(child, values))
  const matched = group.logic === 'and' ? results.every(Boolean) : results.some(Boolean)
  return group.not ? !matched : matched
}

export function evaluateFormula(expression: FormulaExpression, values: RuntimeValues): number {
  if (expression.kind === 'number') return expression.value
  if (expression.kind === 'variable') return asNumber(getRuntimeValue(values, expression.key))
  if (expression.kind === 'binary') {
    const left = evaluateFormula(expression.left, values)
    const right = evaluateFormula(expression.right, values)
    if (expression.operator === '+') return left + right
    if (expression.operator === '-') return left - right
    if (expression.operator === '*') return left * right
    if (right === 0) throw new Error('Деление на ноль')
    return left / right
  }
  const args = expression.args.map((arg) => evaluateFormula(arg, values))
  if (!args.length) return 0
  if (expression.name === 'min') return Math.min(...args)
  if (expression.name === 'max') return Math.max(...args)
  if (expression.name === 'round') return Math.round(args[0])
  if (expression.name === 'floor') return Math.floor(args[0])
  return Math.ceil(args[0])
}

export function applyVariableActions(actions: VariableAction[], values: RuntimeValues, now = new Date()): { values: RuntimeValues; changes: Record<string, unknown> } {
  const next = structuredClone(values)
  const changes: Record<string, unknown> = {}
  for (const action of actions) {
    const current = getRuntimeValue(next, action.variableKey)
    let value: unknown = current
    if (action.type === 'assign') value = action.value
    if (action.type === 'copy') value = action.sourceVariableKey ? getRuntimeValue(next, action.sourceVariableKey) : undefined
    if (action.type === 'clear') value = undefined
    if (action.type === 'increment') value = asNumber(current) + asNumber(action.value ?? 1)
    if (action.type === 'decrement') value = asNumber(current) - asNumber(action.value ?? 1)
    if (action.type === 'list_add') value = [...(Array.isArray(current) ? current : []), action.value]
    if (action.type === 'list_remove') value = (Array.isArray(current) ? current : []).filter((item) => !Object.is(item, action.value))
    if (action.type === 'now') value = now.toISOString()
    if (action.type === 'test_result') value = getRuntimeValue(next, 'result.main')
    if (action.type === 'template') value = renderTemplate(action.template ?? '', next)
    if (value === undefined) delete next[action.variableKey]
    else next[action.variableKey] = value as VariableValue
    changes[action.variableKey] = value
  }
  return { values: next, changes }
}

export function renderTemplate(template: string, values: RuntimeValues): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)(?:\s*\|\s*default:\s*"([^"]*)")?\s*\}\}/g, (_match, key: string, fallback?: string) => {
    const value = getRuntimeValue(values, key)
    if (value === undefined || value === null || value === '') return fallback ?? `{{${key}}}`
    if (typeof value === 'object') {
      try { return JSON.stringify(value) } catch { return '' }
    }
    return String(value)
  })
}

export function templateVariableKeys(template: string): string[] {
  return Array.from(template.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)/g), (match) => match[1])
}

export function variableTypeMap(variables: FunnelVariable[], system: Array<{ key: string; type: VariableType }>): Map<string, VariableType> {
  return new Map([...system.map((item) => [item.key, item.type] as const), ...variables.map((item) => [item.key, item.type] as const)])
}

export function validateConditionTypes(group: ConditionGroup, types: Map<string, VariableType>): string[] {
  const errors: string[] = []
  const visit = (child: ConditionGroup | ConditionRule) => {
    if (child.kind === 'group') { child.children.forEach(visit); return }
    const leftType = child.left.kind === 'variable' ? types.get(child.left.key) : child.left.valueType
    const rightType = child.right?.kind === 'variable' ? types.get(child.right.key) : child.right?.valueType
    if (child.left.kind === 'variable' && !leftType) errors.push(`Неизвестная переменная ${child.left.key}`)
    if (child.right?.kind === 'variable' && !rightType) errors.push(`Неизвестная переменная ${child.right.key}`)
    const numeric = ['gt','gte','lt','lte','number_between'].includes(child.operator)
    const date = ['date_before','date_after','date_between'].includes(child.operator)
    if (numeric && leftType !== 'number') errors.push(`Оператор ${child.operator} требует число слева`)
    if (date && leftType !== 'dateTime') errors.push(`Оператор ${child.operator} требует дату слева`)
    if (rightType && ['eq','neq'].includes(child.operator) && leftType && leftType !== rightType) errors.push(`Несовместимые типы ${leftType} и ${rightType}`)
  }
  visit(group)
  return errors
}

export function seededFraction(seed: string): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967296
}

function asNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : 0
}

function asTime(value: unknown): number {
  const time = new Date(String(value ?? '')).getTime()
  return Number.isFinite(time) ? time : 0
}
