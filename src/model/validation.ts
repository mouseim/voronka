import { SYSTEM_VARIABLES, mediaNodeAsset, nodeHandles, referencedAssetIds, referencedVariableKeys, SCHEMA_VERSION } from './funnel'
import { templateVariableKeys, validateConditionTypes, variableTypeMap } from './expressions'
import { dynamicMaxima } from './scoring'
import type {
  ChoiceData, ConditionData, ConditionGroup, ConsentData, ExternalLinkData, FormData,
  FormulaData, FunnelDocument, FunnelNode, MediaData, MessageData, ProductBlockData,
  QuestionData, RandomData, ReminderData, SetVariableData, SubFunnelData, TestBlockData,
  TimerData, ValidationIssue, VariableType, WaitUntilData,
} from './types'

export function validateFunnel(document: FunnelDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (severity: ValidationIssue['severity'], section: ValidationIssue['section'], code: string, message: string, options: Partial<Omit<ValidationIssue, 'severity' | 'section' | 'code' | 'message'>> = {}) => issues.push({ severity, section, code, message, ...options })
  const error = (section: ValidationIssue['section'], code: string, message: string, options: Parameters<typeof add>[4] = {}) => add('error', section, code, message, options)
  const warning = (section: ValidationIssue['section'], code: string, message: string, options: Parameters<typeof add>[4] = {}) => add('warning', section, code, message, options)
  const advice = (section: ValidationIssue['section'], code: string, message: string, options: Parameters<typeof add>[4] = {}) => add('advice', section, code, message, options)

  if (document.schemaVersion !== SCHEMA_VERSION) error('structure', 'unsupported_schema', `Поддерживается схема ${SCHEMA_VERSION}`, { path: 'schemaVersion' })
  const globalIds = new Map<string, string>()
  const registerId = (id: string, path: string, entityId?: string) => {
    if (!id.trim()) error('structure', 'empty_id', 'Стабильный ID не заполнен', { path, entityId })
    else if (globalIds.has(id)) error('structure', 'duplicate_id', `ID «${id}» повторяется (${globalIds.get(id)} и ${path})`, { path, entityId })
    else globalIds.set(id, path)
  }
  document.nodes.forEach((node, index) => registerId(node.id, `nodes[${index}].id`, node.id))
  document.edges.forEach((edge, index) => registerId(edge.id, `edges[${index}].id`, edge.id))
  document.variables.forEach((item, index) => registerId(item.id, `variables[${index}].id`, item.id))
  document.assets.forEach((item, index) => registerId(item.id, `assets[${index}].id`, item.id))
  document.products.forEach((item, index) => registerId(item.id, `products[${index}].id`, item.id))
  document.tests.forEach((test, testIndex) => {
    registerId(test.id, `tests[${testIndex}].id`, test.id)
    test.scales.forEach((scale, index) => registerId(scale.id, `tests[${testIndex}].scales[${index}].id`, scale.id))
    test.questions.forEach((question, questionIndex) => {
      registerId(question.id, `tests[${testIndex}].questions[${questionIndex}].id`, question.id)
      question.answers.forEach((answer, answerIndex) => registerId(answer.id, `tests[${testIndex}].questions[${questionIndex}].answers[${answerIndex}].id`, answer.id))
    })
  })
  document.resultSets.forEach((set, setIndex) => {
    registerId(set.id, `resultSets[${setIndex}].id`, set.id)
    set.results.forEach((result, index) => registerId(result.id, `resultSets[${setIndex}].results[${index}].id`, result.id))
    set.rules.forEach((rule, index) => registerId(rule.id, `resultSets[${setIndex}].rules[${index}].id`, rule.id))
  })
  document.testScenarios.forEach((item, index) => registerId(item.id, `testScenarios[${index}].id`, item.id))

  validateUniqueKeys(document, error)
  validateGraph(document, error, warning, advice)
  validateVariables(document, error, warning, advice)
  validateContent(document, error, warning, advice)
  validateTests(document, error, warning, advice)
  validateMedia(document, error, warning, advice)
  validateProducts(document, error, warning)
  validateSchedule(document, error, warning)
  validateAnalytics(document, error, warning)
  return issues
}

