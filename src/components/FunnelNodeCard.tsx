import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { BarChart3 } from 'lucide-react'
import type { ChoiceData, FunnelNode, QuestionData } from '../model/types'
import { nodeMeta } from './nodeMeta'

export type FunnelCanvasNode = Node<{
  source: FunnelNode
  analytics?: { entered: number; completed: number; dropped: number; conversion: number }
}, 'funnel'>

export function FunnelNodeCard({ data, selected }: NodeProps<FunnelCanvasNode>) {
  const node = data.source
  const meta = nodeMeta[node.type]
  const Icon = meta.icon
  const options = node.type === 'choice'
    ? (node.data as ChoiceData).options
    : node.type === 'question'
      ? (node.data as QuestionData).answers
      : []

  return (
    <div className={`funnel-node ${selected ? 'is-selected' : ''}`} style={{ '--node-color': meta.color } as React.CSSProperties}>
      {node.type !== 'start' && <Handle type="target" position={Position.Left} className="node-handle" />}
      <div className="funnel-node__header">
        <span className="node-type-icon" style={{ color: meta.color, background: meta.background }}><Icon size={16} /></span>
        <span>{meta.label}</span>
        <span className="node-id-dot" title={`ID: ${node.id}`} />
      </div>
      <div className="funnel-node__title">{node.data.title || 'Без названия'}</div>
      {options.length > 0 && (
        <div className="funnel-node__options">
          {options.map((option, index) => (
            <div className="funnel-node__option" key={option.id}>
              <span>{option.text || `Вариант ${index + 1}`}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={option.id}
                className="node-handle option-handle"
                style={{ top: 91 + index * 30 }}
              />
            </div>
          ))}
        </div>
      )}
      {node.type === 'timer' && <div className="funnel-node__detail">{String(node.data.duration)} {unitShort(String(node.data.unit))}</div>}
      {node.type === 'media' && <div className="funnel-node__detail mono">{String(node.data.assetKey || 'asset_key')}</div>}
      {data.analytics && (
        <div className="node-analytics">
          <BarChart3 size={12} /> {data.analytics.entered} → {data.analytics.completed} · {data.analytics.conversion.toFixed(0)}%
        </div>
      )}
      {!['choice', 'question', 'end'].includes(node.type) && <Handle type="source" position={Position.Right} id="next" className="node-handle" />}
    </div>
  )
}

function unitShort(unit: string) {
  return unit === 'minutes' ? 'мин' : unit === 'hours' ? 'ч' : 'дн'
}
