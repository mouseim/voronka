import { Info, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { NodeType } from '../model/types'
import { nodeMeta } from './nodeMeta'

const types = Object.keys(nodeMeta) as NodeType[]
const categoryOrder = ['Сообщения', 'Логика', 'Данные', 'Время', 'Продажи', 'Служебные'] as const

interface BlockLibraryProps {
  onAdd: (type: NodeType) => void
  hasStart: boolean
  className?: string
}

export function BlockLibrary({ onAdd, hasStart, className = '' }: BlockLibraryProps) {
  const [query, setQuery] = useState('')
  const grouped = useMemo(() => categoryOrder.map((category) => ({
    category,
    types: types.filter((type) => nodeMeta[type].category === category && `${nodeMeta[type].label} ${nodeMeta[type].description}`.toLowerCase().includes(query.trim().toLowerCase())),
  })).filter((group) => group.types.length), [query])
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
      <label className="library-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти блок" aria-label="Поиск блока" /></label>
      <div className="library-list">
        {grouped.map((group) => <div className="library-category" key={group.category}><span>{group.category}</span>{group.types.map((type) => {
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
        })}</div>)}
        {!grouped.length && <div className="library-no-results">Блоки не найдены</div>}
      </div>
      <div className="library-tip"><span>Совет</span> Соедините круглые порты блоков, чтобы создать переход.</div>
    </aside>
  )
}