type Reporter = (section: ValidationIssue['section'], code: string, message: string, options?: Partial<ValidationIssue>) => void

function validateUniqueKeys(document: FunnelDocument, error: Reporter) {
  const groups: Array<[string, Array<{ key: string; id: string }>, ValidationIssue['section']]> = [
    ['переменной', document.variables.map((item) => ({ key: item.key, id: item.id })), 'variables'],
    ['теста', document.tests.map((item) => ({ key: item.key, id: item.id })), 'tests'],
    ['набора результатов', document.resultSets.map((item) => ({ key: item.key, id: item.id })), 'tests'],
    ['медиа', document.assets.map((item) => ({ key: item.assetKey, id: item.id })), 'media'],
    ['продукта', document.products.map((item) => ({ key: item.productKey, id: item.id })), 'products'],
  ]
  groups.forEach(([label, items, section]) => {
    const used = new Map<string, string>()
    items.forEach((item) => {
      if (!/^[a-z][a-z0-9_.-]*$/i.test(item.key)) error(section, 'invalid_key', `Технический ключ ${label} «${item.key}» имеет неверный формат`, { entityId: item.id })
      if (used.has(item.key)) error(section, 'duplicate_key', `Технический ключ ${label} «${item.key}» повторяется`, { entityId: item.id })
      used.set(item.key, item.id)
    })
  })
  if (!/^[a-z][a-z0-9_-]*$/i.test(document.funnel.key)) error('structure', 'invalid_funnel_key', 'Ключ воронки должен начинаться с буквы и не содержать пробелы', { path: 'funnel.key' })
}

