import { applyVariableActions, evaluateConditionGroup, evaluateFormula, renderTemplate, seededFraction } from './expressions'
import { SYSTEM_VARIABLES, nodeTitle, outgoingEdge } from './funnel'
import { calculateTestResult } from './scoring'
import type {
  ChoiceData, ConditionData, ConsentData, FormData, FormulaData, FunnelDocument, FunnelNode,
  MessageData, NodeOption, ProductBlockData, QuestionData, RandomData, ResultBlockData,
  SetVariableData, StartData, TestBlockData, TestScenario, VariableValue,
} from './types'
import type { RuntimeValues } from './expressions'

export interface SimulationEvent {
  id: string
  at: string
  nodeId: string
  kind: 'bot' | 'user' | 'system' | 'debug' | 'error'
  text: string
  details?: Record<string, unknown>
}

export interface SimulatorState {
  currentNodeId: string
  values: RuntimeValues
  testAnswers: Record<string, Record<string, VariableValue>>
  scores: Record<string, { raw: number; normalized: number; maximum: number }>
  resultCode?: string
  secondaryResultCode?: string
  history: SimulationEvent[]
  virtualNow: string
  seed: string
  status: 'running' | 'completed' | 'blocked' | 'error'
  error?: string
  stepCount: number
  visited: Record<string, number>
  expected?: Pick<TestScenario, 'expectedEndNodeId' | 'expectedResultCode' | 'expectedVariables'>
}

export interface SimulationAction {
  handle?: string
  label?: string
  value?: VariableValue
  values?: Record<string, VariableValue>
  answers?: Record<string, VariableValue>
  paymentOutcome?: 'success' | 'failure' | 'cancelled' | 'already_purchased' | 'skip'
}

const event = (nodeId: string, kind: SimulationEvent['kind'], text: string, details?: Record<string, unknown>): SimulationEvent => ({
  id: crypto.randomUUID(), at: new Date().toISOString(), nodeId, kind, text, details,
})

export function createSimulatorState(document: FunnelDocument, scenario?: TestScenario): SimulatorState {
  const start = document.nodes.find((node) => node.id === document.funnel.startNodeId)
  const defaults: RuntimeValues = Object.fromEntries(document.variables.map((variable) => [variable.key, structuredClone(variable.defaultValue)]))
  SYSTEM_VARIABLES.forEach((variable) => { defaults[variable.key] = structuredClone(variable.example) as VariableValue })
  const now = new Date().toISOString()
  const values: RuntimeValues = {
    ...defaults,
    ...(start?.type === 'start' ? structuredClone((start.data as StartData).initialValues) : {}),
    ...(scenario?.systemValues ?? {}),
    'funnel.id': document.funnel.id,
    'funnel.key': document.funnel.key,
    'funnel.version': document.funnel.version,
    'session.id': `simulation_${crypto.randomUUID()}`,
    'session.startedAt': now,
    'session.lastActivityAt': now,
    now,
  }
  return resolveAutomatic(document, {
    currentNodeId: document.funnel.startNodeId,
    values,
    testAnswers: {},
    scores: {},
    history: [event(document.funnel.startNodeId, 'system', `Симуляция «${document.funnel.name}» запущена`)],
    virtualNow: now,
    seed: scenario?.seed ?? 'manual-preview',
    status: 'running',
    stepCount: 0,
    visited: {},
    expected: scenario ? { expectedEndNodeId: scenario.expectedEndNodeId, expectedResultCode: scenario.expectedResultCode, expectedVariables: scenario.expectedVariables } : undefined,
  })
}

