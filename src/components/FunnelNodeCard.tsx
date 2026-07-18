import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { BarChart3 } from 'lucide-react'
import { nodeHandles } from '../model/funnel'
import type { FunnelNode } from '../model/types'
import { nodeMeta } from './nodeMeta'

export type FunnelCanvasNode = Node<{
  source: FunnelNode
  collapsed?: boolean
  analytics?: { entered: number; completed: number; dropped: number; conversion: number }
}, 'funnel'>

export function FunnelNodeCard({ data, selected }: NodeProps<FunnelCanvasNode>) {
  const node = data.source
  const meta = nodeMeta[node.type]
  const Icon = meta.icon
  const handles = nodeHandles(node)
  const showHandles = handles.length > 1 || ['message','choice','question','condition','random','product'].includes(node.type)
  const visualOnly = node.type === 'comment' || node.type === 'group'

  return (
    <div className={`funnel-node ${selected ? 'is-selected' : ''} ${data.collapsed ? 'is-collapsed' : ''}`} style={{ '--node-color': meta.color } as React.CSSProperties}>
      {node.type !== 'start' && !visualOnly && <Handle type="target" position={Position.Left} className="node-handle" />}
      <div className="funnel-node__header">
        <span className="node-type-icon" style={{ color: meta.color, background: meta.background }}><Icon size={16} /></span>
        <span>{meta.label}</span>
        <span className="node-id-dot" title={`ID: ${node.id}`} />
      </div>
      <div className="funnel-node__title">{node.data.title || 'Без названия'}</div>
      {!data.collapsed && showHandles && handles.length > 0 && (
        <div className="funnel-node__options">
          {handles.map((handle, index) => (
            <div className="funnel-node__option" key={handle.id}>
              <span>{handle.label || `Ветка ${index + 1}`}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={handle.id}
                className="node-handle option-handle"
                style={{ top: 91 + index * 30 }}
              />
            </div>
          ))}
        </div>
      )}
      {!data.collapsed && node.type === 'timer' && <div className="funnel-node__detail">{String(node.data.duration)} {unitShort(String(node.data.unit))}</div>}
      {!data.collapsed && node.type === 'media' && <div className="funnel-node__detail mono">{String(node.data.assetKey || 'Ресурс не выбран')}</div>}
      {!data.collapsed && node.type === 'test' && <div className="funnel-node__detail">{String(node.data.testId ? 'Тест выбран' : 'Выберите тест')}</div>}
      {!data.collapsed && node.type === 'product' && <div className="funnel-node__detail">{String(node.data.productId ? 'Продукт выбран' : 'Выберите продукт')}</div>}
      {!data.collapsed && node.type === 'external_link' && <div className="funnel-node__detail mono">{String(node.data.url || 'https://')}</div>}
      {!data.collapsed && node.type === 'comment' && <div className="funnel-node__detail">{String(node.data.text || '')}</div>}
      {!data.collapsed && data.analytics && (
        <div className="node-analytics">
          <BarChart3 size={12} /> {data.analytics.entered} → {data.analytics.completed} · {data.analytics.conversion.toFixed(0)}%
        </div>
      )}
      {(data.collapsed || !showHandles) && handles.length === 1 && <Handle type="source" position={Position.Right} id={handles[0].id} className="node-handle" />}
    </div>
  )
}

function unitShort(unit: string) {
  return unit === 'seconds' ? 'сек' : unit === 'minutes' ? 'мин' : unit === 'hours' ? 'ч' : 'дн'
}
