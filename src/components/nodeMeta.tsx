import {
  Braces,
  CircleDot,
  Clock3,
  ExternalLink,
  FileImage,
  Flag,
  FormInput,
  GitBranch,
  MessageSquareText,
  PlayCircle,
  ShieldCheck,
  ShoppingBag,
  type LucideIcon,
} from 'lucide-react'
import type { NodeType } from '../model/types'

export interface NodeMeta {
  label: string
  description: string
  category: 'Основные' | 'Логика' | 'Данные и продажи'
  icon: LucideIcon
  color: string
  background: string
}

export const nodeMeta: Record<NodeType, NodeMeta> = {
  start: { label: 'Старт', description: 'Точка входа', category: 'Основные', icon: CircleDot, color: '#137a62', background: '#e8f7f2' },
  message: { label: 'Сообщение', description: 'Текст, кнопки и ветки', category: 'Основные', icon: MessageSquareText, color: '#3d63dd', background: '#edf2ff' },
  media: { label: 'Медиа', description: 'Фото, видео или документ', category: 'Основные', icon: FileImage, color: '#be4a70', background: '#fff0f5' },
  timer: { label: 'Пауза', description: 'Продолжить позже', category: 'Основные', icon: Clock3, color: '#2770a7', background: '#eaf6ff' },
  variable: { label: 'Переменные', description: 'Присвоить или изменить', category: 'Логика', icon: Braces, color: '#7651c9', background: '#f2edff' },
  condition: { label: 'Условие', description: 'Разделить на «Да» и «Нет»', category: 'Логика', icon: GitBranch, color: '#a15c20', background: '#fff3e7' },
  test: { label: 'Тест', description: 'Вопросы и результаты', category: 'Данные и продажи', icon: PlayCircle, color: '#6b4bc3', background: '#f1edff' },
  form: { label: 'Форма', description: 'Контакт или заявка', category: 'Данные и продажи', icon: FormInput, color: '#287f8d', background: '#e9f8fa' },
  consent: { label: 'Согласие', description: 'Принять или отказаться', category: 'Данные и продажи', icon: ShieldCheck, color: '#397b5b', background: '#eaf7f0' },
  product: { label: 'Продукт', description: 'Предложение и оплата', category: 'Данные и продажи', icon: ShoppingBag, color: '#a44d38', background: '#fff0eb' },
  external_link: { label: 'Внешняя ссылка', description: 'Сайт, канал или бот', category: 'Основные', icon: ExternalLink, color: '#4e6ba3', background: '#edf3ff' },
  end: { label: 'Завершение', description: 'Финальный текст', category: 'Основные', icon: Flag, color: '#5e6673', background: '#f0f2f5' },
}
