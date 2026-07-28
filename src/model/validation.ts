import { nodeHandles, nodeTitle } from './funnel'
import { operationNeedsValue, operationsForType, operatorNeedsValue, operatorsForType } from './variables'
import type { ConditionData, FunnelDocument, MessageData, ProductBlockData, TestBlockData, ValidationIssue, VariableData } from './types'

export function validateFunnel(document: FunnelDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (issue: ValidationIssue) => issues.push(issue)
  const nodeIds = new Set(document.nodes.map((node) => node.id))
  const uniqueNodeIds = new Set<string>()
  const variableKeys = new Set<string>()
  const variableIds = new Set<string>()

  document.variables.forEach((variable) => {
    if (variableIds.has(variable.id)) add({ severity: 'error', section: 'variables', code: 'variable_id_duplicate', message: `У переменной «${variable.name || 'Без названия'}» повторяется внутренний идентификатор.` })
    variableIds.add(variable.id)
    if (!variable.name.trim()) add({ severity: 'error', section: 'variables', code: 'variable_name', message: 'У переменной не заполнено понятное название.' })
    if (!/^[a-z][a-z0-9_]*$/.test(variable.key)) add({ severity: 'error', section: 'variables', code: 'variable_key', message: `Код переменной «${variable.name || 'Без названия'}» должен начинаться с латинской буквы и содержать только a–z, цифры и _.` })
    if (variableKeys.has(variable.key)) add({ severity: 'error', section: 'variables', code: 'variable_duplicate', message: `Код переменной «${variable.key}» используется несколько раз.` })
    variableKeys.add(variable.key)
    if (
      (variable.type === 'text' && typeof variable.defaultValue !== 'string')
      || (variable.type === 'number' && typeof variable.defaultValue !== 'number')
      || (variable.type === 'boolean' && typeof variable.defaultValue !== 'boolean')
    ) add({ severity: 'error', section: 'variables', code: 'variable_default_type', message: `Начальное значение переменной «${variable.name}» не соответствует её типу.` })
  })

  document.nodes.forEach((node) => {
    if (uniqueNodeIds.has(node.id)) add({ severity: 'error', section: 'structure', code: 'duplicate_node', message: `В схеме два блока «${nodeTitle(node)}» с одинаковым внутренним идентификатором.` })
    uniqueNodeIds.add(node.id)
  })

  const starts = document.nodes.filter((node) => node.type === 'start')
  if (starts.length !== 1) add({ severity: 'error', section: 'structure', code: 'start_count', message: 'В воронке должна быть ровно одна точка старта.' })
  if (!nodeIds.has(document.funnel.startNodeId)) add({ severity: 'error', section: 'structure', code: 'start_missing', message: 'Точка старта воронки не найдена.' })

  document.edges.forEach((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      add({ severity: 'error', section: 'structure', code: 'broken_edge', message: 'Одна из стрелок ведёт к удалённому этапу.' })
      return
    }
    const source = document.nodes.find((node) => node.id === edge.source)!
    const handle = edge.sourceHandle ?? 'next'
    if (!nodeHandles(source, document).some((item) => item.id === handle)) {
      add({ severity: 'error', section: 'structure', code: 'unknown_handle', nodeId: source.id, message: `У этапа «${nodeTitle(source)}» осталась стрелка от удалённой кнопки или результата. Удалите эту стрелку и соедините ветку заново.` })
    }
  })

  document.nodes.forEach((node) => {
    if (!node.data.title.trim()) add({ severity: 'warning', section: 'content', code: 'empty_title', nodeId: node.id, message: 'У одного из этапов нет понятного названия.' })
    nodeHandles(node, document).forEach((handle) => {
      const connected = document.edges.some((edge) => edge.source === node.id && (edge.sourceHandle ?? 'next') === handle.id)
      if (!connected) add({
        severity: node.type === 'end' ? 'advice' : 'error',
        section: 'structure',
        code: 'missing_edge',
        nodeId: node.id,
        message: handle.id === 'next'
          ? `Этап «${nodeTitle(node)}» никуда не ведёт. Соедините его со следующим этапом.`
          : `Выход «${handle.label}» в этапе «${nodeTitle(node)}» никуда не ведёт. Соедините его с нужным следующим этапом.`,
      })
    })

    if (node.type === 'message') validateMessage(document, node.id, node.data as MessageData, add)
    if (node.type === 'variable') validateVariableNode(document, node.id, node.data as VariableData, add)
    if (node.type === 'condition') validateConditionNode(document, node.id, node.data as ConditionData, add)
    if (node.type === 'test') {
      const testId = (node.data as TestBlockData).testId
      if (!testId || !document.tests.some((test) => test.id === testId)) add({ severity: 'error', section: 'tests', code: 'test_missing', nodeId: node.id, message: `В этапе «${nodeTitle(node)}» не выбран тест.` })
    }
    if (node.type === 'product') {
      const product = node.data as ProductBlockData
      if (!product.productId || !document.products.some((item) => item.id === product.productId)) add({ severity: 'error', section: 'products', code: 'product_missing', nodeId: node.id, message: `В этапе «${nodeTitle(node)}» не выбран продукт.` })
    }
  })

  document.tests.forEach((test) => {
    if (!test.name.trim()) add({ severity: 'error', section: 'tests', code: 'test_name', message: 'У теста не заполнено название.' })
    if (!test.scales.length) add({ severity: 'error', section: 'tests', code: 'scales_empty', message: `В тесте «${test.name}» нет шкал.` })
    const scaleIds = new Set(test.scales.map((scale) => scale.id))
    test.questions.filter((question) => question.enabled).forEach((question) => {
      if (!question.text.trim()) add({ severity: 'error', section: 'tests', code: 'question_text', message: `В тесте «${test.name}» есть вопрос без текста.` })
      if (['single', 'multiple', 'scale'].includes(question.type) && !question.answers.length) add({ severity: 'error', section: 'tests', code: 'answers_empty', message: `У вопроса «${question.text || 'Без названия'}» нет вариантов ответа.` })
      question.answers.forEach((answer) => Object.keys(answer.scores).forEach((scaleId) => {
        if (!scaleIds.has(scaleId)) add({ severity: 'error', section: 'tests', code: 'score_scale_missing', message: `В ответе «${answer.text}» используются баллы удалённой шкалы.` })
      }))
    })
    test.scales.forEach((scale) => {
      if (!test.results.some((result) => result.scaleId === scale.id)) add({ severity: 'error', section: 'tests', code: 'result_missing', message: `Для шкалы «${scale.name}» не создан основной результат.` })
    })
  })

  document.assets.forEach((asset) => {
    if (!asset.logicalRef.trim()) add({ severity: asset.required ? 'warning' : 'advice', section: 'media', code: 'asset_empty', message: `Для материала «${asset.name}» ещё не заполнена логическая ссылка.` })
  })

  const codes = new Set<string>()
  document.bot.trackingLinks.forEach((link) => {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(link.code)) add({ severity: 'error', section: 'bot', code: 'tracking_code', message: `Код ссылки «${link.name}» содержит недопустимые символы.` })
    if (codes.has(link.code)) add({ severity: 'error', section: 'bot', code: 'tracking_duplicate', message: `Код отслеживаемой ссылки «${link.code}» используется несколько раз.` })
    codes.add(link.code)
  })
  if (document.analytics.funnelVersion !== document.funnel.version) add({ severity: 'warning', section: 'analytics', code: 'analytics_version', message: 'Снимок статистики относится к другой версии воронки.' })
  return issues
}

