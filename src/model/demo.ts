import { createEmptyFunnel, emptyAnalytics } from './funnel'
import type { FunnelDocument, FunnelNode, FunnelTest, MediaAsset, Product } from './types'

const scaleDefinitions = [
  ['scale_s1', 'S1', 'Быть нужной', '#7c5ce7'],
  ['scale_s2', 'S2', 'Контроль', '#2f80ed'],
  ['scale_s3', 'S3', 'Достижения', '#f2994a'],
  ['scale_s4', 'S4', 'Безопасность', '#27ae60'],
  ['scale_s5', 'S5', 'Признание', '#eb5757'],
  ['scale_s6', 'S6', 'Свобода', '#00a6a6'],
  ['scale_s7', 'S7', 'Близость', '#b35bd4'],
] as const

function node(id: string, type: FunnelNode['type'], data: FunnelNode['data']): FunnelNode {
  return { id, type, data }
}

function buildTest(): FunnelTest {
  const scales = scaleDefinitions.map(([id, code, name, color]) => ({ id, code, name, color }))
  const questions = Array.from({ length: 7 }, (_, questionIndex) => ({
    id: `question_${questionIndex + 1}`,
    text: [
      'Что вам важнее всего в сложной ситуации?',
      'Как вы принимаете важные решения?',
      'Что сильнее всего мотивирует вас двигаться дальше?',
      'Как вы реагируете на неопределённость?',
      'Чего вы ждёте от окружающих?',
      'Какая среда помогает вам раскрыться?',
      'Что для вас означает хороший результат?',
    ][questionIndex],
    type: 'single' as const,
    enabled: true,
    required: true,
    shuffleAnswers: false,
    answers: scales.map((scale, answerIndex) => ({
      id: `answer_${questionIndex + 1}_${answerIndex + 1}`,
      text: [
        'Помочь и быть полезной',
        'Понять и взять ситуацию под контроль',
        'Поставить цель и достичь её',
        'Создать надёжный план',
        'Получить признание результата',
        'Сохранить свободу выбора',
        'Остаться в тёплом контакте',
      ][answerIndex],
      scores: { [scale.id]: 3, [scales[(answerIndex + 1) % scales.length].id]: 1 },
    })),
  }))
  const results = scales.map((scale) => ({
    id: `result_${scale.code.toLowerCase()}`,
    scaleId: scale.id,
    name: scale.name,
    shortText: `Ваш ведущий механизм — «${scale.name}».`,
    fullText: `Механизм «${scale.name}» помогает вам ориентироваться в важных ситуациях и принимать решения.`,
    recommendations: 'Замечайте, когда этот механизм поддерживает вас, а когда ограничивает выбор. Попробуйте одну небольшую альтернативную реакцию на этой неделе.',
    assetId: 'asset_guide',
    buttons: [],
  }))
  return {
    id: 'test_mechanisms',
    name: '7 внутренних механизмов',
    description: 'Подробная диагностика ведущих способов реагирования.',
    shuffleQuestions: false,
    scales,
    questions,
    results,
    combinedResults: [{
      id: 'result_s1_s2',
      scaleIds: ['scale_s1', 'scale_s2'],
      name: 'Быть нужной + Контроль',
      shortText: 'У вас близки два ведущих механизма.',
      fullText: 'Вы сочетаете стремление быть полезной с потребностью ясно понимать и контролировать происходящее.',
      recommendations: 'Разделяйте помощь по запросу и попытку взять на себя лишнюю ответственность.',
      assetId: 'asset_guide',
      buttons: [],
    }],
    calculation: { method: 'dynamic_percent', proximityThreshold: 8, useCombinedResults: true, missingCombination: 'primary' },
  }
}

