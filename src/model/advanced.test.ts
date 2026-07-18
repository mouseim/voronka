import { describe, expect, it } from 'vitest'
import { toCsv } from './csv'
import { demoFunnel } from './demo'
import { compareFunnels } from './diff'
import { applyVariableActions, evaluateOperator } from './expressions'
import { createEmptyFunnel, createNode, createTemplate, nodeHandles } from './funnel'
import { parseAndMigrateFunnelDocument } from './schema'
import { calculateTestResult } from './scoring'
import { createSimulatorState, performSimulationAction } from './simulator'
import type { ProductBlockData, RandomData } from './types'
import { validateFunnel } from './validation'

describe('совместимость и версии', () => {
  it('повторная миграция документа 1.0 идемпотентна', () => {
    const first = parseAndMigrateFunnelDocument(structuredClone(demoFunnel))
    expect(first.success).toBe(true)
    if (!first.success) return
    const second = parseAndMigrateFunnelDocument(structuredClone(first.document))
    expect(second.success).toBe(true)
    if (second.success) {
      expect(second.migration).toBeUndefined()
      expect(second.document).toEqual(first.document)
    }
  })

  it('отказывает неизвестной major-версии', () => {
    const source = structuredClone(demoFunnel) as unknown as Record<string, unknown>
    source.schemaVersion = '2.0.0'
    const result = parseAndMigrateFunnelDocument(source)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.errors.join(' ')).toContain('2.0.0')
  })

  it('шаблон очищает статистику и персональные записи', () => {
    const template = createTemplate(demoFunnel)
    expect(template.analytics.snapshotAt).toBeNull()
    expect(template.analytics.contacts).toEqual([])
    expect(template.analytics.applications).toEqual([])
    expect(demoFunnel.analytics.contacts.length).toBeGreaterThan(0)
  })

  it('diff сопоставляет сущности по ID', () => {
    const next = structuredClone(demoFunnel)
    next.nodes[0].data.title = 'Переименованный старт'
    next.variables.push({ id: 'var_diff', key: 'diff', name: 'Diff', type: 'string', description: '', defaultValue: '', scope: 'session', sensitive: false, transferable: true, printable: false })
    const diff = compareFunnels(demoFunnel, next)
    expect(diff.sections.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'demo_start', status: 'changed' })]))
    expect(diff.sections.variables).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'var_diff', status: 'added' })]))
  })
})

describe('операторы и переменные', () => {
  it('поддерживает разрешённые строковые, списочные и диапазонные операторы', () => {
    expect(evaluateOperator('contains', 'воронка', 'рон')).toBe(true)
    expect(evaluateOperator('not_contains', ['a', 'b'], 'c')).toBe(true)
    expect(evaluateOperator('starts_with', 'telegram', 'tele')).toBe(true)
    expect(evaluateOperator('ends_with', 'report.pdf', '.pdf')).toBe(true)
    expect(evaluateOperator('in', 'a', ['a', 'b'])).toBe(true)
    expect(evaluateOperator('not_in', 'c', ['a', 'b'])).toBe(true)
    expect(evaluateOperator('number_between', 5, 1, 10)).toBe(true)
    expect(evaluateOperator('date_between', '2026-02-01', '2026-01-01', '2026-03-01')).toBe(true)
    expect(evaluateOperator('product_paid', 'paid')).toBe(true)
    expect(evaluateOperator('source_is', 'reels', 'reels')).toBe(true)
  })

  it('добавляет и удаляет значения списков', () => {
    const actions = [
      { id: 'add', type: 'list_add' as const, variableKey: 'tags', value: 'new' },
      { id: 'remove', type: 'list_remove' as const, variableKey: 'tags', value: 'old' },
    ]
    expect(applyVariableActions(actions, { tags: ['old'] }).values.tags).toEqual(['new'])
  })

  it('находит неизвестную переменную и безусловный цикл', () => {
    const document = createEmptyFunnel('Цикл')
    const action = createNode('set_variable'); action.id = 'cycle_action'
    ;(action.data as import('./types').SetVariableData).actions[0].variableKey = 'missing_key'
    document.nodes.push(action); document.editor.nodePositions[action.id] = { x: 300, y: 100 }
    document.edges = [
      { id: 'cycle_edge_1', source: document.funnel.startNodeId, target: action.id, sourceHandle: 'next' },
      { id: 'cycle_edge_2', source: action.id, target: action.id, sourceHandle: 'next' },
    ]
    const issues = validateFunnel(document)
    expect(issues.some((issue) => issue.code === 'unknown_variable')).toBe(true)
    expect(issues.some((issue) => issue.code === 'unconditional_cycle')).toBe(true)
  })
})

