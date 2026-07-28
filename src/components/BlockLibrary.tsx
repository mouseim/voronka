import { Info } from 'lucide-react'
import type { NodeType } from '../model/types'
import { nodeMeta } from './nodeMeta'

const types = Object.keys(nodeMeta) as NodeType[]
const categories = ['Основные', 'Логика', 'Данные и продажи'] as const

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
      <p className="side-panel__hint">Добавьте этап и соедините круглые выходы стрелками.</p>
      <div className="library-list">
        {categories.map((category) => (
          <div className="library-category" key={category}>
            <span>{category}</span>
            {types.filter((type) => nodeMeta[type].category === category).map((type) => {
              const meta = nodeMeta[type]
              const Icon = meta.icon
              const disabled = type === 'start' && hasStart
              return (
                <button className="library-item" key={type} disabled={disabled} draggable={!disabled} onDragStart={(event) => startDrag(event, type)} onClick={() => onAdd(type)}>
                  <span className="library-item__icon" style={{ color: meta.color, background: meta.background }}><Icon size={18} /></span>
                  <span><strong>{meta.label}</strong><small>{disabled ? 'Уже добавлен' : meta.description}</small></span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <div className="library-tip"><span>Подсказка</span> Переменные меняют данные, а условие ведёт по ветке «Да» или «Нет».</div>
    </aside>
  )
}
