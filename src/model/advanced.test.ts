import { describe, expect, it } from 'vitest'
import { nodeMeta } from '../components/nodeMeta'
import { freshDemoFunnel } from './demo'
import { createEmptyFunnel } from './funnel'
import { parseAndMigrateFunnelDocument } from './schema'
import { validateFunnel } from './validation'

describe('упрощённая модель 2.0', () => {
  it('библиотека содержит только 10 понятных типов', () => {
    expect(Object.keys(nodeMeta)).toEqual(['start', 'message', 'media', 'timer', 'test', 'form', 'consent', 'product', 'external_link', 'end'])
    expect(Object.keys(nodeMeta)).not.toEqual(expect.arrayContaining(['condition', 'formula', 'set_variable', 'random']))
  })

  it('в корне файла нет переменных, формул и наборов сложных условий', () => {
    const document = createEmptyFunnel() as unknown as Record<string, unknown>
    expect(document.variables).toBeUndefined()
    expect(document.resultSets).toBeUndefined()
    expect(document.testScenarios).toBeUndefined()
    expect(JSON.stringify(document)).not.toContain('FormulaExpression')
  })

  it('демо проходит доменную проверку без ошибок', () => {
    const issues = validateFunnel(freshDemoFunnel())
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([])
  })

  it('новый документ использует major-формат 2.0.0', () => {
    const document = createEmptyFunnel()
    expect(document.schemaVersion).toBe('2.0.0')
    const parsed = parseAndMigrateFunnelDocument(document)
    expect(parsed.success).toBe(true)
  })

  it('технический код ссылки безопасен для Telegram', () => {
    const document = freshDemoFunnel()
    document.bot.trackingLinks.forEach((link) => expect(link.code).toMatch(/^[a-zA-Z0-9_-]{1,64}$/))
  })
})
