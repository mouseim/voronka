import { createEmptyFunnel, createNode, emptyAnalytics } from './funnel'
import type {
  ChoiceData, ConditionData, ConsentData, ExternalLinkData, FormData, FormulaData,
  FunnelDocument, FunnelNode, MediaData, MessageData, ProductBlockData, ResultBlockData,
  SetVariableData, TestBlockData,
} from './types'

const position = (x: number, y: number) => ({ x, y })
const makeNode = (type: FunnelNode['type'], id: string, title: string) => {
  const node = createNode(type)
  node.id = id
  node.data.title = title
  return node
}

function buildDemo(): FunnelDocument {
  const document = createEmptyFunnel('7 внутренних механизмов')
  const createdAt = '2026-07-18T09:00:00.000Z'
  document.project = {
    id: 'project_demo_mechanisms',
    name: 'Диагностика «7 внутренних механизмов»',
    description: 'Полная демонстрация теста, сегментации, результата, формы и продукта.',
  }
  document.funnel = {
    id: 'funnel_demo_mechanisms', key: 'seven_inner_mechanisms', name: '7 внутренних механизмов',
    description: 'Диагностика ведущего внутреннего механизма с персональным результатом и предложением.',
    version: 1, status: 'draft', startNodeId: 'demo_start', entryKey: 'main', tags: ['demo', 'diagnostic'],
    createdAt, updatedAt: '2026-07-18T12:30:00.000Z',
  }

  document.variables = [
    { id: 'var_lead_score', key: 'lead_score', name: 'Баллы лида', type: 'number', description: 'Служебный приоритет', defaultValue: 0, scope: 'session', sensitive: false, transferable: true, printable: false },
    { id: 'var_contact_name', key: 'contact_name', name: 'Имя контакта', type: 'string', description: 'Имя из формы', defaultValue: '', scope: 'user', sensitive: true, transferable: true, printable: true },
    { id: 'var_contact_email', key: 'contact_email', name: 'E-mail контакта', type: 'string', description: 'E-mail из формы', defaultValue: '', scope: 'user', sensitive: true, transferable: true, printable: true },
    { id: 'var_result', key: 'diagnostic_result', name: 'Результат диагностики', type: 'object', description: 'Полный рассчитанный результат', defaultValue: {}, scope: 'result', sensitive: false, transferable: true, printable: true },
    { id: 'var_consent', key: 'consent_given', name: 'Согласие', type: 'boolean', description: 'Согласие на обработку данных', defaultValue: false, scope: 'user', sensitive: true, transferable: false, printable: false },
    { id: 'var_source_label', key: 'source_label', name: 'Метка источника', type: 'string', description: 'Уточнённый источник входа', defaultValue: '', scope: 'session', sensitive: false, transferable: true, printable: false },
  ]

  const scaleDefinitions = [
    ['scale_control', 'S1', 'Контроль', '#5267e9'],
    ['scale_recognition', 'S2', 'Признание', '#a855f7'],
    ['scale_security', 'S3', 'Безопасность', '#14b8a6'],
    ['scale_freedom', 'S4', 'Свобода', '#f59e0b'],
    ['scale_belonging', 'S5', 'Принадлежность', '#ec4899'],
    ['scale_exploration', 'S6', 'Исследование', '#0ea5e9'],
    ['scale_creation', 'S7', 'Созидание', '#22c55e'],
  ] as const
  const answerText = ['Навожу порядок и беру управление', 'Показываю результат и получаю отклик', 'Проверяю риски и создаю опору', 'Оставляю пространство для выбора', 'Ищу людей, с которыми мы вместе', 'Пробую новое и задаю вопросы', 'Собираю идею в работающий результат']
  document.tests = [{
    id: 'test_mechanisms', key: 'inner_mechanisms', name: '7 внутренних механизмов',
    description: 'Семь ситуационных вопросов определяют ведущую стратегию.', status: 'draft',
    shuffleQuestions: false, resultSetId: 'result_set_mechanisms', resultVariableKey: 'diagnostic_result',
    scales: scaleDefinitions.map(([id, code, name, color]) => ({ id, code, name, color, description: `Выраженность механизма «${name}»`, direction: 'strength', normalization: 'dynamic_percent', precision: 0 })),
    questions: Array.from({ length: 7 }, (_, questionIndex) => ({
      id: `test_question_${questionIndex + 1}`, type: 'single' as const,
      text: ['Когда появляется сложная задача, что вы делаете первым?', 'Что сильнее всего возвращает энергию?', 'Как вы принимаете важное решение?', 'Что для вас означает хороший рабочий день?', 'Как вы ведёте себя в новой команде?', 'Что помогает пройти период неопределённости?', 'Какой результат вызывает настоящую гордость?'][questionIndex],
      enabled: true, required: true, shuffleAnswers: questionIndex > 1,
      answers: scaleDefinitions.map(([scaleId], answerIndex) => ({
        id: `answer_q${questionIndex + 1}_${answerIndex + 1}`, text: answerText[answerIndex],
        value: `mechanism_${answerIndex + 1}`, enabled: true,
        scoring: [{ id: `score_q${questionIndex + 1}_${answerIndex + 1}`, type: 'add' as const, scaleId, value: 1 }],
      })),
    })),
  }]

  const mechanismResults = scaleDefinitions.map(([scaleId, code, name], index) => ({
    id: `result_${index + 1}`, code, title: `Ваш механизм — ${name}`,
    shortText: `${name} сейчас чаще других направляет ваши решения.`,
    text: `Механизм «${name}» помогает вам двигаться вперёд. Важно использовать его осознанно и подключать остальные стратегии по ситуации.`,
    sections: [{ id: `result_section_${index + 1}`, title: 'Сильная сторона', text: 'Вы быстро замечаете подходящие возможности и превращаете внутренний импульс в действие.' }],
    recommendations: ['Отследите три ситуации, где этот механизм включается автоматически.', 'Выберите один дополняющий механизм на ближайшую неделю.'],
    assetIds: [], buttons: [], contentVersion: 1, scaleIds: [scaleId], combined: false,
  }))
  document.resultSets = [{
    id: 'result_set_mechanisms', key: 'inner_mechanisms_results', name: 'Результаты семи механизмов',
    results: [...mechanismResults, {
      id: 'result_combined_s1_s2', code: 'S1_S2', title: 'Контроль + Признание',
      shortText: 'Два механизма выражены почти одинаково.',
      text: 'Вы одновременно стремитесь управлять процессом и видеть признание результата. Эта связка особенно сильна в лидерских задачах.',
      sections: [{ id: 'result_combined_section', title: 'Баланс', text: 'Проверяйте, где важнее структура, а где — открытый отклик от людей.' }],
      recommendations: ['Разделите критерии контроля процесса и признания результата.', 'Договоритесь с собой о достаточном уровне каждого механизма.'],
      assetIds: ['asset_cover'], buttons: [], contentVersion: 1, scaleIds: ['scale_control', 'scale_recognition'], combined: true,
    }],
    rules: [
      { id: 'rule_close', type: 'closeness', closenessPoints: 8, priority: 10 },
      { id: 'rule_top', type: 'top', topN: 2, priority: 20 },
      { id: 'rule_fallback', type: 'fallback', resultCode: 'S1', priority: 100 },
    ],
    fallbackResultCode: 'S1', tieBreaker: 'scale_order',
  }]

  document.assets = [
    { id: 'asset_guide', assetKey: 'mechanisms_guide_pdf', displayName: 'Гайд по семи механизмам', expectedType: 'document', required: true, description: 'PDF-памятка, которую получает пользователь', expectedMimeTypes: ['application/pdf'], recommendedFilename: '7-mehanizmov.pdf', maxSizeMb: 20 },
    { id: 'asset_cover', assetKey: 'mechanisms_cover', displayName: 'Обложка диагностики', expectedType: 'image', required: false, description: 'Обложка результата', expectedMimeTypes: ['image/jpeg', 'image/png'], maxSizeMb: 10 },
    { id: 'asset_intro_video', assetKey: 'mechanisms_intro_video', displayName: 'Видео-знакомство', expectedType: 'video', required: false, description: 'Короткое знакомство перед тестом', expectedMimeTypes: ['video/mp4'], maxSizeMb: 50, maxDurationSeconds: 180 },
    { id: 'asset_day3_voice', assetKey: 'mechanisms_day3_voice', displayName: 'Голосовая практика третьего дня', expectedType: 'voice', required: false, description: 'Персональное голосовое упражнение', expectedMimeTypes: ['audio/ogg'], maxSizeMb: 20, maxDurationSeconds: 600 },
  ]
  document.products = [{
    id: 'product_deep_report', productKey: 'deep_mechanisms_report', name: 'Расширенный разбор',
    description: 'Персональный PDF-разбор с упражнениями', type: 'digital', priceMinor: 149000, currency: 'RUB', active: true,
    provider: 'yookassa', assetIds: ['asset_guide'], personalization: scaleDefinitions.map(([, code]) => ({ resultCode: code, assetId: 'asset_guide' })), fallbackAssetId: 'asset_guide',
    successText: 'Оплата принята. Материал готов к выдаче.', repurchasePolicy: 'redeliver',
    analytics: { opened: 'product_opened', paid: 'product_paid' },
  }]

  const start = makeNode('start', 'demo_start', 'Старт диагностики')
  const welcome = makeNode('message', 'demo_welcome', 'Приветствие')
  Object.assign(welcome.data as MessageData, { text: 'Здравствуйте, {{user.firstName | default: "друг"}}! За несколько минут мы определим ваш ведущий внутренний механизм.', buttons: [{ id: 'btn_begin', text: 'Начать диагностику', enabled: true, style: 'primary', action: 'transition', scoring: [] }], continueWithoutButton: false })
  const source = makeNode('choice', 'demo_source', 'Источник знакомства')
  Object.assign(source.data as ChoiceData, { prompt: 'Откуда вы узнали о диагностике?', options: [{ id: 'source_social', text: 'Социальные сети', value: 'social', enabled: true, scoring: [] }, { id: 'source_friend', text: 'Рекомендация', value: 'friend', enabled: true, scoring: [] }], variableKey: 'source_label' })
  const prepare = makeNode('set_variable', 'demo_prepare', 'Подготовить сессию')
  Object.assign(prepare.data as SetVariableData, { actions: [{ id: 'action_lead_score', type: 'assign', variableKey: 'lead_score', value: 1 }] })
  const test = makeNode('test', 'demo_test', 'Тест из семи вопросов')
  Object.assign(test.data as TestBlockData, { testId: 'test_mechanisms', resultVariableKey: 'diagnostic_result', welcomeText: 'Отвечайте так, как чувствуете сейчас.', progressText: 'Вопрос {{current}} из {{total}}' })
  const condition = makeNode('condition', 'demo_condition', 'Результат рассчитан?')
  Object.assign(condition.data as ConditionData, { branches: [
    { id: 'branch_result_ready', name: 'Результат готов', isElse: false, condition: { id: 'condition_result_group', kind: 'group', logic: 'and', not: false, children: [{ id: 'condition_result_rule', kind: 'rule', left: { kind: 'variable', key: 'diagnostic_result' }, operator: 'filled' }] } },
    { id: 'branch_result_fallback', name: 'Иначе', isElse: true },
  ] })
  const formula = makeNode('formula', 'demo_formula', 'Рассчитать приоритет')
  Object.assign(formula.data as FormulaData, { targetVariableKey: 'lead_score', expression: { id: 'formula_add', kind: 'binary', operator: '+', left: { id: 'formula_source', kind: 'variable', key: 'lead_score' }, right: { id: 'formula_bonus', kind: 'number', value: 4 } } })
  const result = makeNode('result', 'demo_result', 'Персональный результат')
  Object.assign(result.data as ResultBlockData, { resultSetId: 'result_set_mechanisms', sourceVariableKey: 'diagnostic_result', singleTemplate: '{{result.main.title}}', combinedTemplate: '{{result.main.title}} + {{result.secondary.title}}' })
  const fallback = makeNode('message', 'demo_fallback', 'Запасной результат')
  Object.assign(fallback.data as MessageData, { text: 'Ответы сохранены, но результат не удалось сопоставить. Мы покажем базовую рекомендацию.', buttons: [{ id: 'btn_fallback_continue', text: 'Продолжить', enabled: true, style: 'primary', action: 'transition', scoring: [] }] })
  const consent = makeNode('consent', 'demo_consent', 'Согласие на связь')
  Object.assign(consent.data as ConsentData, { text: 'Разрешаю сохранить контакт и прислать материалы по результату.', policyUrl: 'https://example.test/privacy', variableKey: 'consent_given' })
  const form = makeNode('form', 'demo_form', 'Получить материал')
  Object.assign(form.data as FormData, { description: 'Оставьте имя и e-mail, чтобы получить памятку.', fields: [{ id: 'field_name', label: 'Ваше имя', type: 'name', required: true, variableKey: 'contact_name' }, { id: 'field_email', label: 'E-mail', type: 'email', required: true, variableKey: 'contact_email' }], recordType: 'application', applicationStatus: 'Новая', consentRequired: true })
  const product = makeNode('product', 'demo_product', 'Расширенный разбор')
  Object.assign(product.data as ProductBlockData, { productId: 'product_deep_report', headline: 'Хотите глубже?', description: 'Получите расширенный персональный разбор и упражнения.', displayPrice: '1 490 ₽', payButtonText: 'Получить разбор', allowSkip: true })
  const media = makeNode('media', 'demo_media', 'Памятка')
  Object.assign(media.data as MediaData, { assetId: 'asset_guide', assetKey: 'mechanisms_guide_pdf', displayName: 'Гайд по семи механизмам', expectedType: 'document', caption: 'Сохраните краткую памятку по своему результату.' })
  const reminder = makeNode('reminder', 'demo_reminder', 'Мягкое напоминание')
  const link = makeNode('external_link', 'demo_link', 'Канал с практиками')
  Object.assign(link.data as ExternalLinkData, { url: 'https://t.me/example', buttonText: 'Открыть канал', linkType: 'channel' })
  const done = makeNode('end', 'demo_done', 'Успешное завершение')
  done.data.text = 'Готово! Ваш результат и материалы сохранены.'
  const decline = makeNode('end', 'demo_decline', 'Завершение без согласия')
  decline.data.text = 'Спасибо за честный ответ. Мы ничего не сохраняем.'
  const noPurchase = makeNode('end', 'demo_no_purchase', 'Завершение без покупки')
  noPurchase.data.text = 'Базовый результат остаётся у вас. Возвращайтесь, когда будет удобно.'
  const comment = makeNode('comment', 'demo_comment', 'Подсказка команде')
  comment.data.text = 'Платёж и реальная доставка файлов здесь только моделируются.'

  document.nodes = [start, welcome, source, prepare, test, condition, formula, result, fallback, consent, form, product, media, reminder, link, done, decline, noPurchase, comment]
  document.editor.nodePositions = {
    demo_start: position(60, 320), demo_welcome: position(330, 320), demo_source: position(600, 320), demo_prepare: position(870, 220),
    demo_test: position(1140, 220), demo_condition: position(1410, 220), demo_formula: position(1680, 80), demo_result: position(1950, 80),
    demo_fallback: position(1680, 390), demo_consent: position(2220, 220), demo_form: position(2490, 80), demo_product: position(2760, 80),
    demo_media: position(3030, 0), demo_reminder: position(3300, 0), demo_link: position(3570, 0), demo_done: position(3840, 0),
    demo_decline: position(2490, 430), demo_no_purchase: position(3030, 360), demo_comment: position(2740, 570),
  }

  const edge = (id: string, from: string, to: string, handle = 'next', label?: string) => ({ id, source: from, target: to, sourceHandle: handle, label })
  document.edges = [
    edge('edge_start_welcome', 'demo_start', 'demo_welcome'), edge('edge_welcome_source', 'demo_welcome', 'demo_source', 'btn_begin'),
    edge('edge_source_social', 'demo_source', 'demo_prepare', 'source_social', 'Социальные сети'), edge('edge_source_friend', 'demo_source', 'demo_prepare', 'source_friend', 'Рекомендация'),
    edge('edge_prepare_test', 'demo_prepare', 'demo_test'), edge('edge_test_condition', 'demo_test', 'demo_condition', 'completed'),
    edge('edge_condition_ready', 'demo_condition', 'demo_formula', 'branch_result_ready'), edge('edge_condition_fallback', 'demo_condition', 'demo_fallback', 'branch_result_fallback'),
    edge('edge_formula_result', 'demo_formula', 'demo_result'), edge('edge_result_consent', 'demo_result', 'demo_consent'), edge('edge_fallback_consent', 'demo_fallback', 'demo_consent', 'btn_fallback_continue'),
    edge('edge_consent_accept', 'demo_consent', 'demo_form', 'accepted'), edge('edge_consent_decline', 'demo_consent', 'demo_decline', 'declined'),
    edge('edge_form_product', 'demo_form', 'demo_product', 'success'), edge('edge_product_success', 'demo_product', 'demo_media', 'success'),
    edge('edge_product_failure', 'demo_product', 'demo_no_purchase', 'failure'), edge('edge_product_cancel', 'demo_product', 'demo_no_purchase', 'cancelled'),
    edge('edge_product_owned', 'demo_product', 'demo_media', 'already_purchased'), edge('edge_product_skip', 'demo_product', 'demo_no_purchase', 'skip'),
    edge('edge_media_reminder', 'demo_media', 'demo_reminder'), edge('edge_reminder_link', 'demo_reminder', 'demo_link'), edge('edge_link_done', 'demo_link', 'demo_done'),
  ]

  document.testScenarios = [{ id: 'scenario_control', name: 'Контроль — основной путь', systemValues: { source: 'demo' }, answers: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`test_question_${index + 1}`, 'answer_q' + (index + 1) + '_1'])), paymentOutcomes: { product_deep_report: 'success' }, seed: 'demo-control', expectedEndNodeId: 'demo_done', expectedResultCode: 'S1', expectedVariables: { lead_score: 5 } }]
  document.analytics = emptyAnalytics(1)
  document.analytics.snapshotAt = '2026-07-18T12:30:00.000Z'
  document.analytics.completeness = { level: 'journeys', sections: ['summary', 'nodes', 'edges', 'tests', 'results', 'products', 'sources', 'contacts'] }
  document.analytics.summary = { totalUsers: 1840, started: 1612, completed: 987, active: 104, optedOut: 38, averageDurationSeconds: 428 }
  const entered: Record<string, [number, number]> = { demo_start: [1840, 1612], demo_welcome: [1612, 1540], demo_source: [1540, 1488], demo_prepare: [1488, 1488], demo_test: [1488, 1210], demo_condition: [1210, 1210], demo_formula: [1192, 1192], demo_result: [1192, 1144], demo_fallback: [18, 18], demo_consent: [1162, 1080], demo_form: [1044, 998], demo_product: [998, 987], demo_media: [326, 326], demo_reminder: [326, 320], demo_link: [320, 292], demo_done: [292, 292], demo_decline: [36, 36], demo_no_purchase: [661, 661] }
  document.analytics.nodes = Object.fromEntries(Object.entries(entered).map(([id, [value, complete]]) => [id, { entered: value, completed: complete, dropped: value - complete }]))
  document.analytics.edges = Object.fromEntries(document.edges.map((item) => [item.id, { transitions: Math.max(1, document.analytics.nodes[item.target]?.entered ?? 1) }]))
  document.analytics.tests = { test_mechanisms: { started: 1488, completed: 1210, averageSeconds: 311 } }
  document.analytics.results = Object.fromEntries(scaleDefinitions.map(([, code, name], index) => [code, { name, users: [286, 201, 184, 166, 151, 124, 98][index] }]))
  document.analytics.products = { product_deep_report: { viewed: 998, initiated: 402, paid: 326, revenueMinor: 48574000 } }
  document.analytics.sources = { instagram: { started: 840, completed: 548 }, recommendation: { started: 412, completed: 291 }, direct: { started: 360, completed: 148 } }
  document.analytics.contacts = [
    { id: 'contact_001', name: 'Анна К.', username: '@anna_demo', email: 'anna@example.test', source: 'instagram', resultCode: 'S1', createdAt: '2026-07-17T10:15:00.000Z' },
    { id: 'contact_002', name: 'Михаил П.', username: '@mikhail_demo', source: 'recommendation', resultCode: 'S7', createdAt: '2026-07-18T08:40:00.000Z' },
    { id: 'contact_003', name: 'Елена С.', phone: '+7 900 000-00-00', source: 'direct', resultCode: 'S3', createdAt: '2026-07-18T11:05:00.000Z' },
  ]
  document.analytics.applications = [
    { id: 'application_001', contactId: 'contact_001', status: 'Новая', source: 'instagram', resultCode: 'S1', createdAt: '2026-07-17T10:24:00.000Z', comment: 'Интерес к расширенному разбору' },
    { id: 'application_002', contactId: 'contact_003', status: 'В работе', source: 'direct', resultCode: 'S3', createdAt: '2026-07-18T11:18:00.000Z', comment: 'Нужна консультация' },
  ]
  return document
}

export const demoFunnel: FunnelDocument = buildDemo()

export function freshDemoFunnel(): FunnelDocument {
  const copy = structuredClone(demoFunnel)
  const now = new Date().toISOString()
  copy.project.id = `project_${crypto.randomUUID()}`
  copy.funnel.id = `funnel_${crypto.randomUUID()}`
  copy.funnel.createdAt = now
  copy.funnel.updatedAt = now
  return copy
}
