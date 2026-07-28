import { describe, expect, it } from 'vitest'
import { nodeMeta } from '../components/nodeMeta'
import { freshDemoFunnel } from './demo'
import { createEmptyFunnel } from './funnel'
import { parseAndMigrateFunnelDocument } from './schema'
import { validateFunnel } from './validation'

describe('упрощённая модель 3.0', () => {
  it('добавляет только два понятных логических блока', () => {
    expect(Object.keys(nodeMeta)).toEqual(['start', 'message', 'media', 'timer', 'variable', 'condition', 'test', 'form', 'consent', 'product', 'external_link', 'end'])
    expect(Object.keys(nodeMeta)).not.toEqual(expect.arrayContaining(['formula', 'set_variable', 'random']))
  })

  it('в корне есть простой справочник переменных без формул', () => {
    const document = createEmptyFunnel() as unknown as Record<string, unknown>
    expect(document.variables).toEqual([])
    expect(document.resultSets).toBeUndefined()
    expect(document.testScenarios).toBeUndefined()
    expect(JSON.stringify(document)).not.toContain('FormulaExpression')
  })

  it('демо проходит доменную проверку без ошибок', () => {
    const issues = validateFunnel(freshDemoFunnel())
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([])
  })

  it('новый документ использует major-формат 3.0.0', () => {
    const document = createEmptyFunnel()
    expect(document.schemaVersion).toBe('3.0.0')
    const parsed = parseAndMigrateFunnelDocument(document)
    expect(parsed.success).toBe(true)
  })

  it('автоматически поднимает простой формат 2.0.0 до 3.0.0', () => {
    const old = structuredClone(createEmptyFunnel()) as unknown as Record<string, unknown>
    old.schemaVersion = '2.0.0'
    delete old.variables
    const parsed = parseAndMigrateFunnelDocument(old)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.document.schemaVersion).toBe('3.0.0')
      expect(parsed.document.variables).toEqual([])
      expect(parsed.notices?.[0].message).toContain('2.0.0')
    }
  })

  it('технический код ссылки безопасен для Telegram', () => {
    const document = freshDemoFunnel()
    document.bot.trackingLinks.forEach((link) => expect(link.code).toMatch(/^[a-zA-Z0-9_-]{1,64}$/))
  })
})
