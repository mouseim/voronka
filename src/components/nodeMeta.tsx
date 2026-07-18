import { CircleCheck, CircleDot, Clock3, FileImage, Flag, HelpCircle, ListChecks, MessageSquareText, type LucideIcon } from 'lucide-react'
import type { NodeType } from '../model/types'

export interface NodeMeta {
  label: string
  description: string
  icon: LucideIcon
  color: string
  background: string
}

export const nodeMeta: Record<NodeType, NodeMeta> = {
  start: { label: 'Старт', description: 'Точка входа', icon: CircleDot, color: '#137a62', background: '#e8f7f2' },
  message: { label: 'Сообщение', description: 'Текст и кнопка', icon: MessageSquareText, color: '#3d63dd', background: '#edf2ff' },
  choice: { label: 'Выбор', description: 'До 8 кнопок', icon: ListChecks, color: '#8653c7', background: '#f4edff' },
  question: { label: 'Вопрос', description: 'Ответы и баллы', icon: HelpCircle, color: '#b15c14', background: '#fff3e5' },
  timer: { label: 'Задержка', description: 'Минуты, часы, дни', icon: Clock3, color: '#2770a7', background: '#eaf6ff' },
  media: { label: 'Медиа', description: 'Логическая ссылка', icon: FileImage, color: '#be4a70', background: '#fff0f5' },
  end: { label: 'Завершение', description: 'Финальный текст', icon: Flag, color: '#5e6673', background: '#f0f2f5' },
}

export const statusIcon = CircleCheck
