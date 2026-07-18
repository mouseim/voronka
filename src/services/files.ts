import { syncAssets, slugify } from '../model/funnel'
import { parseFunnelDocument } from '../model/schema'
import type { FunnelDocument } from '../model/types'
import { validateFunnel } from '../model/validation'

export async function importFunnelFile(file: File): Promise<{ success: true; document: FunnelDocument } | { success: false; errors: string[] }> {
  if (!file.name.toLowerCase().endsWith('.funnel')) return { success: false, errors: ['Файл должен иметь расширение .funnel'] }
  let raw: unknown
  try {
    raw = JSON.parse(await file.text())
  } catch {
    return { success: false, errors: ['Файл не является корректным UTF-8 JSON'] }
  }
  const parsed = parseFunnelDocument(raw)
  if (!parsed.success) return parsed
  const domainErrors = validateFunnel(parsed.data).filter((issue) => issue.severity === 'error')
  if (domainErrors.length) return { success: false, errors: domainErrors.map((issue) => `${issue.path ? `${issue.path}: ` : ''}${issue.message}`) }
  return { success: true, document: parsed.data }
}

export function serializeFunnel(document: FunnelDocument): string {
  return JSON.stringify(syncAssets(document), null, 2)
}

export function exportFilename(document: FunnelDocument): string {
  return `${slugify(document.funnel.name)}-v${document.funnel.version}.funnel`
}

export function downloadFunnel(document: FunnelDocument): void {
  const blob = new Blob([serializeFunnel(document)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = documentForDownload().createElement('a')
  anchor.href = url
  anchor.download = exportFilename(document)
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function documentForDownload(): Document {
  return window.document
}
