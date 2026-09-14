import { nodeHandles, validateFunnel, type FunnelDocument, type ValidationIssue } from './shared'
import type { ProductRuntimeConfig } from '../domain/types'

export interface RuntimeValidationContext {
  productConfigs?: Record<string, ProductRuntimeConfig>
  installedTrackingCodes?: Set<string>
  allowPlaceholders?: boolean
}

export function validateForRuntime(document: FunnelDocument, context: RuntimeValidationContext = {}): ValidationIssue[] {
  const issues = [...validateFunnel(document)]
  const add = (issue: ValidationIssue) => issues.push(issue)
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]))

  for (const node of document.nodes) {
    for (const handle of nodeHandles(node, document)) {
      const matches = document.edges.filter((edge) => edge.source === node.id && (edge.sourceHandle ?? 'next') === handle.id)
      if (matches.length > 1) add({
        severity: 'error',
        section: 'structure',
        code: 'runtime_multiple_edges',
        nodeId: node.id,
        message: `Выход «${handle.label}» имеет несколько стрелок. Telegram-бот не сможет однозначно выбрать переход.`,
      })
    }
  }

  const reachable = reachableNodeIds(document)
  document.nodes.filter((node) => !reachable.has(node.id)).forEach((node) => add({
    severity: 'warning',
    section: 'structure',
    code: 'runtime_unreachable',
    nodeId: node.id,
    message: `Этап «${node.data.title || 'Без названия'}» недостижим от старта.`,
  }))
  if (![...reachable].some((id) => nodeById.get(id)?.type === 'end')) add({
    severity: 'error',
    section: 'structure',
    code: 'runtime_no_reachable_end',
    message: 'Из точки старта нельзя дойти ни до одного завершения.',
  })

  const autoCycle = findAutomaticCycle(document)
  if (autoCycle.length) add({
    severity: 'error',
    section: 'structure',
    code: 'runtime_auto_cycle',
    nodeId: autoCycle[0],
    message: 'Найден автоматический цикл без вопроса, кнопки или паузы. Такой сценарий зациклит Telegram-бота.',
  })

  for (const product of document.products) {
    const used = document.nodes.some((node) => node.type === 'product' && (node.data as { productId?: string }).productId === product.id)
      || document.nodes.some((node) => node.type === 'message' && (node.data as { buttons: Array<{ productId?: string }> }).buttons.some((button) => button.productId === product.id))
    if (!used) continue
    const config = context.productConfigs?.[product.id]
    if (!config || config.provider === 'unconfigured') add({
      severity: 'error',
      section: 'products',
      code: 'runtime_product_unconfigured',
      message: `Для продукта «${product.name}» выберите способ оплаты.`,
    })
    if (config?.productType === 'digital' && config.provider === 'yookassa') add({
      severity: 'error',
      section: 'products',
      code: 'runtime_digital_yookassa',
      message: `Цифровой продукт «${product.name}» нельзя выдавать внутри Telegram после оплаты через ЮKassa. Выберите Telegram Stars.`,
    })
    const blocks = document.nodes.filter((node) => node.type === 'product' && (node.data as { productId?: string }).productId === product.id)
    blocks.forEach((node) => {
      const displayPrice = Number((node.data as { price?: number }).price ?? product.price)
      if (displayPrice !== product.price) add({
        severity: 'error',
        section: 'products',
        code: 'runtime_price_mismatch',
        nodeId: node.id,
        message: `В предложении «${node.data.title}» цена отличается от каталога продукта «${product.name}». Источник истины — каталог.`,
      })
    })
  }

  document.assets.filter((asset) => asset.required && !context.allowPlaceholders).forEach((asset) => {
    if (!asset.logicalRef.trim()) add({
      severity: 'error',
      section: 'media',
      code: 'runtime_required_media',
      message: `Обязательный материал «${asset.name}» не заполнен и публикация без заглушек запрещена.`,
    })
  })

  for (const test of document.tests) {
    for (const result of [...test.results, ...test.combinedResults]) {
      if (result.buttons.filter((button) => button.action === 'branch').length > 1) add({
        severity: 'warning',
        section: 'tests',
        code: 'runtime_duplicate_result_branch',
        message: `У результата «${result.name}» несколько кнопок продолжения, но все ведут в одну ветку результата.`,
      })
    }
  }

  for (const link of document.bot.trackingLinks) {
    if (context.installedTrackingCodes?.has(link.code)) add({
      severity: 'error',
      section: 'bot',
      code: 'runtime_tracking_conflict',
      message: `Tracking-код «${link.code}» уже используется другой установленной воронкой.`,
    })
  }

  return deduplicateIssues(issues)
}

function reachableNodeIds(document: FunnelDocument) {
  const reached = new Set<string>()
  const queue = [document.funnel.startNodeId]
  while (queue.length) {
    const id = queue.shift()!
    if (reached.has(id)) continue
    reached.add(id)
    document.edges.filter((edge) => edge.source === id).forEach((edge) => queue.push(edge.target))
  }
  return reached
}

function findAutomaticCycle(document: FunnelDocument): string[] {
  const automatic = new Set(document.nodes.filter((node) => ['start', 'media', 'variable', 'condition'].includes(node.type)).map((node) => node.id))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []

  const walk = (id: string): string[] => {
    if (visiting.has(id)) return stack.slice(stack.indexOf(id))
    if (visited.has(id) || !automatic.has(id)) return []
    visiting.add(id)
    stack.push(id)
    for (const edge of document.edges.filter((item) => item.source === id)) {
      const found = walk(edge.target)
      if (found.length) return found
    }
    stack.pop()
    visiting.delete(id)
    visited.add(id)
    return []
  }

  return walk(document.funnel.startNodeId)
}

function deduplicateIssues(issues: ValidationIssue[]) {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.code}|${issue.nodeId ?? ''}|${issue.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