function validateGraph(document: FunnelDocument, error: Reporter, warning: Reporter, advice: Reporter) {
  const executable = document.nodes.filter((node) => !['comment','group'].includes(node.type))
  const nodeIds = new Set(executable.map((node) => node.id))
  const starts = executable.filter((node) => node.type === 'start')
  if (starts.length === 0) error('graph', 'missing_start', 'В воронке нет стартового блока', { path: 'nodes' })
  if (starts.length > 1) error('graph', 'multiple_starts', 'Основной старт должен быть один', { path: 'nodes' })
  const start = executable.find((node) => node.id === document.funnel.startNodeId)
  if (!start || start.type !== 'start') error('graph', 'invalid_start_id', 'funnel.startNodeId не указывает на старт', { path: 'funnel.startNodeId' })

  const validEdges = document.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
  document.edges.forEach((edge, index) => {
    if (!nodeIds.has(edge.source)) error('graph', 'missing_edge_source', `Начальный блок связи «${edge.id}» не существует или не исполняется`, { edgeId: edge.id, path: `edges[${index}].source`, fix: 'remove_orphan_edge' })
    if (!nodeIds.has(edge.target)) error('graph', 'missing_edge_target', `Конечный блок связи «${edge.id}» не существует или не исполняется`, { edgeId: edge.id, path: `edges[${index}].target`, fix: 'remove_orphan_edge' })
  })
  const outgoing = (id: string, handle?: string) => validEdges.filter((edge) => edge.source === id && (handle === undefined || (edge.sourceHandle ?? 'next') === handle))
  const incoming = (id: string) => validEdges.filter((edge) => edge.target === id)
  if (start && !outgoing(start.id).length) error('graph', 'start_without_edge', 'Из стартового блока не ведёт переход', { nodeId: start.id })

  executable.forEach((node) => {
    if (node.type !== 'start' && !incoming(node.id).length) warning('graph', 'no_incoming_edge', 'У блока нет входящих связей', { nodeId: node.id })
    if (node.type === 'end' && outgoing(node.id).length) error('graph', 'end_has_outgoing', 'Из завершения не должно быть исполняемых связей', { nodeId: node.id })
    const required = requiredHandles(node)
    required.forEach((handle) => {
      const count = outgoing(node.id, handle.id).length
      if (count === 0) error('graph', 'missing_branch', `Не настроена ветка «${handle.label}»`, { nodeId: node.id })
      if (count > 1) error('graph', 'conflicting_branch', `Ветка «${handle.label}» ведёт сразу в несколько блоков`, { nodeId: node.id })
    })
    if (node.data.enabled === false && (node.type === 'start' || incoming(node.id).length)) warning('graph', 'disabled_on_path', 'Выключенный блок находится в активном пути', { nodeId: node.id })
  })

  if (start) {
    const reached = new Set<string>([start.id])
    const queue = [start.id]
    while (queue.length) {
      const current = queue.shift()!
      outgoing(current).forEach((edge) => { if (!reached.has(edge.target)) { reached.add(edge.target); queue.push(edge.target) } })
    }
    executable.filter((node) => !reached.has(node.id)).forEach((node) => warning('graph', 'unreachable_node', 'Блок недостижим из старта', { nodeId: node.id }))
    if (![...reached].some((id) => executable.find((node) => node.id === id)?.type === 'end')) error('graph', 'no_finish_path', 'Из старта нет пути ни к одному завершению', { nodeId: start.id })
  }

  const cycles = findCycles(executable, validEdges)
  cycles.forEach((cycle) => {
    const nodes = cycle.map((id) => executable.find((node) => node.id === id)).filter(Boolean) as FunnelNode[]
    const safe = nodes.some((node) => ['timer','wait_until','question','test','form','consent','product','external_link'].includes(node.type))
    const report = safe ? warning : error
    report('graph', safe ? 'potential_cycle' : 'unconditional_cycle', safe ? 'Найден намеренный или потенциальный цикл — проверьте условие выхода' : 'Безусловный цикл не содержит ожидания или действия пользователя', { nodeId: cycle[0] })
  })
  if (document.nodes.length > 250) advice('graph', 'large_graph', 'Для большой схемы используйте группы и автоматическую раскладку')
}

function requiredHandles(node: FunnelNode) {
  const all = nodeHandles(node)
  if (node.type === 'message') return all
  if (node.type === 'choice' || node.type === 'condition' || node.type === 'random') return all
  if (node.type === 'question') return all.filter((handle) => handle.id !== 'attempts_exceeded')
  if (node.type === 'test') return all.filter((handle) => handle.id === 'completed')
  if (node.type === 'timer') return all.filter((handle) => handle.id === 'next')
  if (node.type === 'form') return all.filter((handle) => handle.id === 'success')
  if (node.type === 'consent') return all.filter((handle) => handle.id === 'accepted' || (node.data as ConsentData).declineEnabled)
  if (node.type === 'product') return all.filter((handle) => ['success','failure','cancelled','already_purchased'].includes(handle.id) || ((node.data as ProductBlockData).allowSkip && handle.id === 'skip'))
  if (['end','sub_funnel','comment','group'].includes(node.type)) return []
  return all.slice(0, 1)
}

