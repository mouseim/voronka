import { describe, expect, it } from 'vitest'
import { freshDemoFunnel } from './demo'
import { validateFunnel } from './validation'
import type { TimerData } from './types'

describe('built-in full demo', () => {
  it('keeps stable identity across fresh copies', () => {
    const first = freshDemoFunnel()
    const second = freshDemoFunnel()

    expect(first.project.id).toBe('project_demo_7_internal_mechanisms')
    expect(first.funnel.id).toBe('funnel_demo_7_internal_mechanisms')
    expect(first.funnel.key).toBe('7_vnutrennih_mehanizmov')
    expect(first.funnel.startNodeId).toBe('start')

    expect(second.project.id).toBe(first.project.id)
    expect(second.funnel.id).toBe(first.funnel.id)
    expect(second.funnel.startNodeId).toBe(first.funnel.startNodeId)
  })

  it('contains the complete Olesya V2.2 demo', () => {
    const document = freshDemoFunnel()
    const test = document.tests[0]

    expect(document.nodes).toHaveLength(125)
    expect(document.edges).toHaveLength(209)

    expect(test?.questions.filter((question) => question.enabled)).toHaveLength(24)
    expect(test?.scales).toHaveLength(7)
    expect(test?.results).toHaveLength(7)
    expect(test?.combinedResults).toHaveLength(10)

    expect(document.assets).toHaveLength(17)
    expect(document.products).toHaveLength(7)

    const backgroundTimers = document.nodes.filter(
      (node) => node.type === 'timer' && Boolean((node.data as TimerData).background),
    )

    expect(backgroundTimers).toHaveLength(2)
    expect(backgroundTimers.map((node) => node.id)).toEqual([
      'timer_day7',
      'timer_day14',
    ])
  })

  it('has no blocking validation errors', () => {
    const errors = validateFunnel(freshDemoFunnel())
      .filter((issue) => issue.severity === 'error')

    expect(errors).toEqual([])
  })
})