export function performSimulationAction(document: FunnelDocument, current: SimulatorState, action: SimulationAction = {}): SimulatorState {
  if (current.status !== 'running') return current
  const node = document.nodes.find((candidate) => candidate.id === current.currentNodeId)
  if (!node) return fail(current, current.currentNodeId, `Блок ${current.currentNodeId} не найден`)
  let state = structuredClone(current)
  let handle = action.handle ?? 'next'
  const label = action.label ?? handle

  if (node.type === 'message') {
    const data = node.data as MessageData
    const button = data.buttons.find((item) => item.id === handle)
    if (button) {
      state.history.push(event(node.id, 'user', button.text || label))
      if (button.action === 'set_variable' && button.variableKey) state.values[button.variableKey] = button.variableValue
      if (button.action === 'url') state.history.push(event(node.id, 'system', `Ссылка открыта: ${button.url ?? ''}`))
      if (!['transition', 'set_variable'].includes(button.action)) handle = 'next'
    } else if (data.continueWithoutButton) state.history.push(event(node.id, 'user', label === 'next' ? 'Продолжить' : label))
  }

  if (node.type === 'choice') {
    const data = node.data as ChoiceData
    const selected = Array.isArray(action.value) ? action.value.map(String) : [String(action.value ?? handle)]
    const options = data.options.filter((option) => selected.includes(option.id) || selected.includes(String(option.value)))
    state.history.push(event(node.id, 'user', options.map((option) => option.text).join(', ') || label))
    if (data.variableKey) state.values[data.variableKey] = data.selectionMode === 'multiple' ? selected : selected[0]
    options.forEach((option) => applyOptionScoring(option, state))
    if (data.sharedTransition) handle = 'confirmed'
  }

  if (node.type === 'question') {
    const data = node.data as QuestionData
    const value = action.value ?? ''
    const selected = data.answers.filter((answer) => {
      const values = Array.isArray(value) ? value.map(String) : [String(value)]
      return values.includes(answer.id) || values.includes(String(answer.value))
    })
    const printable = selected.length ? selected.map((answer) => answer.text).join(', ') : String(value)
    state.history.push(event(node.id, 'user', printable || 'Ответ отправлен'))
    if (data.variableKey) state.values[data.variableKey] = value
    selected.forEach((answer) => applyOptionScoring(answer, state))
    if (!['single_choice', 'multiple_choice', 'yes_no'].includes(data.inputType)) handle = 'success'
  }

  if (node.type === 'test') {
    const data = node.data as TestBlockData
    const test = document.tests.find((candidate) => candidate.id === data.testId)
    if (!test) return fail(state, node.id, 'Выбранный тест не найден')
    const answers = action.answers ?? {}
    const missing = test.questions.filter((question) => question.enabled && question.required && answers[question.id] === undefined)
    if (missing.length) return fail(state, node.id, `Не отвечено обязательных вопросов: ${missing.length}`, false)
    const scoring = calculateTestResult(test, document.resultSets.find((set) => set.id === test.resultSetId), answers)
    state.testAnswers[test.id] = structuredClone(answers)
    state.scores = Object.fromEntries(Object.entries(scoring.scores).map(([id, score]) => [id, { raw: score.raw, normalized: score.normalized, maximum: score.maximum }]))
    state.resultCode = scoring.result?.code
    state.secondaryResultCode = scoring.secondary?.code
    state.values['result.main'] = scoring.result ? structuredClone(scoring.result) : {}
    state.values['result.secondary'] = scoring.secondary ? structuredClone(scoring.secondary) : {}
    state.values['result.isCombined'] = Boolean(scoring.secondary || scoring.result?.combined)
    if (data.resultVariableKey) state.values[data.resultVariableKey] = {
      main: scoring.result ? structuredClone(scoring.result) : null,
      secondary: scoring.secondary ? structuredClone(scoring.secondary) : null,
      scores: structuredClone(scoring.scores),
    }
    Object.assign(state.values, scoring.variableChanges)
    state.history.push(event(node.id, 'user', `Тест завершён: ${Object.keys(answers).length} ответов`))
    state.history.push(event(node.id, 'debug', `Результат: ${scoring.result?.title ?? 'не определён'}`, { scores: state.scores, rule: scoring.matchedRule?.id }))
    handle = action.handle ?? 'completed'
  }

  if (node.type === 'consent') {
    const data = node.data as ConsentData
    const accepted = handle === 'accepted'
    if (data.variableKey) state.values[data.variableKey] = accepted
    state.history.push(event(node.id, 'user', accepted ? data.acceptText : data.declineText))
  }

  if (node.type === 'form') {
    const data = node.data as FormData
    const formValues = action.values ?? {}
    const missing = data.fields.filter((field) => field.required && !formValues[field.id] && !(field.variableKey && formValues[field.variableKey]))
    if (missing.length) return fail(state, node.id, `Заполните обязательные поля: ${missing.map((field) => field.label).join(', ')}`, false)
    data.fields.forEach((field) => {
      const value = formValues[field.id] ?? (field.variableKey ? formValues[field.variableKey] : undefined)
      if (field.variableKey && value !== undefined) state.values[field.variableKey] = value
    })
    state.history.push(event(node.id, 'user', data.submitText))
    state.history.push(event(node.id, 'system', `Создана локальная запись: ${data.recordType}`))
    handle = action.handle ?? 'success'
  }

  if (node.type === 'product') {
    const data = node.data as ProductBlockData
    handle = action.paymentOutcome ?? action.handle ?? 'skip'
    state.values['payment.status'] = handle === 'success' || handle === 'already_purchased' ? 'paid' : handle
    state.values['payment.productKey'] = document.products.find((product) => product.id === data.productId)?.productKey ?? ''
    state.history.push(event(node.id, 'user', paymentLabel(handle)))
  }

  if (['timer', 'wait_until', 'reminder'].includes(node.type)) {
    state.virtualNow = advanceVirtualTime(state.virtualNow, node)
    state.values.now = state.virtualNow
    state.history.push(event(node.id, 'system', `Виртуальное время: ${new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(state.virtualNow))}`))
  }

  if (node.type === 'external_link') state.history.push(event(node.id, 'user', String(node.data.buttonText ?? 'Открыть ссылку')))
  if (node.type === 'sub_funnel') return { ...state, status: 'completed', history: [...state.history, event(node.id, 'system', `Переход в воронку ${String(node.data.targetFunnelKey)}`)] }
  if (node.type === 'end') return finishState(state, node)

  const edge = outgoingEdge(document, node.id, handle) ?? (handle !== 'next' ? outgoingEdge(document, node.id, 'next') : undefined)
  if (!edge) return fail(state, node.id, `Не настроен переход «${handle}» из блока «${nodeTitle(node)}»`, false)
  state = moveTo(state, edge.target, node.id, handle)
  return resolveAutomatic(document, state)
}