function validateVariables(document: FunnelDocument, error: Reporter, warning: Reporter, advice: Reporter) {
  const typeMap = variableTypeMap(document.variables, SYSTEM_VARIABLES)
  const known = new Set(typeMap.keys())
  const localTemplateVariables = new Set(['current', 'total'])
  document.variables.forEach((variable) => {
    if (!isValueCompatible(variable.type, variable.defaultValue)) error('variables', 'invalid_default_type', `Значение по умолчанию «${variable.name}» не соответствует типу ${variable.type}`, { entityId: variable.id })
  })
  const inspect = (value: unknown, path: string, nodeId?: string) => {
    if (typeof value === 'string') templateVariableKeys(value).forEach((key) => { if (!known.has(key) && !knownPrefix(key) && !localTemplateVariables.has(key)) error('variables', 'unknown_template_variable', `В тексте используется неизвестная переменная «${key}»`, { path, nodeId }) })
    if (!value || typeof value !== 'object') return
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      if ((key === 'variableKey' || key.endsWith('VariableKey')) && typeof child === 'string' && child && !known.has(child)) error('variables', 'unknown_variable', `Ссылка на неизвестную переменную «${child}»`, { path: `${path}.${key}`, nodeId })
      if (Array.isArray(child)) child.forEach((item, index) => inspect(item, `${path}.${key}[${index}]`, nodeId))
      else inspect(child, `${path}.${key}`, nodeId)
    })
  }
  document.nodes.forEach((node, index) => inspect(node.data, `nodes[${index}].data`, node.id))
  document.tests.forEach((test, index) => inspect(test, `tests[${index}]`, test.id))
  document.nodes.filter((node) => node.type === 'condition').forEach((node) => {
    ;(node.data as ConditionData).branches.filter((branch) => branch.condition).forEach((branch) => validateConditionTypes(branch.condition!, typeMap).forEach((message) => error('variables', 'condition_type', message, { nodeId: node.id })))
  })
  document.nodes.filter((node) => node.type === 'formula').forEach((node) => {
    const data = node.data as FormulaData
    if (data.targetVariableKey && typeMap.get(data.targetVariableKey) !== 'number') error('variables', 'formula_target_type', 'Результат формулы можно записать только в числовую переменную', { nodeId: node.id })
    validateFormula(data.expression, typeMap).forEach((message) => error('variables', 'invalid_formula', message, { nodeId: node.id }))
  })
  const used = referencedVariableKeys(document)
  document.variables.filter((variable) => !used.has(variable.key)).forEach((variable) => advice('variables', 'unused_variable', `Переменная «${variable.name}» пока не используется`, { entityId: variable.id }))
  document.nodes.filter((node) => node.type === 'sub_funnel').forEach((node) => {
    const data = node.data as SubFunnelData
    data.variableKeys.forEach((key) => { const variable = document.variables.find((item) => item.key === key); if (variable && !variable.transferable) error('variables', 'non_transferable_variable', `Переменную «${variable.name}» запрещено передавать в другую воронку`, { nodeId: node.id }) })
  })
  if (!document.variables.length) advice('variables', 'no_variables', 'Добавьте переменные, если сценарий должен запоминать ответы')
}

