const DEFAULT_MAX_BYTES = 50 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 30_000

export async function uploadVkMultipart(
  uploadUrl: string,
  fieldName: 'photo' | 'file',
  content: Buffer,
  filename: string,
  mimeType = 'application/octet-stream',
  options: { fetcher?: typeof fetch; timeoutMs?: number; maxBytes?: number } = {},
): Promise<Record<string, unknown>> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  if (!content.length) throw new Error('VK_UPLOAD_EMPTY_FILE')
  if (content.length > maxBytes) throw new Error(`VK_UPLOAD_FILE_TOO_LARGE:${content.length}:${maxBytes}`)
  let parsedUrl: URL
  try {
    parsedUrl = new URL(uploadUrl)
  } catch {
    throw new Error('VK_UPLOAD_INVALID_URL')
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('VK_UPLOAD_INVALID_URL')

  const body = new FormData()
  body.append(fieldName, new Blob([content], { type: mimeType }), filename)
  let response: Response
  try {
    response = await (options.fetcher ?? fetch)(parsedUrl, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
  } catch (error) {
    const category = error instanceof Error && error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK'
    throw new Error(`VK_UPLOAD_${category}_ERROR`)
  }
  if (!response.ok) throw new Error(`VK_UPLOAD_HTTP_ERROR:${response.status}`)
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('VK_UPLOAD_INVALID_JSON')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('VK_UPLOAD_INVALID_RESPONSE')
  return payload as Record<string, unknown>
}
