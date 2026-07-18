import type { FunnelDocument, ValidationIssue } from './types'

export function toCsv(rows: Array<Record<string, unknown>>, columns?: string[]): string {
  const headers = columns ?? Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  const lines = [headers.map(escapeCell).join(';')]
  rows.forEach((row) => lines.push(headers.map((header) => escapeCell(row[header])).join(';')))
  return `\uFEFF${lines.join('\r\n')}`
}

export function contactsCsv(document: FunnelDocument) {
  return toCsv(document.analytics.contacts as Array<Record<string, unknown>>)
}

export function applicationsCsv(document: FunnelDocument) {
  return toCsv(document.analytics.applications as Array<Record<string, unknown>>)
}

export function mediaCsv(document: FunnelDocument) {
  return toCsv(document.assets.map((asset) => ({
    assetKey: asset.assetKey,
    name: asset.displayName,
    type: asset.expectedType,
    required: asset.required ? 'да' : 'нет',
    mime: asset.expectedMimeTypes.join(', '),
    filename: asset.recommendedFilename ?? '',
  })))
}

export function validationReport(document: FunnelDocument, issues: ValidationIssue[]) {
  const lines = [`Проверка: ${document.funnel.name} v${document.funnel.version}`, `Схема: ${document.schemaVersion}`, `Дата: ${new Date().toISOString()}`, '']
  issues.forEach((issue) => lines.push(`[${issue.severity.toUpperCase()}] ${issue.section}: ${issue.message}${issue.path ? ` (${issue.path})` : ''}`))
  if (!issues.length) lines.push('Проблем не найдено. Готово для импорта в будущий бот.')
  return lines.join('\n')
}

function escapeCell(value: unknown) {
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return `"${text.replace(/"/g, '""')}"`
}