function validateContent(document: FunnelDocument, error: Reporter, warning: Reporter, advice: Reporter) {
  document.nodes.forEach((node, index) => {
    if (!node.data.title.trim()) error('content', 'empty_title', 'Название блока не заполнено', { nodeId: node.id, path: `nodes[${index}].data.title` })
    if (node.type === 'message') {
      const data = node.data as MessageData
      if (!data.text.trim()) error('content', 'empty_message', 'Текст сообщения не заполнен', { nodeId: node.id })
      if (data.buttons.length > 8) error('content', 'too_many_buttons', 'В сообщении допускается не более 8 кнопок', { nodeId: node.id })
      data.buttons.forEach((button) => {
        if (!button.text.trim()) error('content', 'empty_button', 'Текст кнопки не заполнен', { nodeId: node.id })
        if (button.action === 'url' && !safeUrl(button.url)) error('content', 'invalid_url', `У кнопки «${button.text}» неверный URL`, { nodeId: node.id })
      })
    }
    if (node.type === 'choice') {
      const data = node.data as ChoiceData
      if (!data.prompt.trim()) error('content', 'empty_choice_prompt', 'Текст выбора не заполнен', { nodeId: node.id })
      if (data.options.length < 1 || data.options.length > 20) error('content', 'choice_count', 'Выбор должен содержать от 1 до 20 вариантов', { nodeId: node.id })
      if (data.selectionMode === 'multiple' && (data.minSelected < 1 || data.maxSelected < data.minSelected || data.maxSelected > data.options.length + (data.allowOther ? 1 : 0))) error('content', 'invalid_selection_limits', 'Проверьте минимум и максимум множественного выбора', { nodeId: node.id })
      data.options.filter((item) => item.enabled !== false && !item.text.trim()).forEach(() => error('content', 'empty_choice', 'Активный вариант не имеет текста', { nodeId: node.id }))
    }
    if (node.type === 'question') {
      const data = node.data as QuestionData
      if (!data.question.trim()) error('content', 'empty_question', 'Текст вопроса не заполнен', { nodeId: node.id })
      if (['single_choice','multiple_choice'].includes(data.inputType) && data.answers.filter((item) => item.enabled !== false).length < 1) error('content', 'question_without_answers', 'Для выбранного типа вопроса нужны ответы', { nodeId: node.id })
      if (data.maxAttempts < 1) error('content', 'invalid_attempts', 'Количество попыток должно быть больше нуля', { nodeId: node.id })
      if (data.validationPattern) { try { new RegExp(data.validationPattern) } catch { error('content', 'invalid_pattern', 'Регулярное выражение проверки некорректно', { nodeId: node.id }) } }
    }
    if (node.type === 'condition') {
      const branches = (node.data as ConditionData).branches
      if (!branches.some((branch) => branch.isElse)) error('variables', 'condition_without_else', 'Условию нужна ветка «Иначе»', { nodeId: node.id, fix: 'create_else_branch' })
      if (branches.filter((branch) => branch.isElse).length > 1) error('variables', 'multiple_else', 'Ветка «Иначе» должна быть одна', { nodeId: node.id })
    }
    if (node.type === 'timer') { const data = node.data as TimerData; if (!Number.isFinite(data.duration) || data.duration <= 0) error('schedule', 'invalid_timer', 'Задержка должна быть больше нуля', { nodeId: node.id }) }
    if (node.type === 'wait_until') { const data = node.data as WaitUntilData; if (data.mode === 'fixed' && (!data.dateTime || Number.isNaN(new Date(data.dateTime).getTime()))) error('schedule', 'invalid_wait_date', 'Укажите корректную дату ожидания', { nodeId: node.id }) }
    if (node.type === 'reminder') { const data = node.data as ReminderData; if (data.duration <= 0 || data.maxSends < 1 || data.maxSends > 20) error('schedule', 'invalid_reminder', 'Проверьте задержку и число отправок напоминания', { nodeId: node.id }); if (!data.cancelCondition) warning('schedule', 'reminder_without_cancel', 'У напоминания нет условия отмены после продолжения пользователя', { nodeId: node.id }) }
    if (node.type === 'form') { const data = node.data as FormData; if (!data.fields.length) error('content', 'empty_form', 'В форме нет полей', { nodeId: node.id }); data.fields.filter((field) => !field.label.trim()).forEach(() => error('content', 'empty_form_label', 'Поле формы не имеет подписи', { nodeId: node.id })) }
    if (node.type === 'consent') { const data = node.data as ConsentData; if (!data.text.trim() || !data.acceptText.trim()) error('content', 'incomplete_consent', 'Заполните текст согласия и кнопку принятия', { nodeId: node.id }); if (data.policyUrl && !safeUrl(data.policyUrl)) error('content', 'invalid_policy_url', 'Ссылка на политику некорректна', { nodeId: node.id }) }
    if (node.type === 'external_link') { const data = node.data as ExternalLinkData; if (!safeUrl(data.url)) error('content', 'invalid_external_url', 'Разрешены только ссылки http://, https:// и tg://', { nodeId: node.id }) }
    if (node.type === 'random') { const data = node.data as RandomData; if (data.branches.length < 2 || data.branches.length > 10 || data.branches.some((branch) => branch.weight <= 0)) error('content', 'invalid_random_weights', 'Случайное распределение требует 2–10 веток с положительными весами', { nodeId: node.id }) }
    if (node.type === 'sub_funnel') { const data = node.data as SubFunnelData; if (!data.targetFunnelKey.trim() || !data.targetEntryKey.trim()) error('content', 'incomplete_sub_funnel', 'Укажите ключ целевой воронки и точки входа', { nodeId: node.id }) }
  })
  if (!document.funnel.description.trim()) advice('content', 'empty_description', 'Добавьте описание воронки для команды')
}

