import { describe, expect, it } from 'vitest'
import { freshDemoFunnel } from '../model/demo'
import { documentsMatchForSync } from './drafts'

describe('local/server funnel comparison', () => {
  it('игнорирует только служебное время, статус и analytics', () => {
    const local = freshDemoFunnel()
    const server = structuredClone(local)
    server.funnel.status = 'published'
    server.funnel.updatedAt = new Date(Date.now() + 10_000).toISOString()
    server.analytics.contacts.push({ id: 'contact', email: 'private@example.test' })
    expect(documentsMatchForSync(local, server)).toBe(true)
  })

  it('видит локальные изменения содержимого и расположения блоков', () => {
    const published = freshDemoFunnel()
    const contentChanged = structuredClone(published)
    contentChanged.funnel.name = 'Изменённое название'
    expect(documentsMatchForSync(contentChanged, published)).toBe(false)

    const layoutChanged = structuredClone(published)
    layoutChanged.editor.nodePositions[layoutChanged.funnel.startNodeId] = { x: 999, y: 999 }
    expect(documentsMatchForSync(layoutChanged, published)).toBe(false)
  })
})
