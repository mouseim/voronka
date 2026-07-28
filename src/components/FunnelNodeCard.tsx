import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { BarChart3 } from 'lucide-react'
import { nodeHandles } from '../model/funnel'
import { CONDITION_OPERATOR_LABELS, VARIABLE_OPERATION_LABELS } from '../model/variables'
import type { ConditionData, FunnelDocument, FunnelNode, MediaData, TestBlockData, TimerData, VariableData } from '../model/types'
import { nodeMeta } from './nodeMeta'

export type FunnelCanvasNode = Node<{
  source: FunnelNode
  document: FunnelDocument
  collapsed?: boolean
  analytics?: { entered: number; completed: number; dropped: number; conversion: number }
}, 'funnel'>

export function FunnelNodeCard({ data, selected }: NodeProps<FunnelCanvasNode>) {
  const node = data.source
  const meta = nodeMeta[node.type]
  const Icon = meta.icon
  const handles = nodeHandles(node, data.document)

  return (
    <div className={`funnel-node ${selected ? 'is-selected' : ''} ${data.collapsed ? 'is-collapsed' : ''}`} style={{ '--node-color': meta.color } as React.CSSProperties}>
      {node.type !== 'start' && <Handle type="target" position={Position.Left} className="node-handle" />}
      <div className="funnel-node__header">
        <span className="node-type-icon" style={{ color: meta.color, background: meta.background }}><Icon size={16} /></span>
        <span>{meta.label}</span>
      </div>
      <div className="funnel-node__title">{node.data.title || 'Без названия'}</div>
      {!data.collapsed && handles.length > 1 && (
        <div className="funnel-node__options">
          {handles.map((handle, index) => (
            <div className="funnel-node__option" key={handle.id}>
              <span>{handle.label || `Ветка ${index + 1}`}</span>
              <Handle type="source" position={Position.Right} id={handle.id} className="node-handle option-handle" style={{ top: 91 + index * 30 }} />
            </div>
          ))}
        </div>
      )}
      {!data.collapsed && node.type === 'timer' && <div className="funnel-node__detail">{(node.data as TimerData).duration} {unitShort((node.data as TimerData).unit)}</div>}
      {!data.collapsed && node.type === 'media' && <div className="funnel-node__detail">{data.document.assets.find((asset) => asset.id === (node.data as MediaData).assetId)?.name ?? 'Выберите материал'}</div>}
      {!data.collapsed && node.type === 'test' && <div className="funnel-node__detail">{data.document.tests.find((test) => test.id === (node.data as TestBlockData).testId)?.name ?? 'Выберите тест'}</div>}
      {!data.collapsed && node.type === 'variable' && <div className="funnel-node__detail">{variableSummary(data.document, node.data as VariableData)}</div>}
      {!data.collapsed && node.type === 'condition' && <div className="funnel-node__detail">{conditionSummary(data.document, node.data as ConditionData)}</div>}
      {!data.collapsed && data.analytics && <div className="node-analytics"><BarChart3 size={12} /> {data.analytics.entered} → {data.analytics.completed} · {data.analytics.conversion.toFixed(0)}%</div>}
      {(data.collapsed || handles.length === 1) && handles.length === 1 && <Handle type="source" position={Position.Right} id={handles[0].id} className="node-handle" />}
    </div>
  )
}

function variableSummary(document: FunnelDocument, data: VariableData) {
  if (!data.operations.length) return 'Добавьте действие'
  const first = data.operations[0]
  const variable = document.variables.find((item) => item.id === first.variableId)
  const suffix = data.operations.length > 1 ? ` +${data.operations.length - 1}` : ''
  return variable ? `${variable.name}: ${VARIABLE_OPERATION_LABELS[first.operation]}${suffix}` : 'Выберите переменную'
}

function conditionSummary(document: FunnelDocument, data: ConditionData) {
  const variable = document.variables.find((item) => item.id === data.variableId)
  return variable ? `${variable.name} · ${CONDITION_OPERATOR_LABELS[data.operator]}` : 'Выберите переменную'
}

function unitShort(unit: string) {
  return unit === 'minutes' ? 'мин' : unit === 'hours' ? 'ч' : 'дн'
}
