import { Info } from 'lucide-react'
import type { NodeType } from '../model/types'
import { nodeMeta } from './nodeMeta'

const types: NodeType[] = ['start', 'message', 'choice', 'question', 'timer', 'media', 'end']

interface BlockLibraryProps {
  onAdd: (type: NodeType) => void
  hasStart: boolean
  className?: string
}

export function BlockLibrary({ onAdd, hasStart, className = '' }: BlockLibraryProps) {
  const startDrag = (event: React.DragEvent, type: NodeType) => {
    event.dataTransfer.setData('application/funnel-node', type)
    event.dataTransfer.effectAllowed = 'move'
  }
  return (
    <aside className={`side-panel block-library ${className}`}>
      <div className="side-panel__heading">
        <div><span className="eyebrow">Конструктор</span><h2>Блоки</h2></div>
        <span className="tooltip" title="Перетащите блок на полотно или добавьте кликом"><Info size={16} /></span>
      </div>
      <p className="side-panel__hint">Перетащите на полотно или нажмите, чтобы добавить.</p>
      <div className="library-list">
        {types.map((type) => {
          const meta = nodeMeta[type]
          const Icon = meta.icon
          const disabled = type === 'start' && hasStart
          return (
            <button
              className="library-item"
              key={type}
              disabled={disabled}
              draggable={!disabled}
              onDragStart={(event) => startDrag(event, type)}
              onClick={() => onAdd(type)}
              title={disabled ? 'В воронке уже есть стартовый блок' : `Добавить: ${meta.label}`}
            >
              <span className="library-item__icon" style={{ color: meta.color, background: meta.background }}><Icon size={18} /></span>
              <span><strong>{meta.label}</strong><small>{disabled ? 'Уже добавлен' : meta.description}</small></span>
            </button>
          )
        })}
      </div>
      <div className="library-tip"><span>Совет</span> Соедините круглые порты блоков, чтобы создать переход.</div>
    </aside>
  )
}
