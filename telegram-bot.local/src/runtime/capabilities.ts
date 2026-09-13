import type { FunnelDocument, MediaData, MessageData, ResultButton } from '../core/shared'
import type { PlatformCapabilities } from '../domain/types'

export const telegramCapabilities: PlatformCapabilities = {
  text: true,
  buttons: true,
  urlButtons: true,
  media: true,
  payments: true,
}

export const vkCapabilities: PlatformCapabilities = {
  text: true,
  buttons: true,
  urlButtons: true,
  media: false,
  payments: false,
}

export function unsupportedReachableCapability(document: FunnelDocument, capabilities: PlatformCapabilities): string | null {
  const reachable = new Set<string>()
  const pending = [document.funnel.startNodeId]
  while (pending.length) {
    const nodeId = pending.pop()!
    if (reachable.has(nodeId)) continue
    reachable.add(nodeId)
    document.edges.filter((edge) => edge.source === nodeId).forEach((edge) => pending.push(edge.target))
  }

  for (const node of document.nodes.filter((item) => reachable.has(item.id))) {
    if (!capabilities.text && node.type !== 'start') return `text:${node.id}`
    if (node.type === 'media' && (node.data as MediaData).required && !capabilities.media) return `media:${node.id}`
    if (node.type === 'product' && !capabilities.payments) return `payments:${node.id}`
    if (node.type === 'external_link' && !capabilities.urlButtons) return `url_buttons:${node.id}`
    if (node.type === 'message') {
      const buttons = (node.data as MessageData).buttons
      if (buttons.length && !capabilities.buttons) return `buttons:${node.id}`
      if (buttons.some((button) => button.action === 'url') && !capabilities.urlButtons) return `url_buttons:${node.id}`
      if (buttons.some((button) => button.action === 'product') && !capabilities.payments) return `payments:${node.id}`
    }
    if (node.type === 'test') {
      const testId = String((node.data as { testId?: string }).testId ?? '')
      const resultButtons = document.tests.find((test) => test.id === testId)?.results.flatMap((result) => result.buttons) ?? []
      const combinedButtons = document.tests.find((test) => test.id === testId)?.combinedResults.flatMap((result) => result.buttons) ?? []
      const buttons: ResultButton[] = [...resultButtons, ...combinedButtons]
      if (buttons.some((button) => button.action === 'url') && !capabilities.urlButtons) return `url_buttons:${node.id}`
      if (buttons.some((button) => button.action === 'product') && !capabilities.payments) return `payments:${node.id}`
    }
  }
  return null
}
