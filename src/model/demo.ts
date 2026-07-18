import type { FunnelDocument } from './types'

export const demoFunnel: FunnelDocument = {
  documentType: 'funnel',
  schemaVersion: '0.1.0',
  project: {
    id: 'project_demo_diagnostic',
    name: 'Демонстрационная диагностика',
    description: 'Пример воронки со всеми семью типами блоков',
  },
  funnel: {
    id: 'funnel_demo_diagnostic',
    name: 'Диагностика продукта',
    version: 1,
    status: 'draft',
    startNodeId: 'demo_start',
    createdAt: '2026-07-18T09:00:00.000Z',
    updatedAt: '2026-07-18T12:30:00.000Z',
  },
  nodes: [
    { id: 'demo_start', type: 'start', position: { x: 80, y: 350 }, data: { title: 'Старт', note: 'Точка входа из Telegram' } },
    { id: 'demo_welcome', type: 'message', position: { x: 340, y: 350 }, data: { title: 'Приветствие', text: 'Здравствуйте! Ответьте на один вопрос, и мы подберём полезный материал.', note: 'Первое сообщение', continueEnabled: true, buttonText: 'Продолжить' } },
    { id: 'demo_choice', type: 'choice', position: { x: 600, y: 330 }, data: { title: 'Готовность', prompt: 'Хотите пройти короткую диагностику?', options: [{ id: 'choice_test', text: 'Пройти тест' }, { id: 'choice_exit', text: 'Уйти' }] } },
    { id: 'demo_question', type: 'question', position: { x: 860, y: 170 }, data: { title: 'Главный вопрос', question: 'Что сейчас важнее всего для вашего проекта?', answers: [{ id: 'answer_sales', text: 'Больше продаж', scores: { sales: 3, growth: 1 } }, { id: 'answer_process', text: 'Навести порядок', scores: { systems: 3 } }, { id: 'answer_launch', text: 'Запустить новый продукт', scores: { growth: 3, sales: 1 } }] } },
    { id: 'demo_timer', type: 'timer', position: { x: 860, y: 0 }, data: { title: 'Пауза перед подарком', duration: 24, unit: 'hours', note: 'Материал отправится на следующий день' } },
    { id: 'demo_media', type: 'media', position: { x: 600, y: 0 }, data: { title: 'Голосовой разбор', assetKey: 'gift_day_1_voice', displayName: 'Голосовое первого дня', expectedType: 'voice', caption: 'Ваш персональный разбор уже готов', required: true } },
    { id: 'demo_end', type: 'end', position: { x: 340, y: 0 }, data: { title: 'Успешное завершение', text: 'Спасибо! Если захотите обсудить результат, просто ответьте на это сообщение.', note: 'Основной финал' } },
    { id: 'demo_early_end', type: 'end', position: { x: 600, y: 510 }, data: { title: 'Раннее завершение', text: 'Хорошо. Возвращайтесь, когда будет удобно!', note: 'Выход без диагностики' } },
  ],
  edges: [
    { id: 'edge_start_welcome', source: 'demo_start', target: 'demo_welcome', sourceHandle: 'next' },
    { id: 'edge_welcome_choice', source: 'demo_welcome', target: 'demo_choice', sourceHandle: 'next' },
    { id: 'edge_choice_test', source: 'demo_choice', target: 'demo_question', sourceHandle: 'choice_test', label: 'Пройти тест' },
    { id: 'edge_choice_exit', source: 'demo_choice', target: 'demo_early_end', sourceHandle: 'choice_exit', label: 'Уйти' },
    { id: 'edge_answer_sales', source: 'demo_question', target: 'demo_timer', sourceHandle: 'answer_sales', label: 'Больше продаж' },
    { id: 'edge_answer_process', source: 'demo_question', target: 'demo_timer', sourceHandle: 'answer_process', label: 'Навести порядок' },
    { id: 'edge_answer_launch', source: 'demo_question', target: 'demo_timer', sourceHandle: 'answer_launch', label: 'Запустить продукт' },
    { id: 'edge_timer_media', source: 'demo_timer', target: 'demo_media', sourceHandle: 'next' },
    { id: 'edge_media_end', source: 'demo_media', target: 'demo_end', sourceHandle: 'next' },
  ],
  assets: [{ assetKey: 'gift_day_1_voice', displayName: 'Голосовое первого дня', expectedType: 'voice', required: true, nodeId: 'demo_media' }],
  analytics: {
    snapshotAt: '2026-07-18T12:30:00.000Z',
    funnelVersion: 1,
    summary: { totalUsers: 128, started: 120, completed: 63 },
    nodes: {
      demo_start: { entered: 128, completed: 120, dropped: 8 },
      demo_welcome: { entered: 120, completed: 112, dropped: 8 },
      demo_choice: { entered: 112, completed: 105, dropped: 7 },
      demo_question: { entered: 89, completed: 78, dropped: 11 },
      demo_timer: { entered: 78, completed: 71, dropped: 7 },
      demo_media: { entered: 71, completed: 63, dropped: 8 },
      demo_end: { entered: 63, completed: 63, dropped: 0 },
      demo_early_end: { entered: 16, completed: 16, dropped: 0 },
    },
    edges: {
      edge_start_welcome: { transitions: 120 },
      edge_welcome_choice: { transitions: 112 },
      edge_choice_test: { transitions: 89 },
      edge_choice_exit: { transitions: 16 },
      edge_answer_sales: { transitions: 35 },
      edge_answer_process: { transitions: 27 },
      edge_answer_launch: { transitions: 16 },
      edge_timer_media: { transitions: 71 },
      edge_media_end: { transitions: 63 },
    },
    questions: { demo_question: { answer_sales: 35, answer_process: 27, answer_launch: 16 } },
    contacts: [
      { id: 'contact_001', name: 'Анна К.', username: '@anna_demo', email: 'anna@example.test', createdAt: '2026-07-17T10:15:00.000Z' },
      { id: 'contact_002', name: 'Михаил П.', username: '@mikhail_demo', createdAt: '2026-07-18T08:40:00.000Z' },
      { id: 'contact_003', name: 'Елена С.', phone: '+7 900 000-00-00', createdAt: '2026-07-18T11:05:00.000Z' },
    ],
    applications: [
      { id: 'application_001', contactId: 'contact_001', status: 'Новая', createdAt: '2026-07-17T10:24:00.000Z', comment: 'Интерес к консультации' },
      { id: 'application_002', contactId: 'contact_003', status: 'В работе', createdAt: '2026-07-18T11:18:00.000Z', comment: 'Нужен разбор запуска' },
    ],
  },
}

export function freshDemoFunnel(): FunnelDocument {
  const copy = structuredClone(demoFunnel)
  const now = new Date().toISOString()
  copy.project.id = `project_${crypto.randomUUID()}`
  copy.funnel.id = `funnel_${crypto.randomUUID()}`
  copy.funnel.createdAt = now
  copy.funnel.updatedAt = now
  return copy
}