function validateTests(document: FunnelDocument, error: Reporter, warning: Reporter, advice: Reporter) {
  document.nodes.filter((node) => node.type === 'test').forEach((node) => {
    const id = (node.data as TestBlockData).testId
    if (!id || !document.tests.some((test) => test.id === id)) error('tests', 'unknown_test', 'Блок не ссылается на существующий тест', { nodeId: node.id })
  })
  document.tests.forEach((test) => {
    const scales = new Set(test.scales.map((scale) => scale.id))
    if (!test.questions.length) error('tests', 'test_without_questions', `В тесте «${test.name}» нет вопросов`, { entityId: test.id })
    test.questions.filter((question) => question.enabled).forEach((question) => {
      if (['single','multiple'].includes(question.type) && !question.answers.some((answer) => answer.enabled !== false)) error('tests', 'active_question_without_answers', `Вопрос «${question.text}» не имеет активных ответов`, { entityId: question.id })
      question.answers.filter((answer) => answer.enabled !== false).forEach((answer) => {
        if (!answer.text.trim() && !answer.value) error('tests', 'empty_test_answer', 'Активный ответ теста не имеет значения', { entityId: answer.id })
        answer.scoring.forEach((score) => { if (score.scaleId && !scales.has(score.scaleId)) error('tests', 'unknown_score_scale', `Scoring ссылается на неизвестную шкалу «${score.scaleId}»`, { entityId: answer.id }) })
      })
    })
    const maxima = dynamicMaxima(test)
    test.scales.filter((scale) => scale.normalization === 'dynamic_percent' && maxima[scale.id] === 0).forEach((scale) => error('tests', 'zero_dynamic_max', `У шкалы «${scale.name}» нулевой динамический максимум`, { entityId: scale.id }))
    const resultSet = document.resultSets.find((set) => set.id === test.resultSetId)
    if (!resultSet) error('tests', 'missing_result_set', `Для теста «${test.name}» не выбран набор результатов`, { entityId: test.id })
    else {
      if (!resultSet.fallbackResultCode || !resultSet.results.some((result) => result.code === resultSet.fallbackResultCode)) error('tests', 'missing_fallback_result', `У набора «${resultSet.name}» нет запасного результата`, { entityId: resultSet.id })
      resultSet.rules.filter((rule) => rule.type === 'closeness').forEach((rule) => {
        if ((rule.closenessPoints ?? 0) < 0) error('tests', 'invalid_closeness', 'Порог близости не может быть отрицательным', { entityId: rule.id })
      })
      const combinedPairs = new Set(resultSet.results.filter((result) => result.combined).map((result) => [...result.scaleIds].sort().join('|')))
      if (resultSet.rules.some((rule) => rule.type === 'closeness') && test.scales.length > 1 && !combinedPairs.size) warning('tests', 'missing_combined_results', 'Правило близости настроено, но комбинированных результатов нет', { entityId: resultSet.id })
    }
  })
  if (!document.tests.length) advice('tests', 'no_tests', 'Воронка может работать без теста; добавить его можно в разделе «Тесты и результаты»')
}

