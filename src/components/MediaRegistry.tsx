import { AlertCircle, CheckCircle2, CircleHelp, FileStack } from 'lucide-react'
import type { FunnelDocument, MediaData } from '../model/types'

interface MediaRegistryProps {
  document: FunnelDocument
  onSelect: (nodeId: string) => void
}

const mediaLabels: Record<string, string> = { image: 'Изображение', video: 'Видео', audio: 'Аудио', voice: 'Голосовое', video_note: 'Видеокружок', document: 'Документ' }

export function MediaRegistry({ document, onSelect }: MediaRegistryProps) {
  const mediaNodes = document.nodes.filter((node) => node.type === 'media')
  const counts = mediaNodes.reduce<Record<string, number>>((result, node) => {
    const key = (node.data as MediaData).assetKey.trim()
    if (key) result[key] = (result[key] ?? 0) + 1
    return result
  }, {})

  return (
    <div className="media-registry">
      <div className="registry-intro"><FileStack size={18} /><p>Здесь перечислены логические ссылки. Сами файлы будут добавлены позднее в Telegram-боте.</p></div>
      {!mediaNodes.length ? (
        <div className="mini-empty"><CircleHelp size={28} /><strong>Медиа пока нет</strong><span>Добавьте блок «Медиа» на полотно.</span></div>
      ) : (
        <div className="registry-list">
          {mediaNodes.map((node) => {
            const data = node.data as MediaData
            const complete = Boolean(data.assetKey.trim() && data.displayName.trim())
            const duplicate = Boolean(data.assetKey && counts[data.assetKey] > 1)
            const Icon = duplicate || !complete ? AlertCircle : CheckCircle2
            return (
              <button key={node.id} className={`registry-row ${duplicate || !complete ? 'has-problem' : ''}`} onClick={() => onSelect(node.id)}>
                <Icon size={17} />
                <span><strong className="mono">{data.assetKey || 'assetKey не заполнен'}</strong><small>{data.displayName || 'Нет отображаемого имени'} · {mediaLabels[data.expectedType]}</small></span>
              </button>
            )
          })}
          {document.assets.filter((asset) => asset.nodeId && !document.nodes.some((node) => node.id === asset.nodeId)).map((asset) => (
            <div className="registry-row has-problem" key={`orphan-${asset.assetKey}`}><AlertCircle size={17} /><span><strong className="mono">{asset.assetKey}</strong><small>Ссылка не связана с существующим блоком</small></span></div>
          ))}
        </div>
      )}
    </div>
  )
}