export function currentSimulatorNode(document: FunnelDocument, state: SimulatorState) {
  return document.nodes.find((node) => node.id === state.currentNodeId)
}

export function simulatorText(text: string, state: SimulatorState) {
  return renderTemplate(text, state.values)
}

export function scenarioAssertions(state: SimulatorState): Array<{ label: string; passed: boolean; actual: unknown; expected: unknown }> {
  if (!state.expected) return []
  const assertions: Array<{ label: string; passed: boolean; actual: unknown; expected: unknown }> = []
  if (state.expected.expectedEndNodeId) assertions.push({ label: 'Финальный блок', passed: state.currentNodeId === state.expected.expectedEndNodeId, actual: state.currentNodeId, expected: state.expected.expectedEndNodeId })
  if (state.expected.expectedResultCode) assertions.push({ label: 'Результат', passed: state.resultCode === state.expected.expectedResultCode, actual: state.resultCode, expected: state.expected.expectedResultCode })
  Object.entries(state.expected.expectedVariables ?? {}).forEach(([key, expected]) => assertions.push({ label: `Переменная ${key}`, passed: JSON.stringify(state.values[key]) === JSON.stringify(expected), actual: state.values[key], expected }))
  return assertions
}

function resolveAutomatic(document: FunnelDocument, initial: SimulatorState): SimulatorState {
  let state = structuredClone(initial)
  const automatic = new Set(['set_variable', 'formula', 'condition', 'random'])
  while (state.status === 'running' && state.stepCount < 500) {
    const node = document.nodes.find((candidate) => candidate.id === state.currentNodeId)
    if (!node) return fail(state, state.currentNodeId, `Блок ${state.currentNodeId} не найден`)
    state.visited[node.id] = (state.visited[node.id] ?? 0) + 1
    if (state.visited[node.id] > 50) return fail(state, node.id, 'Остановлен вероятный бесконечный цикл')
    state.stepCount += 1
    state.history.push(event(node.id, 'debug', `Вход: ${nodeTitle(node)}`, { type: node.type }))
    if (node.data.enabled === false && node.type !== 'start') {
      const edge = outgoingEdge(document, node.id, 'next') ?? outgoingEdge(document, node.id)
      if (!edge) return fail(state, node.id, 'Выключенный блок нельзя обойти: переход отсутствует')
      state = moveTo(state, edge.target, node.id, edge.sourceHandle ?? 'next')
      continue
    }
    if (!automatic.has(node.type)) {
      if (node.type === 'end') return finishState(state, node)
      return state
    }
    let handle = 'next'
    try {
      if (node.type === 'set_variable') {
        const applied = applyVariableActions((node.data as SetVariableData).actions, state.values, new Date(state.virtualNow))
        state.values = applied.values
        state.history.push(event(node.id, 'debug', 'Переменные обновлены', applied.changes))
      }
      if (node.type === 'formula') {
        const data = node.data as FormulaData
        const value = evaluateFormula(data.expression, state.values)
        if (data.targetVariableKey) state.values[data.targetVariableKey] = value
        state.history.push(event(node.id, 'debug', `Формула: ${value}`, data.targetVariableKey ? { [data.targetVariableKey]: value } : undefined))
      }
      if (node.type === 'condition') {
        const data = node.data as ConditionData
        const branch = data.branches.find((candidate) => !candidate.isElse && candidate.condition && evaluateConditionGroup(candidate.condition, state.values)) ?? data.branches.find((candidate) => candidate.isElse)
        if (!branch) return fail(state, node.id, 'Ни одно условие не сработало и нет ветки «Иначе»')
        handle = branch.id
        state.history.push(event(node.id, 'debug', `Условие → ${branch.name}`))
      }
      if (node.type === 'random') {
        const data = node.data as RandomData
        const total = data.branches.reduce((sum, branch) => sum + Math.max(0, branch.weight), 0)
        let cursor = seededFraction(`${state.seed}:${node.id}:${data.stableByUser ? state.values['user.id'] : state.stepCount}`) * total
        const branch = data.branches.find((candidate) => { cursor -= Math.max(0, candidate.weight); return cursor <= 0 }) ?? data.branches.at(-1)
        if (!branch) return fail(state, node.id, 'У случайного блока нет вариантов')
        handle = branch.id
        if (data.variableKey) state.values[data.variableKey] = branch.id
        state.history.push(event(node.id, 'debug', `Распределение → ${branch.name}`))
      }
    } catch (error) {
      return fail(state, node.id, error instanceof Error ? error.message : 'Ошибка вычисления')
    }
    const edge = outgoingEdge(document, node.id, handle)
    if (!edge) return fail(state, node.id, `Не настроен переход «${handle}»`)
    state = moveTo(state, edge.target, node.id, handle)
  }
  if (state.stepCount >= 500) return fail(state, state.currentNodeId, 'Симуляция остановлена после 500 автоматических шагов')
  return state
}

