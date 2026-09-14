import { describe, expect, it } from 'vitest'
import { splitTelegramText, stableShuffle, timerDelayMs } from '../src/core/semantics'
import { applyQuietHours } from '../src/runtime/quiet-hours'
import { toCsv } from '../src/analytics/csv'
import { loadDemo } from './helpers'

describe('runtime utilities', () => {
  it('делит Unicode-текст без потери содержимого', () => {
    const text = `${'🙂'.repeat(3_000)}\n${'абв '.repeat(1_000)}`
    const parts = splitTelegramText(text, 1_000)
    expect(parts.every((part) => Array.from(part).length <= 1_000)).toBe(true)
    expect(parts.join('')).toBe(text)
  })

  it('детерминированно перемешивает и переводит таймеры в миллисекунды', () => {
    expect(stableShuffle([1, 2, 3, 4, 5], 'same')).toEqual(stableShuffle([1, 2, 3, 4, 5], 'same'))
    expect(timerDelayMs({ title: '', duration: 2, unit: 'seconds', respectQuietHours: true })).toBe(2_000)
    expect(timerDelayMs({ title: '', duration: 2, unit: 'hours', respectQuietHours: true })).toBe(7_200_000)
  })

  it('обрабатывает тихие часы с переходом через полночь', async () => {
    const demo = await loadDemo()
    demo.bot.timezone = 'Europe/Moscow'
    demo.bot.quietHours = { enabled: true, from: '22:00', to: '08:00', behavior: 'postpone' }
    const result = applyQuietHours(new Date('2026-07-27T21:30:00.000Z'), demo, true)
    expect(result.disposition).toBe('postponed')
    expect(result.date?.toISOString()).toBe('2026-07-28T05:00:00.000Z')
  })

  it('создаёт Excel-совместимый CSV с BOM, CRLF и escaping', () => {
    const csv = toCsv([{ name: 'Иван, «тест»', note: 'строка 1\nстрока 2', count: 2 }]).toString('utf8')
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('\r\n')
    expect(csv).toContain('"Иван, «тест»"')
    expect(csv).toContain('"строка 1\nстрока 2"')
  })
})
