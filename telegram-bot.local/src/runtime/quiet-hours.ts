import { DateTime } from 'luxon'
import type { FunnelDocument } from '../core/shared'

export function applyQuietHours(
  date: Date,
  document: FunnelDocument,
  enabledForAction: boolean,
): { date: Date | null; disposition: 'unchanged' | 'postponed' | 'skipped' } {
  const settings = document.bot.quietHours
  if (!enabledForAction || !settings.enabled) return { date, disposition: 'unchanged' }
  const zone = document.bot.timezone || 'Europe/Moscow'
  const local = DateTime.fromJSDate(date, { zone })
  if (!local.isValid) return { date, disposition: 'unchanged' }
  const from = parseClock(settings.from)
  const to = parseClock(settings.to)
  if (!from || !to) return { date, disposition: 'unchanged' }
  const minutes = local.hour * 60 + local.minute
  const crossesMidnight = from.minutes >= to.minutes
  const inside = crossesMidnight
    ? minutes >= from.minutes || minutes < to.minutes
    : minutes >= from.minutes && minutes < to.minutes
  if (!inside) return { date, disposition: 'unchanged' }
  if (settings.behavior === 'skip') return { date: null, disposition: 'skipped' }
  const shouldUseNextDay = crossesMidnight && minutes >= from.minutes
  const resumed = local
    .plus({ days: shouldUseNextDay ? 1 : 0 })
    .set({ hour: to.hour, minute: to.minute, second: 0, millisecond: 0 })
  return { date: resumed.toUTC().toJSDate(), disposition: 'postponed' }
}

function parseClock(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute, minutes: hour * 60 + minute }
}
