import fullDemo from './olesya-full-demo.json'
import type { FunnelDocument } from './types'

const demoTemplate = fullDemo as unknown as FunnelDocument

/**
 * Полноценная встроенная демо-воронка по ТЗ Олеси V2.2.
 *
 * Сам контент хранится как обычный FunnelDocument в JSON,
 * поэтому демо использует ровно тот же формат, что импорт/экспорт .funnel.
 *
 * Identity старого встроенного демо сохраняем специально:
 * публикация обновляет существующую demo-воронку, а не создаёт новую.
 */
export function freshDemoFunnel(): FunnelDocument {
  const document = structuredClone(demoTemplate)

  document.project.id = 'project_demo_7_internal_mechanisms'
  document.funnel.id = 'funnel_demo_7_internal_mechanisms'
  document.funnel.key = '7_vnutrennih_mehanizmov'

  document.funnel.status = 'draft'
  document.analytics.funnelVersion = document.funnel.version

  return document
}
