import { createTemplate, slugify, syncAssets } from '../model/funnel'
import { parseAndMigrateFunnelDocument } from '../model/schema'
import type { FunnelDocument, ImportResult } from '../model/types'
import { validateFunnel } from '../model/validation'

const MAX_IMPORT_BYTES = 50 * 1024 * 1024

export async function importFunnelFile(file: File): Promise<ImportResult> {
  const lower = file.name.toLowerCase()
  if (!lower.endsWith('.funnel') && !lower.endsWith('.json')) return { success: false, errors: ['Файл должен иметь расширение .funnel или .json'] }
  if (file.size > MAX_IMPORT_BYTES) return { success: false, errors: [`Файл слишком большой: максимум ${MAX_IMPORT_BYTES / 1024 / 1024} МБ`] }
  let raw: unknown
  try { raw = JSON.parse(await file.text()) } catch { return { success: false, errors: ['Файл не является корректным UTF-8 JSON'] } }
  const parsed = parseAndMigrateFunnelDocument(raw)
  if (!parsed.success) return parsed
  parsed.issues = validateFunnel(parsed.document)
  if (parsed.analyticsIsolated) parsed.issues.push({ severity: 'warning', section: 'analytics', code: 'analytics_isolated', message: 'Повреждённая статистика изолирована. Структуру можно открыть и исправить.', path: 'analytics' })
  return parsed
}

export function serializeFunnel(document: FunnelDocument): string {
  return JSON.stringify(syncAssets(document), null, 2)
}

export function exportFilename(document: FunnelDocument): string {
  return `${slugify(document.funnel.name)}-v${document.funnel.version}.funnel`
}

export function downloadFunnel(document: FunnelDocument, suffix = ''): void {
  downloadText(serializeFunnel(document), suffix ? `${slugify(document.funnel.name)}-${suffix}.funnel` : exportFilename(document), 'application/json;charset=utf-8')
}

export function downloadTemplate(document: FunnelDocument): void {
  downloadFunnel(createTemplate(document), `template-v${document.funnel.version}`)
}

export function downloadText(content: string, filename: string, type = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = window.document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