describe('расширенный scoring и simulator', () => {
  it('выбирает комбинированный результат по настраиваемому порогу', () => {
    const test = structuredClone(demoFunnel.tests[0])
    test.questions.forEach((question) => question.answers[0].scoring.push({ id: `extra_${question.id}`, type: 'add', scaleId: 'scale_recognition', value: 1 }))
    const answers = Object.fromEntries(test.questions.map((question) => [question.id, question.answers[0].id]))
    const result = calculateTestResult(test, demoFunnel.resultSets[0], answers)
    expect(result.result?.code).toBe('S1_S2')
    expect(result.matchedRule?.closenessPoints).toBe(8)
  })

  it('игнорирует выключенный вопрос при динамическом расчёте', () => {
    const test = structuredClone(demoFunnel.tests[0])
    test.questions[0].enabled = false
    const answers = Object.fromEntries(test.questions.map((question) => [question.id, question.answers[0].id]))
    const result = calculateTestResult(test, demoFunnel.resultSets[0], answers)
    expect(result.scores.scale_control.raw).toBe(6)
    expect(result.scores.scale_control.maximum).toBe(6)
  })

  it('случайная ветка воспроизводится по seed', () => {
    const document = createEmptyFunnel('Random')
    const random = createNode('random'); random.id = 'random_node'
    const data = random.data as RandomData
    data.branches = [{ id: 'random_a', name: 'A', weight: 30 }, { id: 'random_b', name: 'B', weight: 70 }]
    const endA = createNode('end'); endA.id = 'end_a'
    const endB = createNode('end'); endB.id = 'end_b'
    document.nodes.push(random, endA, endB)
    document.edges = [
      { id: 'random_start', source: document.funnel.startNodeId, target: random.id, sourceHandle: 'next' },
      { id: 'random_edge_a', source: random.id, target: endA.id, sourceHandle: 'random_a' },
      { id: 'random_edge_b', source: random.id, target: endB.id, sourceHandle: 'random_b' },
    ]
    const run = () => performSimulationAction(document, createSimulatorState(document, { id: 's', name: 's', systemValues: {}, answers: {}, paymentOutcomes: {}, seed: 'fixed', expectedVariables: {} }))
    expect(run().currentNodeId).toBe(run().currentNodeId)
    expect(run().status).toBe('completed')
  })

  it('симулирует успешную и неуспешную оплату без провайдера', () => {
    const document = createEmptyFunnel('Payment')
    document.products = [{ id: 'product', productKey: 'product', name: 'Product', description: '', type: 'digital', priceMinor: 10000, currency: 'RUB', active: true, provider: 'yookassa', assetIds: [], personalization: [], successText: '', repurchasePolicy: 'deny', analytics: {} }]
    const product = createNode('product'); product.id = 'product_node'; (product.data as ProductBlockData).productId = 'product'
    const success = createNode('end'); success.id = 'payment_success'
    const failure = createNode('end'); failure.id = 'payment_failure'
    document.nodes.push(product, success, failure)
    document.edges.push({ id: 'payment_start', source: document.funnel.startNodeId, target: product.id, sourceHandle: 'next' })
    nodeHandles(product).forEach((handle) => document.edges.push({ id: `payment_${handle.id}`, source: product.id, target: handle.id === 'success' || handle.id === 'already_purchased' ? success.id : failure.id, sourceHandle: handle.id }))
    let state = performSimulationAction(document, createSimulatorState(document))
    state = performSimulationAction(document, state, { paymentOutcome: 'success' })
    expect(state.currentNodeId).toBe(success.id)
    expect(state.values['payment.status']).toBe('paid')
    let failed = performSimulationAction(document, createSimulatorState(document))
    failed = performSimulationAction(document, failed, { paymentOutcome: 'failure' })
    expect(failed.currentNodeId).toBe(failure.id)
    expect(failed.values['payment.status']).toBe('failure')
  })
})

describe('CSV', () => {
  it('добавляет BOM и экранирует кавычки, разделители и переносы', () => {
    const csv = toCsv([{ name: 'Анна; "A"', note: 'строка\nдве' }])
    expect(csv.charCodeAt(0)).toBe(0xFEFF)
    expect(csv).toContain('"Анна; ""A"""')
    expect(csv).toContain('"строка\nдве"')
  })
})