function validateMedia(document: FunnelDocument, error: Reporter, warning: Reporter, advice: Reporter) {
  const referenced = referencedAssetIds(document)
  document.assets.forEach((asset) => {
    if (!asset.assetKey.trim() || !asset.displayName.trim()) error('media', 'incomplete_asset', 'У медиа должны быть ключ и отображаемое имя', { entityId: asset.id })
    if (asset.required && (!asset.description.trim() || !asset.expectedMimeTypes.length)) warning('media', 'incomplete_required_asset', `Обязательный ресурс «${asset.displayName}» описан не полностью`, { entityId: asset.id })
    if (!referenced.has(asset.id)) advice('media', 'unused_asset', `Ресурс «${asset.displayName}» не используется`, { entityId: asset.id })
  })
  document.nodes.filter((node) => node.type === 'media').forEach((node) => { if (!mediaNodeAsset(node, document)) error('media', 'missing_asset_reference', 'Медиа-блок ссылается на отсутствующий ресурс', { nodeId: node.id }) })
}

function validateProducts(document: FunnelDocument, error: Reporter, warning: Reporter) {
  const assetIds = new Set(document.assets.map((asset) => asset.id))
  document.products.forEach((product) => {
    if (product.priceMinor <= 0) error('products', 'invalid_price', `Цена продукта «${product.name}» должна быть положительной`, { entityId: product.id })
    if (!/^[A-Z]{3}$/.test(product.currency)) error('products', 'invalid_currency', `Валюта «${product.currency}» должна быть трёхбуквенным кодом`, { entityId: product.id })
    product.assetIds.concat(product.personalization.map((item) => item.assetId)).forEach((id) => { if (!assetIds.has(id)) error('products', 'unknown_product_asset', `Продукт «${product.name}» ссылается на неизвестное медиа`, { entityId: product.id }) })
    if (product.personalization.length && !product.fallbackAssetId) warning('products', 'missing_product_fallback', `У продукта «${product.name}» нет запасного ресурса для неизвестного результата`, { entityId: product.id })
  })
  document.nodes.filter((node) => node.type === 'product').forEach((node) => { const id = (node.data as ProductBlockData).productId; if (!id || !document.products.some((product) => product.id === id)) error('products', 'unknown_product', 'Блок оплаты не ссылается на существующий продукт', { nodeId: node.id }) })
}

function validateSchedule(document: FunnelDocument, error: Reporter, warning: Reporter) {
  const schedule = document.settings.schedule
  ;[schedule.timezone, schedule.fallbackTimezone].forEach((timezone) => { try { new Intl.DateTimeFormat('ru-RU', { timeZone: timezone }).format() } catch { error('schedule', 'invalid_timezone', `Неизвестный часовой пояс «${timezone}»`, { path: 'settings.schedule' }) } })
  if (schedule.maxBackgroundTouchesPerDay < 0 || schedule.maxBackgroundTouchesPerDay > 20) error('schedule', 'invalid_touch_limit', 'Дневной лимит фоновых касаний должен быть от 0 до 20', { path: 'settings.schedule.maxBackgroundTouchesPerDay' })
  if (schedule.quietHours.enabled && schedule.quietHours.from === schedule.quietHours.to) error('schedule', 'full_day_quiet_hours', 'Тихие часы не могут занимать полные сутки', { path: 'settings.schedule.quietHours' })
  if (!schedule.quietHours.enabled && document.nodes.some((node) => node.type === 'reminder')) warning('schedule', 'reminders_without_quiet_hours', 'Есть напоминания, но общие тихие часы выключены', { path: 'settings.schedule.quietHours' })
}

