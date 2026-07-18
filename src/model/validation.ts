import type { ChoiceData, FunnelDocument, MediaData, MessageData, QuestionData, TimerData, ValidationIssue } from './types'

export function validateFunnel(document: FunnelDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const error = (code: string, message: string, options: Partial<ValidationIssue> = {}) => issues.push({ severity: 'error', code, message, ...options })
  const warning = (code: string, message: string, options: Partial<ValidationIssue> = {}) => issues.push({ severity: 'warning', code, message, ...options })
  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()

  for (const [index, node] of document.nodes.entries()) {
    if (nodeIds.has(node.id)) error('duplicate_node_id', `ID блока «${node.id}» повторяется`, { nodeId: node.id, path: `nodes[${index}].id` })
    nodeIds.add(node.id)
    if (!String(node.data.title ?? '').trim()) error('required_title', 'Название блока не заполнено', { nodeId: node.id, path: `nodes[${index}].data.title` })
  }

  const starts = document.nodes.filter((node) => node.type === 'start')
  if (starts.length === 0) error('missing_start', 'В воронке отсутствует стартовый блок', { path: 'nodes' })
  if (starts.length > 1) error('multiple_starts', 'В воронке должен быть ровно один стартовый блок', { path: 'nodes' })
  const configuredStart = document.nodes.find((node) => node.id === document.funnel.startNodeId)
  if (!configuredStart || configuredStart.type !== 'start') error('invalid_start_id', 'funnel.startNodeId не указывает на стартовый блок', { path: 'funnel.startNodeId' })

  for (const [index, edge] of document.edges.entries()) {
    if (edgeIds.has(edge.id)) error('duplicate_edge_id', `ID связи «${edge.id}» повторяется`, { edgeId: edge.id, path: `edges[${index}].id` })
    edgeIds.add(edge.id)
    if (!nodeIds.has(edge.source)) error('missing_edge_source', `Начальный блок связи «${edge.id}» не существует`, { edgeId: edge.id, path: `edges[${index}].source` })
    if (!nodeIds.has(edge.target)) error('missing_edge_target', `Конечный блок связи «${edge.id}» не существует`, { edgeId: edge.id, path: `edges[${index}].target` })
  }

  const outgoing = (nodeId: string, handle?: string) => document.edges.filter((edge) => edge.source === nodeId && (handle === undefined || (edge.sourceHandle ?? 'next') === handle))
  const incoming = (nodeId: string) => document.edges.filter((edge) => edge.target === nodeId)

  if (starts[0] && outgoing(starts[0].id).length === 0) error('start_without_edge', 'Из стартового блока не ведёт ни одного перехода', { nodeId: starts[0].id })

  for (const [index, node] of document.nodes.entries()) {
    if (node.type !== 'start' && incoming(node.id).length === 0) warning('no_incoming_edge', 'У блока нет входящих связей', { nodeId: node.id })
    if (node.type === 'end' && outgoing(node.id).length > 0) error('end_has_outgoing', 'Из блока завершения не может быть исходящих связей', { nodeId: node.id })
    if (['message', 'timer', 'media'].includes(node.type) && outgoing(node.id).length === 0) error('missing_next_edge', 'Для блока не настроен следующий переход', { nodeId: node.id })

    if (node.type === 'message') {
      const data = node.data as MessageData
      if (!data.text.trim()) error('empty_message', 'Текст сообщения не заполнен', { nodeId: node.id, path: `nodes[${index}].data.text` })
      if (data.continueEnabled && !data.buttonText.trim()) error('empty_button_text', 'Текст кнопки «Продолжить» не заполнен', { nodeId: node.id })
    }

    if (node.type === 'choice') {
      const data = node.data as ChoiceData
      if (!data.prompt.trim()) error('empty_prompt', 'Текст перед кнопками не заполнен', { nodeId: node.id })
      if (data.options.length < 1 || data.options.length > 8) error('choice_count', 'Выбор должен содержать от 1 до 8 кнопок', { nodeId: node.id })
      const optionIds = new Set<string>()
      data.options.forEach((option, optionIndex) => {
        if (!option.text.trim()) error('empty_choice', 'Текст варианта выбора не заполнен', { nodeId: node.id, path: `nodes[${index}].data.options[${optionIndex}].text` })
        if (optionIds.has(option.id)) error('duplicate_option_id', `ID варианта «${option.id}» повторяется`, { nodeId: node.id })
        optionIds.add(option.id)
        if (outgoing(node.id, option.id).length === 0) error('choice_without_edge', `Для варианта «${option.text || optionIndex + 1}» не настроен переход`, { nodeId: node.id })
      })
    }

    if (node.type === 'question') {
      const data = node.data as QuestionData
      if (!data.question.trim()) error('empty_question', 'Текст вопроса не заполнен', { nodeId: node.id })
      if (data.answers.length < 2 || data.answers.length > 8) error('answer_count', 'Вопрос должен содержать от 2 до 8 ответов', { nodeId: node.id })
      const answerIds = new Set<string>()
      data.answers.forEach((answer, answerIndex) => {
        if (!answer.text.trim()) error('empty_answer', 'Текст ответа не заполнен', { nodeId: node.id, path: `nodes[${index}].data.answers[${answerIndex}].text` })
        if (answerIds.has(answer.id)) error('duplicate_answer_id', `ID ответа «${answer.id}» повторяется`, { nodeId: node.id })
        answerIds.add(answer.id)
        if (outgoing(node.id, answer.id).length === 0) error('answer_without_edge', `Для ответа «${answer.text || answerIndex + 1}» не настроен переход`, { nodeId: node.id })
      })
    }

    if (node.type === 'timer') {
      const data = node.data as TimerData
      if (!Number.isInteger(data.duration) || data.duration <= 0) error('invalid_timer', 'Задержка должна быть целым числом больше нуля', { nodeId: node.id, path: `nodes[${index}].data.duration` })
    }

    if (node.type === 'media') {
      const data = node.data as MediaData
      if (!data.assetKey.trim()) error('empty_asset_key', 'assetKey не заполнен', { nodeId: node.id, path: `nodes[${index}].data.assetKey` })
      else if (!/^[a-z0-9][a-z0-9_-]*$/i.test(data.assetKey)) error('invalid_asset_key', 'assetKey может содержать буквы, цифры, «_» и «-»', { nodeId: node.id })
      if (!data.displayName.trim()) error('empty_asset_name', 'Отображаемое имя медиа не заполнено', { nodeId: node.id, path: `nodes[${index}].data.displayName` })
    }

    if (!['choice', 'question', 'end'].includes(node.type) && outgoing(node.id).length > 1) error('multiple_default_edges', 'У блока может быть только один следующий переход', { nodeId: node.id })
  }

  const mediaNodes = document.nodes.filter((node) => node.type === 'media')
  const assetKeys = new Map<string, string>()
  for (const node of mediaNodes) {
    const key = (node.data as MediaData).assetKey.trim()
    if (key && assetKeys.has(key)) error('duplicate_asset_key', `assetKey «${key}» используется несколько раз`, { nodeId: node.id })
    if (key) assetKeys.set(key, node.id)
  }

  if (configuredStart) {
    const reached = new Set<string>([configuredStart.id])
    const queue = [configuredStart.id]
    while (queue.length) {
      const current = queue.shift()!
      for (const edge of outgoing(current)) {
        if (nodeIds.has(edge.target) && !reached.has(edge.target)) {
          reached.add(edge.target)
          queue.push(edge.target)
        }
      }
    }
    document.nodes.filter((node) => !reached.has(node.id)).forEach((node) => warning('unreachable_node', 'Блок недостижим из старта', { nodeId: node.id }))
  }

  if (document.analytics.snapshotAt && document.analytics.funnelVersion !== document.funnel.version) {
    error('analytics_version_mismatch', `Статистика относится к версии ${document.analytics.funnelVersion}, а файл — к версии ${document.funnel.version}`, { path: 'analytics.funnelVersion' })
  }

  return issues
}
