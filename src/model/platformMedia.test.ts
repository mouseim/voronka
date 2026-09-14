import { describe, expect, it } from 'vitest'
import { serializeFunnel } from '../services/files'
import { freshDemoFunnel } from './demo'
import { mediaPlatformReadiness, parseVkAttachment } from './platformMedia'
import { parseAndMigrateFunnelDocument } from './schema'
import { validateFunnel } from './validation'

describe('platform-specific media в .funnel 3.0', () => {
  it('импортирует и экспортирует старый Telegram asset без platform fields', () => {
    const legacy = freshDemoFunnel()
    const logicalRef = legacy.assets[0]!.logicalRef

    const imported = parseAndMigrateFunnelDocument(JSON.parse(JSON.stringify(legacy)))

    expect(imported.success).toBe(true)
    if (!imported.success) return
    expect(imported.document.assets[0]).not.toHaveProperty('platformRefs')
    expect(imported.document.assets[0]!.logicalRef).toBe(logicalRef)
    expect(JSON.parse(serializeFunnel(imported.document)).assets[0]).not.toHaveProperty('platformRefs')
  })

  it('использует общий ref без обязательного дублирования для VK', () => {
    const asset = freshDemoFunnel().assets[0]!

    expect(mediaPlatformReadiness(asset)).toEqual({
      telegram: { state: 'ready', label: 'используется общий источник' },
      vk: { state: 'warning', label: 'нужна привязка через /vkmedia' },
    })
    expect(validateFunnel(freshDemoFunnel()).filter((issue) => issue.code.startsWith('vk_'))).toEqual([])
  })

  it('сохраняет Telegram video ref и отдельный VK video ref через export/import', () => {
    const document = freshDemoFunnel()
    document.assets[0] = {
      ...document.assets[0]!,
      type: 'video',
      logicalRef: 'video.mp4',
      platformRefs: { vk: 'video-123456789_987654321_access-key' },
    }

    const imported = parseAndMigrateFunnelDocument(JSON.parse(serializeFunnel(document)))

    expect(imported.success).toBe(true)
    if (!imported.success) return
    expect(imported.document.schemaVersion).toBe('3.0.0')
    expect(imported.document.assets[0]).toMatchObject({
      logicalRef: 'video.mp4',
      platformRefs: { vk: 'video-123456789_987654321_access-key' },
    })
    expect(validateFunnel(imported.document).filter((issue) => issue.severity === 'error')).toEqual([])
  })

  it('разбирает VK attachment с access key', () => {
    expect(parseVkAttachment('https://vk.com/video-10_404_access-key')).toEqual({
      type: 'video',
      ownerId: -10,
      mediaId: 404,
      accessKey: 'access-key',
    })
    expect(parseVkAttachment('https://vkvideo.ru/video-237549211_456239020')).toMatchObject({
      type: 'video',
      ownerId: -237549211,
      mediaId: 456239020,
    })
  })

  it('показывает отдельную VK-ошибку для неверного attachment', () => {
    const document = freshDemoFunnel()
    document.assets[0]!.platformRefs = { vk: 'not-an-attachment' }

    expect(validateFunnel(document)).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', code: 'vk_attachment_invalid', message: expect.stringContaining('VK:') }),
    ]))
  })

  it('отклоняет несовпадающий тип VK attachment, не меняя Telegram ref', () => {
    const document = freshDemoFunnel()
    document.assets[0] = { ...document.assets[0]!, type: 'video', logicalRef: 'video.mp4', platformRefs: { vk: 'photo-10_404' } }

    expect(validateFunnel(document)).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', code: 'vk_attachment_type_mismatch' }),
    ]))
    expect(document.assets[0]!.logicalRef).toBe('video.mp4')
  })

  it('помечает неподдерживаемый VK-тип, не делая Telegram-only asset невалидным', () => {
    const document = freshDemoFunnel()
    document.assets[0] = { ...document.assets[0]!, type: 'animation', logicalRef: 'animation.gif' }

    expect(mediaPlatformReadiness(document.assets[0]!).vk.state).toBe('unsupported')
    expect(validateFunnel(document).filter((issue) => issue.severity === 'error' && issue.code.startsWith('vk_'))).toEqual([])
  })
})