export function freshDemoFunnel(): FunnelDocument {
  const document = createEmptyFunnel('7 внутренних механизмов')
  document.project.name = 'Психологическая диагностика'
  document.funnel.description = 'Демонстрационная Telegram-воронка с ветками, тестом, заявкой и продуктом.'
  document.bot.displayName = 'Диагностика механизмов'
  document.bot.username = 'mechanisms_demo_bot'
  document.bot.trackingLinks = [
    { id: 'tracking_instagram', name: 'Instagram — Reels про тест', code: 'instagram_test_july', source: 'instagram', campaign: 'test_july', content: 'reels_03', active: true },
    { id: 'tracking_channel', name: 'Telegram-канал', code: 'telegram_channel', source: 'telegram', campaign: 'channel', active: true },
  ]

  const assets: MediaAsset[] = [
    { id: 'asset_cover', key: 'test_cover', name: 'Обложка теста', type: 'image', required: true, logicalRef: 'telegram:file/test-cover' },
    { id: 'asset_guide', key: 'personal_guide', name: 'PDF-памятка по результату', type: 'document', required: true, logicalRef: 'telegram:file/personal-guide' },
  ]
  const products: Product[] = [{
    id: 'product_report',
    key: 'deep_report',
    name: 'Подробный персональный отчёт',
    description: 'Расширенный разбор механизмов и практические рекомендации.',
    price: 1490,
    active: true,
    assetId: 'asset_guide',
    afterPurchaseText: 'Спасибо за покупку! Отчёт будет отправлен ботом.',
  }]
  document.assets = assets
  document.products = products
  document.tests = [buildTest()]
  document.variables = [{
    id: 'variable_interest',
    key: 'interest_score',
    name: 'Интерес к подробному разбору',
    type: 'number',
    defaultValue: 0,
  }]

  document.nodes = [
    node(document.funnel.startNodeId, 'start', { title: 'Вход в воронку' }),
    node('welcome', 'message', {
      title: 'Приветствие',
      text: 'Здравствуйте! Пройдите короткую диагностику и узнайте свой ведущий внутренний механизм.',
      buttons: [
        { id: 'button_test', text: 'Пройти тест', action: 'branch' },
        { id: 'button_details', text: 'Узнать подробнее', action: 'branch' },
        { id: 'button_channel', text: 'Наш Telegram-канал', action: 'url', url: 'https://t.me/example' },
      ],
    }),
    node('cover', 'media', { title: 'Обложка диагностики', assetId: 'asset_cover', caption: '7 механизмов, которые влияют на решения', required: true }),
    node('set_test_interest', 'variable', {
      title: 'Отметить интерес к тесту',
      operations: [{ id: 'operation_test_interest', variableId: 'variable_interest', operation: 'set', value: 1 }],
    }),
    node('details', 'message', {
      title: 'О диагностике',
      text: 'Семь вопросов помогут увидеть привычный способ реагирования. Это займёт около трёх минут.',
      buttons: [{ id: 'button_details_test', text: 'Начать', action: 'branch' }],
    }),
    node('set_details_interest', 'variable', {
      title: 'Отметить интерес к деталям',
      operations: [{ id: 'operation_details_interest', variableId: 'variable_interest', operation: 'set', value: 2 }],
    }),
    node('test', 'test', { title: 'Тест «7 механизмов»', testId: 'test_mechanisms', welcomeText: 'Отвечайте так, как чувствуете сейчас.' }),
    node('result', 'message', {
      title: 'Пояснение результата',
      text: 'Ваш персональный результат рассчитан. Хотите получить памятку и расширенный разбор?',
      buttons: [
        { id: 'button_form', text: 'Получить памятку', action: 'branch' },
        { id: 'button_offer', text: 'Посмотреть полный отчёт', action: 'branch' },
      ],
    }),
    node('form', 'form', {
      title: 'Заявка на памятку',
      introText: 'Оставьте контакт для получения материала.',
      fields: [
        { id: 'field_name', type: 'name', label: 'Имя', required: true },
        { id: 'field_email', type: 'email', label: 'Email', required: true },
      ],
      submitText: 'Получить',
      confirmationText: 'Готово! Памятка закреплена за вами.',
    }),
    node('consent', 'consent', {
      title: 'Согласие на обработку данных',
      text: 'Я согласен(на) на обработку указанных данных.',
      policyUrl: 'https://example.com/privacy',
      acceptText: 'Согласен',
      declineEnabled: true,
      declineText: 'Не согласен',
    }),
    node('pause', 'timer', { title: 'Пауза перед предложением', duration: 15, unit: 'minutes', respectQuietHours: true }),
    node('interest_condition', 'condition', {
      title: 'Проверить интерес к разбору',
      variableId: 'variable_interest',
      operator: 'greater_or_equal',
      value: 2,
    }),
    node('offer', 'product', {
      title: 'Расширенный отчёт',
      productId: 'product_report',
      headline: 'Получите подробный разбор',
      description: 'Персональные рекомендации и план на 14 дней.',
      price: 1490,
      payButtonText: 'Купить за 1 490 ₽',
      allowSkip: true,
    }),
    node('done', 'end', { title: 'Завершение', text: 'Спасибо! Ваш уровень интереса: {{interest_score}}. Возвращайтесь к своим результатам в любое время.' }),
    node('declined', 'end', { title: 'Без согласия', text: 'Хорошо. Мы не будем сохранять ваши контактные данные.' }),
  ]

  document.edges = [
    { id: 'e_start', source: document.funnel.startNodeId, target: 'welcome', sourceHandle: 'next' },
    { id: 'e_test', source: 'welcome', target: 'set_test_interest', sourceHandle: 'button_test', label: 'Пройти тест' },
    { id: 'e_test_interest', source: 'set_test_interest', target: 'cover', sourceHandle: 'next' },
    { id: 'e_details', source: 'welcome', target: 'set_details_interest', sourceHandle: 'button_details', label: 'Узнать подробнее' },
    { id: 'e_details_interest', source: 'set_details_interest', target: 'details', sourceHandle: 'next' },
    { id: 'e_cover', source: 'cover', target: 'test', sourceHandle: 'next' },
    { id: 'e_details_test', source: 'details', target: 'test', sourceHandle: 'button_details_test', label: 'Начать' },
    ...document.tests[0].results.map((result) => ({ id: `e_${result.id}`, source: 'test', target: 'result', sourceHandle: result.id, label: result.name })),
    { id: 'e_combined', source: 'test', target: 'result', sourceHandle: 'result_s1_s2', label: 'Быть нужной + Контроль' },
    { id: 'e_form', source: 'result', target: 'form', sourceHandle: 'button_form', label: 'Получить памятку' },
    { id: 'e_offer_direct', source: 'result', target: 'interest_condition', sourceHandle: 'button_offer', label: 'Посмотреть полный отчёт' },
    { id: 'e_interest_yes', source: 'interest_condition', target: 'offer', sourceHandle: 'true', label: 'Да' },
    { id: 'e_interest_no', source: 'interest_condition', target: 'pause', sourceHandle: 'false', label: 'Нет' },
    { id: 'e_form_submitted', source: 'form', target: 'consent', sourceHandle: 'submitted' },
    { id: 'e_form_cancelled', source: 'form', target: 'done', sourceHandle: 'cancelled' },
    { id: 'e_consent', source: 'consent', target: 'pause', sourceHandle: 'accepted' },
    { id: 'e_decline', source: 'consent', target: 'declined', sourceHandle: 'declined' },
    { id: 'e_pause', source: 'pause', target: 'offer', sourceHandle: 'next' },
    { id: 'e_paid', source: 'offer', target: 'done', sourceHandle: 'paid' },
    { id: 'e_failed', source: 'offer', target: 'done', sourceHandle: 'failed' },
    { id: 'e_already', source: 'offer', target: 'done', sourceHandle: 'already_purchased' },
    { id: 'e_skip', source: 'offer', target: 'done', sourceHandle: 'skip' },
  ]
  document.editor.nodePositions = {
    [document.funnel.startNodeId]: { x: 40, y: 280 },
    welcome: { x: 310, y: 250 },
    set_test_interest: { x: 610, y: 70 },
    cover: { x: 900, y: 70 },
    set_details_interest: { x: 610, y: 440 },
    details: { x: 900, y: 440 },
    test: { x: 1190, y: 250 },
    result: { x: 1500, y: 250 },
    form: { x: 1800, y: 60 },
    consent: { x: 2080, y: 60 },
    interest_condition: { x: 1800, y: 430 },
    pause: { x: 2360, y: 220 },
    offer: { x: 2640, y: 250 },
    done: { x: 2930, y: 250 },
    declined: { x: 2360, y: 520 },
  }

  document.analytics = emptyAnalytics(1)
  document.analytics.snapshotAt = '2026-07-23T12:00:00.000Z'
  document.analytics.summary = { totalUsers: 1840, started: 1612, completed: 987, applications: 436, purchases: 326, revenue: 485740 }
  document.analytics.nodes = Object.fromEntries(document.nodes.map((item, index) => [item.id, { entered: Math.max(120, 1612 - index * 95), completed: Math.max(100, 1510 - index * 92) }]))
  document.analytics.tests = { test_mechanisms: { started: 1488, completed: 1210 } }
  document.analytics.questions = { question_1: { answered: 1210, skipped: 0 } }
  document.analytics.results = Object.fromEntries(document.tests[0].results.map((result, index) => [result.id, { name: result.name, users: 250 - index * 20 }]))
  document.analytics.products = { product_report: { viewed: 998, paid: 326, revenue: 485740 } }
  document.analytics.sources = {
    tracking_instagram: { arrived: 930, started: 840, completed: 548, applications: 261, purchases: 184, revenue: 274160 },
    tracking_channel: { arrived: 460, started: 412, completed: 291, applications: 124, purchases: 98, revenue: 146020 },
  }
  document.analytics.contacts = [{ id: 'contact_1', name: 'Анна', username: '@anna', email: 'anna@example.com', source: 'tracking_instagram', result: 'Быть нужной', createdAt: '2026-07-22T10:00:00.000Z' }]
  document.analytics.applications = [{ id: 'application_1', contact: 'anna@example.com', source: 'tracking_instagram', status: 'Новая', result: 'Быть нужной', createdAt: '2026-07-22T10:01:00.000Z', comment: '' }]
  return document
}

export const demoFunnel = freshDemoFunnel()
