import { describe, expect, it } from 'vitest'
import { demoFunnel } from './demo'
import { analyticsForNode, createEmptyFunnel, createNewVersion, createNode } from './funnel'
import { parseAndMigrateFunnelDocument, parseFunnelDocument } from './schema'
import { serializeFunnel } from '../services/files'
import { validateFunnel } from './validation'

describe('формат .funnel 1.0', () => {
  it('принимает полную демо-воронку без ошибок', () => {
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

  it('сохраняет неизвестные совместимые поля при round-trip', () => {
    const source = structuredClone(demoFunnel)
    source.futureExtension = { enabled: true }
    source.nodes[0].futureNodeField = 'kept'
    const parsed = parseFunnelDocument(JSON.parse(serializeFunnel(source)))
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.futureExtension).toEqual({ enabled: true })
      expect(parsed.data.nodes[0].futureNodeField).toBe('kept')
      expect(parsed.data.analytics).toEqual(source.analytics)
    }
  })

  it('мигрирует MVP 0.1 без изменения ID и изолирует сломанную аналитику', () => {
    const legacy = {
      documentType: 'funnel', schemaVersion: '0.1.0',
      project: { id: 'p_old', name: 'Старый проект', description: '' },
      funnel: { id: 'f_old', name: 'MVP', version: 3, status: 'draft', startNodeId: 'n_start', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-02T00:00:00.000Z' },
      nodes: [
        { id: 'n_start', type: 'start', position: { x: 10, y: 20 }, data: { title: 'Старт', note: '' } },
        { id: 'n_end', type: 'end', position: { x: 200, y: 20 }, data: { title: 'Конец', text: 'Готово', note: '' } },
      ],
      edges: [{ id: 'e_old', source: 'n_start', target: 'n_end', sourceHandle: 'next' }],
      assets: [], analytics: { snapshotAt: 42, nodes: 'broken' }, futureRoot: { keep: true },
    }
    const result = parseAndMigrateFunnelDocument(legacy)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.document.schemaVersion).toBe('1.0.0')
      expect(result.document.nodes.map((node) => node.id)).toEqual(['n_start', 'n_end'])
      expect(result.document.edges[0].id).toBe('e_old')
      expect(result.document.editor.nodePositions.n_start).toEqual({ x: 10, y: 20 })
      expect(result.document.futureRoot).toEqual({ keep: true })
      expect(result.analyticsIsolated).toBe(true)
      expect(result.document.analytics.summary.started).toBe(0)
    }
  })

  it('создаёт независимую следующую версию и сбрасывает статистику', () => {
    const next = createNewVersion(demoFunnel, 'Изменили тест')
    expect(next.funnel.version).toBe(2)
    expect(next.funnel.parentVersion).toBe(1)
    expect(next.funnel.changeComment).toBe('Изменили тест')
    expect(next.funnel.status).toBe('draft')
    expect(next.nodes).toEqual(demoFunnel.nodes)
    expect(next.analytics.snapshotAt).toBeNull()
    expect(demoFunnel.analytics.summary.started).toBe(1612)
  })
})

describe('проверка графа и аналитика', () => {
  it('находит недостижимый блок', () => {
    const document = structuredClone(demoFunnel)
    const orphan = createNode('end')
    orphan.id = 'orphan_end'
    orphan.data.title = 'Сирота'
    document.nodes.push(orphan)
    document.editor.nodePositions[orphan.id] = { x: 0, y: 0 }
    expect(validateFunnel(document).some((issue) => issue.code === 'unreachable_node' && issue.nodeId === orphan.id)).toBe(true)
  })

  it('находит отсутствующий переход варианта', () => {
    const document = structuredClone(demoFunnel)
    document.edges = document.edges.filter((edge) => edge.id !== 'edge_source_social')
    expect(validateFunnel(document).some((issue) => issue.code === 'missing_branch' && issue.nodeId === 'demo_source')).toBe(true)
  })

  it('проверяет повторяющиеся assetKey', () => {
    const document = structuredClone(demoFunnel)
    document.assets.push({ ...structuredClone(document.assets[0]), id: 'asset_duplicate' })
    expect(validateFunnel(document).some((issue) => issue.code === 'duplicate_key' && issue.section === 'media')).toBe(true)
  })

  it('вычисляет конверсию и корректно обрабатывает пустой снимок', () => {
    expect(analyticsForNode(demoFunnel, 'demo_test')).toEqual({ entered: 1488, completed: 1210, dropped: 278, conversion: (1210 / 1488) * 100 })
    const empty = createEmptyFunnel()
    expect(analyticsForNode(empty, empty.funnel.startNodeId)).toEqual({ entered: 0, completed: 0, dropped: 0, conversion: 0 })
  })
})
