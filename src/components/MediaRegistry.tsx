import { AlertCircle, CheckCircle2, CircleHelp, FileStack } from 'lucide-react'
import { referencedAssetIds } from '../model/funnel'
import type { FunnelAsset, FunnelDocument } from '../model/types'

interface MediaRegistryProps {
  document: FunnelDocument
  onSelect: (nodeId: string) => void
}

const mediaLabels: Record<string, string> = {
  image: 'Изображение', video: 'Видео', audio: 'Аудио', voice: 'Голосовое',
  video_note: 'Видеокружок', document: 'Документ', animation: 'Анимация',
}

export function MediaRegistry({ document, onSelect }: MediaRegistryProps) {
  const referenced = referencedAssetIds(document)
  const keys = document.assets.reduce<Record<string, number>>((result, asset) => {
    if (asset.assetKey.trim()) result[asset.assetKey] = (result[asset.assetKey] ?? 0) + 1
    return result
  }, {})

  const selectAsset = (asset: FunnelAsset) => {
    const node = document.nodes.find((candidate) => candidate.type === 'media' &&
      (candidate.data.assetId === asset.id || candidate.data.assetKey === asset.assetKey))
    if (node) onSelect(node.id)
  }

  return (
    <div className="media-registry">
      <div className="registry-intro"><FileStack size={18} /><p>Реестр описывает логические ссылки на файлы. Физические файлы подключаются при интеграции с Telegram.</p></div>
      {!document.assets.length ? (
        <div className="mini-empty"><CircleHelp size={28} /><strong>Реестр пока пуст</strong><span>Создайте ресурс в разделе «Медиа» и выберите его в блоке.</span></div>
      ) : (
        <div className="registry-list">
          {document.assets.map((asset) => {
            const complete = Boolean(asset.assetKey.trim() && asset.displayName.trim() && asset.expectedType)
            const duplicate = keys[asset.assetKey] > 1
            const unused = !referenced.has(asset.id)
            const problem = duplicate || !complete
            const Icon = problem ? AlertCircle : CheckCircle2
            return (
              <button key={asset.id} className={`registry-row ${problem ? 'has-problem' : ''}`} onClick={() => selectAsset(asset)}>
                <Icon size={17} />
                <span>
                  <strong className="mono">{asset.assetKey || 'assetKey не заполнен'}</strong>
                  <small>{asset.displayName || 'Нет имени'} · {mediaLabels[asset.expectedType] ?? asset.expectedType}{unused ? ' · не используется' : ''}</small>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