function moveTo(state: SimulatorState, target: string, source: string, handle: string) {
  return { ...state, currentNodeId: target, error: undefined, values: { ...state.values, 'session.lastActivityAt': state.virtualNow }, history: [...state.history, event(source, 'debug', `Переход ${handle} → ${target}`)] }
}

function fail(state: SimulatorState, nodeId: string, message: string, fatal = true): SimulatorState {
  return { ...state, status: fatal ? 'error' : 'running', error: message, history: [...state.history, event(nodeId, 'error', message)] }
}

function finishState(state: SimulatorState, node: FunnelNode): SimulatorState {
  return { ...state, currentNodeId: node.id, status: 'completed', history: [...state.history, event(node.id, 'system', String(node.data.text ?? 'Воронка завершена'))] }
}

function applyOptionScoring(option: NodeOption, state: SimulatorState) {
  Object.entries(option.scores ?? {}).forEach(([scaleId, value]) => {
    const previous = state.scores[scaleId] ?? { raw: 0, normalized: 0, maximum: 0 }
    state.scores[scaleId] = { ...previous, raw: previous.raw + value }
  })
  option.scoring?.forEach((action) => {
    if (action.scaleId && ['add', 'subtract', 'set'].includes(action.type)) {
      const previous = state.scores[action.scaleId] ?? { raw: 0, normalized: 0, maximum: 0 }
      const operand = Number(action.value ?? 0)
      const raw = action.type === 'set' ? operand : previous.raw + (action.type === 'subtract' ? -operand : operand)
      state.scores[action.scaleId] = { ...previous, raw }
    }
    if (action.type === 'variable' && action.variableKey) state.values[action.variableKey] = action.variableValue
  })
}

function advanceVirtualTime(value: string, node: FunnelNode) {
  const date = new Date(value)
  if (node.type === 'wait_until') {
    const data = node.data as import('./types').WaitUntilData
    if (data.mode === 'fixed' && data.dateTime) return new Date(data.dateTime).toISOString()
    const target = new Date(date)
    const weekday = data.weekday ?? target.getDay()
    const days = (weekday - target.getDay() + 7) % 7 || 7
    target.setDate(target.getDate() + days)
    const [hours, minutes] = data.time.split(':').map(Number)
    target.setHours(hours || 0, minutes || 0, 0, 0)
    return target.toISOString()
  }
  const duration = Number(node.data.duration ?? 0)
  const unit = String(node.data.unit ?? 'seconds')
  const milliseconds = duration * (unit === 'days' ? 86_400_000 : unit === 'hours' ? 3_600_000 : unit === 'minutes' ? 60_000 : 1_000)
  return new Date(date.getTime() + milliseconds).toISOString()
}

function paymentLabel(handle: string) {
  return ({ success: 'Смоделировать успешную оплату', failure: 'Смоделировать ошибку', cancelled: 'Отменить оплату', already_purchased: 'Уже приобретено', skip: 'Продолжить без покупки' } as Record<string, string>)[handle] ?? handle
}