function validateVariableNode(document: FunnelDocument, nodeId: string, data: VariableData, add: (issue: ValidationIssue) => void) {
  if (!data.operations.length) add({ severity: 'error', section: 'variables', code: 'operations_empty', nodeId, message: `В этапе «${data.title}» не добавлено ни одного действия с переменной.` })
  const operationIds = new Set<string>()
  data.operations.forEach((operation) => {
    if (operationIds.has(operation.id)) add({ severity: 'error', section: 'variables', code: 'operation_duplicate', nodeId, message: `В этапе «${data.title}» повторяется внутренний идентификатор действия.` })
    operationIds.add(operation.id)
    const variable = document.variables.find((item) => item.id === operation.variableId)
    if (!variable) {
      add({ severity: 'error', section: 'variables', code: 'operation_variable_missing', nodeId, message: `В этапе «${data.title}» не выбрана переменная.` })
      return
    }
    if (!operationsForType(variable.type).includes(operation.operation)) add({ severity: 'error', section: 'variables', code: 'operation_incompatible', nodeId, message: `Действие «${operation.operation}» не подходит для переменной «${variable.name}».` })
    if (operationNeedsValue(operation.operation) && operation.value === undefined) add({ severity: 'error', section: 'variables', code: 'operation_value_missing', nodeId, message: `Для действия с переменной «${variable.name}» не заполнено значение.` })
    if (operationNeedsValue(operation.operation) && operation.value !== undefined && !valueMatchesType(operation.value, variable.type)) add({ severity: 'error', section: 'variables', code: 'operation_value_type', nodeId, message: `Значение в действии с переменной «${variable.name}» не соответствует её типу.` })
  })
}

