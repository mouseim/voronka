import type { EntityDiff, FunnelDiff, FunnelDocument } from './types'

type Identified = { id: string; [key: string]: unknown }

export function compareFunnels(before: FunnelDocument, after: FunnelDocument): FunnelDiff {
  const sections: Record<string, EntityDiff[]> = {
    nodes: compareEntities(before.nodes as Identified[], after.nodes as Identified[]),
    edges: compareEntities(before.edges as Identified[], after.edges as Identified[]),
    variables: compareEntities(before.variables as Identified[], after.variables as Identified[]),
    tests: compareEntities(before.tests as Identified[], after.tests as Identified[]),
    resultSets: compareEntities(before.resultSets as Identified[], after.resultSets as Identified[]),
    assets: compareEntities(before.assets as Identified[], after.assets as Identified[]),
    products: compareEntities(before.products as Identified[], after.products as Identified[]),
    settings: compareEntities([{ id: 'settings', ...before.settings }], [{ id: 'settings', ...after.settings }]),
  }
  const all = Object.values(sections).flat()
  const beforeStarted = before.analytics.summary.started || 0
  const afterStarted = after.analytics.summary.started || 0
  const beforeCompleted = before.analytics.summary.completed || 0
  const afterCompleted = after.analytics.summary.completed || 0
  const beforeConversion = beforeStarted ? beforeCompleted / beforeStarted * 100 : 0
  const afterConversion = afterStarted ? afterCompleted / afterStarted * 100 : 0
  return {
    sameFunnel: before.funnel.id === after.funnel.id,
    summary: {
      added: all.filter((item) => item.status === 'added').length,
      removed: all.filter((item) => item.status === 'removed').length,
      changed: all.filter((item) => item.status === 'changed').length,
    },
    sections,
    analytics: { startedDelta: afterStarted - beforeStarted, completedDelta: afterCompleted - beforeCompleted, conversionDelta: afterConversion - beforeConversion },
  }
}

export function compareEntities<T extends Identified>(before: T[], after: T[]): EntityDiff<T>[] {
  const left = new Map(before.map((item) => [item.id, item]))
  const right = new Map(after.map((item) => [item.id, item]))
  const result: EntityDiff<T>[] = []
  for (const [id, item] of left) {
    const next = right.get(id)
    if (!next) result.push({ id, status: 'removed', before: item })
    else {
      const changes = changedPaths(item, next)
      if (changes.length) result.push({ id, status: 'changed', before: item, after: next, changes })
    }
  }
  for (const [id, item] of right) if (!left.has(id)) result.push({ id, status: 'added', after: item })
  return result
}

function changedPaths(before: unknown, after: unknown, prefix = ''): string[] {
  if (Object.is(before, after)) return []
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) !== Array.isArray(after)) return [prefix || 'value']
  if (Array.isArray(before) && Array.isArray(after)) return JSON.stringify(before) === JSON.stringify(after) ? [] : [prefix || 'items']
  const left = before as Record<string, unknown>; const right = after as Record<string, unknown>
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...keys].flatMap((key) => changedPaths(left[key], right[key], prefix ? `${prefix}.${key}` : key)).slice(0, 30)
}

export function diffText(diff: FunnelDiff) {
  const lines = [`Сравнение воронок`, `Добавлено: ${diff.summary.added}`, `Удалено: ${diff.summary.removed}`, `Изменено: ${diff.summary.changed}`, '']
  Object.entries(diff.sections).forEach(([section, items]) => {
    if (!items.length) return
    lines.push(section)
    items.forEach((item) => lines.push(`- ${item.status}: ${item.id}${item.changes?.length ? ` — ${item.changes.join(', ')}` : ''}`))
    lines.push('')
  })
  return lines.join('\n')
}
