import type {
  FunnelDocument,
  FunnelNode,
  MessageButton,
  MessageData,
  ResultButton,
  TimerData,
} from './shared'

export function outgoingNodeId(document: FunnelDocument, sourceId: string, handle = 'next'): string | null {
  return document.edges.find((edge) => edge.source === sourceId && (edge.sourceHandle ?? 'next') === handle)?.target ?? null
}

export function branchButtons(buttons: Array<MessageButton | ResultButton>) {
  return buttons.filter((button) => button.action === 'branch')
}

export function messageTransitionMode(node: FunnelNode) {
  const branches = branchButtons((node.data as MessageData).buttons)
  return branches.length
    ? { waitsForBranch: true as const, handles: branches.map((button) => button.id) }
    : { waitsForBranch: false as const, handles: ['next'] }
}

export function timerDelayMs(data: TimerData): number {
  const multiplier = data.unit === 'minutes' ? 60_000 : data.unit === 'hours' ? 3_600_000 : 86_400_000
  return Math.max(1, data.duration) * multiplier
}

export function splitTelegramText(value: string, limit = 4096): string[] {
  if (!value.trim()) return []
  const chunks: string[] = []
  let rest = Array.from(value)
  while (rest.length > limit) {
    const minimum = Math.floor(limit * 0.65)
    let cut = limit
    for (let index = limit - 1; index >= minimum; index -= 1) {
      if (rest[index] === '\n' || rest[index] === ' ') {
        cut = index + 1
        break
      }
    }
    chunks.push(rest.slice(0, cut).join(''))
    rest = rest.slice(cut)
  }
  if (rest.length) chunks.push(rest.join(''))
  return chunks
}

export function stableShuffle<T>(items: T[], seed: string): T[] {
  const copy = [...items]
  let state = hashSeed(seed)
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0
    const target = state % (index + 1)
    ;[copy[index], copy[target]] = [copy[target]!, copy[index]!]
  }
  return copy
}

function hashSeed(value: string) {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
