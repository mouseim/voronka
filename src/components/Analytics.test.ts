import { describe, expect, it } from 'vitest'
import { abCtr } from './Analytics'

describe('A/B CTR', () => {
  it('считает CTR', () => {
    expect(abCtr(24, 100)).toBe(24)
    expect(abCtr(31, 200)).toBe(15.5)
  })

  it('при нуле показов возвращает 0', () => {
    expect(abCtr(0, 0)).toBe(0)
    expect(abCtr(5, 0)).toBe(0)
  })
})
