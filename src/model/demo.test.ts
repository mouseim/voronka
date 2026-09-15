import { describe, expect, it } from 'vitest'
import { freshDemoFunnel } from './demo'

describe('built-in demo identity', () => {
  it('keeps stable identity across fresh copies', () => {
    const first = freshDemoFunnel()
    const second = freshDemoFunnel()

    expect(first.project.id).toBe('project_demo_7_internal_mechanisms')
    expect(first.funnel.id).toBe('funnel_demo_7_internal_mechanisms')
    expect(first.funnel.startNodeId).toBe('start')

    expect(second.project.id).toBe(first.project.id)
    expect(second.funnel.id).toBe(first.funnel.id)
    expect(second.funnel.startNodeId).toBe(first.funnel.startNodeId)
  })
})
