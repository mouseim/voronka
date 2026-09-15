import { describe, expect, it } from 'vitest'
import type { FunnelDocument } from '../src/core/shared'
import { abButtonSnapshot } from '../src/analytics/snapshot'
import { abButtonVariant } from '../src/runtime/engine'

describe('A/B кнопок результата', () => {
  it('стабильно назначает один вариант одному user/version/button', () => {
    const first = abButtonVariant('user-1', 'version-5', 'button-1')
    for (let i = 0; i < 20; i += 1) {
      expect(abButtonVariant('user-1', 'version-5', 'button-1')).toBe(first)
    }
  })

  it('реально распределяет пользователей между A и B', () => {
    const variants = new Set(
      Array.from({ length: 100 }, (_, index) =>
        abButtonVariant(`user-${index}`, 'version-5', 'button-1'),
      ),
    )
    expect(variants).toEqual(new Set(['A', 'B']))
  })

  it('считает показы и клики A/B отдельно и игнорирует обычную кнопку', () => {
    const document = {
      nodes: [{
        id: 'message-1',
        type: 'message',
        data: {
          title: 'Приветствие',
          text: 'Добро пожаловать',
          buttons: [
            { id: 'message-ab', text: 'Начать', abText: 'Поехали', action: 'branch' },
            { id: 'message-normal', text: 'Обычная', action: 'branch' },
          ],
        },
      }],
      tests: [{
        results: [{
          id: 'result-1',
          name: 'Результат 1',
          buttons: [
            { id: 'button-ab', text: 'Получить разбор', abText: 'Узнать подробнее', action: 'branch' },
            { id: 'button-normal', text: 'Обычная кнопка', action: 'branch' },
          ],
        }],
        combinedResults: [],
      }],
    } as unknown as FunnelDocument

    const snapshot = abButtonSnapshot(document, [
      { event_type: 'ab_button_shown', payload: { buttonId: 'button-ab', variant: 'A' }, count: '10' },
      { event_type: 'ab_button_clicked', payload: { buttonId: 'button-ab', variant: 'A' }, count: '3' },
      { event_type: 'ab_button_shown', payload: { buttonId: 'button-ab', variant: 'B' }, count: '12' },
      { event_type: 'ab_button_clicked', payload: { buttonId: 'button-ab', variant: 'B' }, count: '6' },
    ])

    expect(snapshot['button-normal']).toBeUndefined()
    expect(snapshot['message-normal']).toBeUndefined()
    expect(snapshot['message-ab']).toMatchObject({
      buttonId: 'message-ab',
      resultId: 'message-1',
      contextLabel: 'Приветствие',
      A: { text: 'Начать', shown: 0, clicked: 0 },
      B: { text: 'Поехали', shown: 0, clicked: 0 },
    })
    expect(snapshot['button-ab']).toEqual({
      buttonId: 'button-ab',
      resultId: 'result-1',
      contextLabel: 'Результат · Результат 1',
      A: { text: 'Получить разбор', shown: 10, clicked: 3 },
      B: { text: 'Узнать подробнее', shown: 12, clicked: 6 },
    })
  })
})
