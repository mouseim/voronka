export function toCsv(rows: Array<Record<string, unknown>>, columns?: string[]): Buffer {
  const headers = columns ?? [...new Set(rows.flatMap((row) => Object.keys(row)))]
  const lines = [
    headers.map(escapeCell).join(','),
    ...rows.map((row) => headers.map((header) => escapeCell(flatten(row[header]))).join(',')),
  ]
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8')
}

function flatten(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function escapeCell(value: unknown) {
  const text = flatten(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