function validateConditionNode(document: FunnelDocument, nodeId: string, data: ConditionData, add: (issue: ValidationIssue) => void) {
  const variable = document.variables.find((item) => item.id === data.variableId)
  if (!variable) {
    add({ severity: 'error', section: 'variables', code: 'condition_variable_missing', nodeId, message: `В условии «${data.title}» не выбрана переменная.` })
    return
  }
  if (!operatorsForType(variable.type).includes(data.operator)) add({ severity: 'error', section: 'variables', code: 'condition_incompatible', nodeId, message: `Сравнение «${data.operator}» не подходит для переменной «${variable.name}».` })
  if (operatorNeedsValue(data.operator) && data.value === undefined) add({ severity: 'error', section: 'variables', code: 'condition_value_missing', nodeId, message: `В условии «${data.title}» не заполнено значение для сравнения.` })
  if (operatorNeedsValue(data.operator) && data.value !== undefined && !valueMatchesType(data.value, variable.type)) add({ severity: 'error', section: 'variables', code: 'condition_value_type', nodeId, message: `Значение в условии «${data.title}» не соответствует типу переменной «${variable.name}».` })
}

function valueMatchesType(value: unknown, type: 'text' | 'number' | 'boolean') {
  return (type === 'text' && typeof value === 'string')
    || (type === 'number' && typeof value === 'number' && Number.isFinite(value))
    || (type === 'boolean' && typeof value === 'boolean')
}

function validateMessage(document: FunnelDocument, nodeId: string, data: MessageData, add: (issue: ValidationIssue) => void) {
  if (!data.text.trim()) add({ severity: 'error', section: 'content', code: 'message_empty', nodeId, message: `В сообщении «${data.title}» не заполнен текст.` })
  const ids = new Set<string>()
  data.buttons.forEach((button) => {
    if (ids.has(button.id)) add({ severity: 'error', section: 'structure', code: 'button_duplicate', nodeId, message: `В сообщении «${data.title}» две кнопки используют один и тот же внутренний выход.` })
    ids.add(button.id)
    if (!button.text.trim()) add({ severity: 'error', section: 'content', code: 'button_text', nodeId, message: `В сообщении «${data.title}» есть кнопка без подписи.` })
    if (button.action === 'url' && !/^https?:\/\//i.test(button.url ?? '')) add({ severity: 'error', section: 'content', code: 'button_url', nodeId, message: `У кнопки «${button.text || 'Без названия'}» должна быть полная ссылка, начинающаяся с https://.` })
    if (button.action === 'product' && !document.products.some((product) => product.id === button.productId)) add({ severity: 'error', section: 'products', code: 'button_product', nodeId, message: `Для кнопки «${button.text || 'Без названия'}» не выбран продукт.` })
  })
}
