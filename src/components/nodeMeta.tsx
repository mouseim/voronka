import {
  BellRing, Boxes, Calculator, CalendarClock, CheckCircle2, CircleDot, Clock3,
  Dices, ExternalLink, FileImage, Flag, GitBranch, HelpCircle, Layers3,
  ListChecks, MessageSquareText, PlayCircle, SendToBack, ShieldCheck, ShoppingBag,
  StickyNote, Trophy, Variable, type LucideIcon,
} from 'lucide-react'
import type { NodeType } from '../model/types'

export interface NodeMeta {
  label: string
  description: string
  category: 'Сообщения' | 'Логика' | 'Данные' | 'Время' | 'Продажи' | 'Служебные'
  icon: LucideIcon
  color: string
  background: string
}

export const nodeMeta: Record<NodeType, NodeMeta> = {
  start: { label:'Старт', description:'Точка входа', category:'Служебные', icon:CircleDot, color:'#137a62', background:'#e8f7f2' },
  message: { label:'Сообщение', description:'Текст и кнопки', category:'Сообщения', icon:MessageSquareText, color:'#3d63dd', background:'#edf2ff' },
  choice: { label:'Выбор', description:'Один или несколько', category:'Сообщения', icon:ListChecks, color:'#8653c7', background:'#f4edff' },
  question: { label:'Вопрос', description:'Поле ввода', category:'Сообщения', icon:HelpCircle, color:'#b15c14', background:'#fff3e5' },
  test: { label:'Тест', description:'Составной тест', category:'Данные', icon:PlayCircle, color:'#6b4bc3', background:'#f1edff' },
  condition: { label:'Условие', description:'И / ИЛИ / НЕ', category:'Логика', icon:GitBranch, color:'#b24c75', background:'#fff0f6' },
  set_variable: { label:'Переменная', description:'Записать значение', category:'Данные', icon:Variable, color:'#277a74', background:'#e8f7f5' },
  formula: { label:'Формула', description:'Безопасный расчёт', category:'Данные', icon:Calculator, color:'#4b69b0', background:'#edf2ff' },
  timer: { label:'Задержка', description:'Секунды — дни', category:'Время', icon:Clock3, color:'#2770a7', background:'#eaf6ff' },
  wait_until: { label:'Ожидание даты', description:'Дата или день недели', category:'Время', icon:CalendarClock, color:'#356a9c', background:'#eaf4ff' },
  reminder: { label:'Напоминание', description:'Фоновое касание', category:'Время', icon:BellRing, color:'#a56720', background:'#fff4e5' },
  media: { label:'Медиа', description:'Логическая ссылка', category:'Сообщения', icon:FileImage, color:'#be4a70', background:'#fff0f5' },
  form: { label:'Форма', description:'Контакт или заявка', category:'Данные', icon:Layers3, color:'#287f8d', background:'#e9f8fa' },
  consent: { label:'Согласие', description:'Обработка данных', category:'Данные', icon:ShieldCheck, color:'#397b5b', background:'#eaf7f0' },
  result: { label:'Результат', description:'Итог теста', category:'Данные', icon:Trophy, color:'#9c6819', background:'#fff5df' },
  product: { label:'Продукт', description:'Будущая оплата', category:'Продажи', icon:ShoppingBag, color:'#a44d38', background:'#fff0eb' },
  external_link: { label:'Внешняя ссылка', description:'Сайт, канал или бот', category:'Продажи', icon:ExternalLink, color:'#4e6ba3', background:'#edf3ff' },
  random: { label:'Распределение', description:'A/B и веса', category:'Логика', icon:Dices, color:'#7d55b2', background:'#f4edff' },
  sub_funnel: { label:'Другая воронка', description:'Внешняя граница', category:'Логика', icon:SendToBack, color:'#536b91', background:'#edf2f8' },
  end: { label:'Завершение', description:'Финальный статус', category:'Служебные', icon:Flag, color:'#5e6673', background:'#f0f2f5' },
  comment: { label:'Комментарий', description:'Не исполняется', category:'Служебные', icon:StickyNote, color:'#947323', background:'#fff8d9' },
  group: { label:'Группа', description:'Рамка участка', category:'Служебные', icon:Boxes, color:'#65719c', background:'#eef0f8' },
}

export const statusIcon = CheckCircle2