function validateAnalytics(document: FunnelDocument, error: Reporter, warning: Reporter) {
  const analytics = document.analytics
  if (analytics.snapshotAt && analytics.funnelVersion !== document.funnel.version) error('analytics', 'analytics_version_mismatch', `Статистика относится к версии ${analytics.funnelVersion}, а файл — к версии ${document.funnel.version}`, { path: 'analytics.funnelVersion', fix: 'reset_analytics' })
  const nodeIds = new Set(document.nodes.map((node) => node.id))
  Object.entries(analytics.nodes).forEach(([id, metric]) => {
    if (!nodeIds.has(id)) warning('analytics', 'analytics_unknown_node', `Статистика ссылается на отсутствующий блок «${id}»`, { path: `analytics.nodes.${id}` })
    if (metric.entered < 0 || metric.completed < 0 || (metric.dropped ?? 0) < 0) error('analytics', 'negative_counter', `У блока «${id}» отрицательный счётчик`, { path: `analytics.nodes.${id}` })
    if (metric.completed > metric.entered) error('analytics', 'completed_over_entered', `У блока «${id}» завершивших больше, чем вошедших`, { path: `analytics.nodes.${id}` })
  })
  const edgeIds = new Set(document.edges.map((edge) => edge.id))
  Object.entries(analytics.edges).forEach(([id, metric]) => { if (!edgeIds.has(id)) warning('analytics', 'analytics_unknown_edge', `Статистика ссылается на отсутствующую связь «${id}»`, { path: `analytics.edges.${id}` }); if (metric.transitions < 0) error('analytics', 'negative_edge_counter', `У связи «${id}» отрицательный счётчик`, { path: `analytics.edges.${id}` }) })
  duplicateRecords(analytics.contacts).forEach((id) => warning('analytics', 'duplicate_contact', `Контакт «${id}» встречается несколько раз`, { path: 'analytics.contacts' }))
  duplicateRecords(analytics.applications).forEach((id) => warning('analytics', 'duplicate_application', `Заявка «${id}» встречается несколько раз`, { path: 'analytics.applications' }))
}

function validateFormula(expression: FormulaData['expression'], types: Map<string, VariableType>): string[] {
  if (expression.kind === 'number') return []
  if (expression.kind === 'variable') return types.get(expression.key) === 'number' ? [] : [`Переменная «${expression.key}» не является числом`]
  if (expression.kind === 'binary') {
    const errors = [...validateFormula(expression.left, types), ...validateFormula(expression.right, types)]
    if (expression.operator === '/' && expression.right.kind === 'number' && expression.right.value === 0) errors.push('Деление на ноль')
    return errors
  }
  return expression.args.flatMap((arg) => validateFormula(arg, types))
}

function isValueCompatible(type: VariableType, value: unknown) {
  if (type === 'string' || type === 'dateTime') return typeof value === 'string'
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'stringList') return Array.isArray(value) && value.every((item) => typeof item === 'string')
  if (type === 'numberList') return Array.isArray(value) && value.every((item) => typeof item === 'number')
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function knownPrefix(key: string) { return SYSTEM_VARIABLES.some((variable) => key.startsWith(`${variable.key}.`)) }
function safeUrl(value?: string) { if (!value) return false; try { return ['http:','https:','tg:'].includes(new URL(value).protocol) } catch { return false } }
function duplicateRecords(items: Array<{ id: string }>) { const seen = new Set<string>(); const duplicates = new Set<string>(); items.forEach((item) => { if (seen.has(item.id)) duplicates.add(item.id); seen.add(item.id) }); return [...duplicates] }

function findCycles(nodes: FunnelNode[], edges: FunnelDocument['edges']) {
  const adjacency = new Map(nodes.map((node) => [node.id, edges.filter((edge) => edge.source === node.id).map((edge) => edge.target)]))
  const visiting = new Set<string>(); const visited = new Set<string>(); const stack: string[] = []; const cycles: string[][] = []
  const walk = (id: string) => {
    if (visiting.has(id)) { const index = stack.indexOf(id); if (index >= 0) cycles.push(stack.slice(index)); return }
    if (visited.has(id)) return
    visiting.add(id); stack.push(id); (adjacency.get(id) ?? []).forEach(walk); stack.pop(); visiting.delete(id); visited.add(id)
  }
  nodes.forEach((node) => walk(node.id))
  const unique = new Map(cycles.map((cycle) => [[...cycle].sort().join('|'), cycle]))
  return [...unique.values()]
}
