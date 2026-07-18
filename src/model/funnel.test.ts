import { describe, expect, it } from 'vitest'
import { demoFunnel } from './demo'
import { analyticsForNode, createEmptyFunnel, createNewVersion } from './funnel'
import { parseFunnelDocument } from './schema'
import { serializeFunnel } from '../services/files'
import { validateFunnel } from './validation'

describe('формат .funnel', () => {
  it('принимает корректный документ', () => {
    const result = parseFunnelDocument(structuredClone(demoFunnel))
    expect(result.success).toBe(true)
    expect(validateFunnel(demoFunnel).filter((issue) => issue.severity === 'error')).toEqual([])
  })

  it('отклоняет повреждённый документ с понятным путём', () => {
    const broken = structuredClone(demoFunnel) as unknown as Record<string, unknown>
    broken.documentType = 'javascript'
    const result = parseFunnelDocument(broken)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.errors[0]).toContain('documentType')
  })

  it('сохраняет основные и неизвестные совместимые поля при round-trip', () => {
    const source = structuredClone(demoFunnel)
    source.futureExtension = { enabled: true }
    source.nodes[0].futureNodeField = 'kept'
    const serialized = serializeFunnel(source)
    const parsed = parseFunnelDocument(JSON.parse(serialized))
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.analytics).toEqual(source.analytics)
      expect(parsed.data.nodes.map((node) => node.id)).toEqual(source.nodes.map((node) => node.id))
      expect(parsed.data.futureExtension).toEqual({ enabled: true })
      expect(parsed.data.nodes[0].futureNodeField).toBe('kept')
    }
  })

  it('создаёт следующую версию', () => {
    const next = createNewVersion(demoFunnel)
    expect(next.funnel.version).toBe(2)
    expect(next.funnel.status).toBe('draft')
    expect(next.nodes).toEqual(demoFunnel.nodes)
    expect(next.edges).toEqual(demoFunnel.edges)
  })

  it('сбрасывает статистику только в новой версии', () => {
    const source = structuredClone(demoFunnel)
    const next = createNewVersion(source)
    expect(source.analytics.summary.started).toBe(120)
    expect(next.analytics.snapshotAt).toBeNull()
    expect(next.analytics.summary).toEqual({ totalUsers: 0, started: 0, completed: 0 })
    expect(next.analytics.funnelVersion).toBe(2)
  })

  it('не меняет устойчивые ID при редактировании названия', () => {
    const document = structuredClone(demoFunnel)
    const ids = document.nodes.map((node) => node.id)
    document.nodes[1].data.title = 'Новое название'
    expect(document.nodes.map((node) => node.id)).toEqual(ids)
  })
})

describe('проверка графа', () => {
  it('находит недостижимый блок', () => {
    const document = structuredClone(demoFunnel)
    document.nodes.push({ id: 'orphan', type: 'end', position: { x: 0, y: 0 }, data: { title: 'Сирота', text: '—', note: '' } })
    const issues = validateFunnel(document)
    expect(issues.some((issue) => issue.code === 'unreachable_node' && issue.nodeId === 'orphan')).toBe(true)
  })

  it('находит отсутствующий переход варианта', () => {
    const document = structuredClone(demoFunnel)
    document.edges = document.edges.filter((edge) => edge.id !== 'edge_choice_test')
    expect(validateFunnel(document).some((issue) => issue.code === 'choice_without_edge')).toBe(true)
  })

  it('проверяет пустые и повторяющиеся assetKey', () => {
    const document = structuredClone(demoFunnel)
    document.nodes.push({ id: 'media_two', type: 'media', position: { x: 0, y: 0 }, data: { title: 'Дубль', assetKey: 'gift_day_1_voice', displayName: 'Дубль', expectedType: 'voice', caption: '', required: true } })
    let issues = validateFunnel(document)
    expect(issues.some((issue) => issue.code === 'duplicate_asset_key')).toBe(true)
    ;(document.nodes.at(-1)!.data as { assetKey: string }).assetKey = ''
    issues = validateFunnel(document)
    expect(issues.some((issue) => issue.code === 'empty_asset_key')).toBe(true)
  })

  it('вычисляет entered, completed, dropped и conversion', () => {
    expect(analyticsForNode(demoFunnel, 'demo_question')).toEqual({ entered: 89, completed: 78, dropped: 11, conversion: (78 / 89) * 100 })
    const empty = createEmptyFunnel()
    expect(analyticsForNode(empty, empty.funnel.startNodeId)).toEqual({ entered: 0, completed: 0, dropped: 0, conversion: 0 })
  })
})
