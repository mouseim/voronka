import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BarChart3,
  Beaker,
  Bot,
  Braces,
  Check,
  ChevronRight,
  Copy,
  FileImage,
  GitBranch,
  Link2,
  Package,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { assetUsageCount, newId, productUsageCount, slugify, telegramDeepLink, uniqueTrackingCode, variableUsageCount } from '../model/funnel'
import { defaultValueForType, VARIABLE_TYPE_LABELS } from '../model/variables'
import { calculateTestResult } from '../model/scoring'
import type {
  CombinedTestResult,
  FunnelDocument,
  FunnelTest,
  FunnelVariable,
  MediaAsset,
  Product,
  QuestionType,
  ResultButton,
  TestAnswer,
  TestQuestion,
  TestResult,
  TestScale,
  TrackingLink,
  VariableType,
  WorkspaceSection,
} from '../model/types'
import { useEditorStore } from '../store/editor'

export type { WorkspaceSection } from '../model/types'

interface WorkspaceProps {
  document: FunnelDocument
  section: WorkspaceSection
  onSection: (section: WorkspaceSection) => void
  onBack: () => void
  onEdit: () => void
  onAnalytics: () => void
}

const navigation: Array<{ id: WorkspaceSection; label: string; icon: typeof Beaker }> = [
  { id: 'variables', label: 'Переменные', icon: Braces },
  { id: 'tests', label: 'Тесты', icon: Beaker },
  { id: 'media', label: 'Медиа', icon: FileImage },
  { id: 'products', label: 'Продукты', icon: Package },
  { id: 'bot', label: 'Бот', icon: Bot },
]

export function Workspace({ document, section, onSection, onBack, onEdit, onAnalytics }: WorkspaceProps) {
  return (
    <div className="workspace-page">
      <header className="app-header workspace-header">
        <button className="brand-button compact" onClick={onBack}><span className="brand-mark">В</span><span><strong>Воронка</strong><small>{document.funnel.name}</small></span></button>
        <nav className="workspace-top-nav">
          <button onClick={onEdit}><GitBranch size={16} /> Схема</button>
          {navigation.map((item) => <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => onSection(item.id)}><item.icon size={16} /> {item.label}</button>)}
          <button onClick={onAnalytics}><BarChart3 size={16} /> Статистика</button>
        </nav>
      </header>
      <main className="workspace-main simple-workspace">
        <button className="back-link" onClick={onEdit}><ArrowLeft size={16} /> К схеме</button>
        {section === 'variables' && <VariablesSection document={document} />}
        {section === 'tests' && <TestsSection document={document} />}
        {section === 'media' && <MediaSection document={document} />}
        {section === 'products' && <ProductsSection document={document} />}
        {section === 'bot' && <BotSection document={document} />}
      </main>
    </div>
  )
}

function VariablesSection({ document }: { document: FunnelDocument }) {
  const updateDocument = useEditorStore((state) => state.updateDocument)
  const [selectedId, setSelectedId] = useState(document.variables[0]?.id ?? '')
  const selected = document.variables.find((variable) => variable.id === selectedId)
  const patch = (changes: Partial<FunnelVariable>) => updateDocument((draft) => {
    const variable = draft.variables.find((item) => item.id === selectedId)
    if (variable) Object.assign(variable, changes)
  })
  const add = () => {
    const index = document.variables.length + 1
    const base = `variable_${index}`
    const used = new Set(document.variables.map((variable) => variable.key))
    let key = base
    let suffix = 2
    while (used.has(key)) key = `${base}_${suffix++}`
    const variable: FunnelVariable = {
      id: newId('variable'),
      key,
      name: `Переменная ${index}`,
      type: 'text',
      defaultValue: '',
    }
    updateDocument((draft) => { draft.variables.push(variable) })
    setSelectedId(variable.id)
  }
  const changeName = (name: string) => {
    if (!selected) return
    const autoKey = slugify(name).replace(/-/g, '_').replace(/^[^a-z]+/, '') || selected.key
    const keyIsAutomatic = selected.key.startsWith('variable_') || !selected.key.trim()
    patch({ name, ...(keyIsAutomatic ? { key: uniqueVariableKey(document, autoKey, selected.id) } : {}) })
  }
  const changeType = (type: VariableType) => patch({ type, defaultValue: defaultValueForType(type) })
  const usage = selected ? variableUsageCount(document, selected.id) : 0
  return <>
    <PageHeading
      eyebrow="Данные воронки"
      title="Переменные"
      text="Создайте понятные значения один раз, а затем меняйте и проверяйте их блоками на схеме."
      action={<button className="button primary" onClick={add}><Plus size={16} /> Добавить переменную</button>}
    />
    <div className="catalog-layout">
      <aside className="catalog-list">
        <div className="catalog-list-title"><strong>Переменные</strong><span>{document.variables.length}</span></div>
        {document.variables.map((variable) => <button className={selectedId === variable.id ? 'active' : ''} key={variable.id} onClick={() => setSelectedId(variable.id)}><span className="variable-type">{variable.type === 'number' ? '123' : variable.type === 'boolean' ? 'Да' : 'Aa'}</span><span><strong>{variable.name}</strong><code>{'{{'}{variable.key}{'}}'}</code></span><ChevronRight size={14} /></button>)}
        {!document.variables.length && <div className="catalog-empty">Создайте первую переменную</div>}
      </aside>
      <section className="entity-editor">
        {selected ? <>
          <div className="entity-title-row"><div><span className="eyebrow">Переменная</span><input className="entity-title-input" value={selected.name} onChange={(event) => changeName(event.target.value)} /></div><button className="mini-icon danger" title="Удалить переменную" disabled={usage > 0} onClick={() => { if (!confirm(`Удалить переменную «${selected.name}»?`)) return; updateDocument((draft) => { draft.variables = draft.variables.filter((variable) => variable.id !== selected.id) }); setSelectedId('') }}><Trash2 size={17} /></button></div>
          <div className="friendly-note">Вставьте <strong>{'{{'}{selected.key}{'}}'}</strong> в текст сообщения, подпись медиа или финальный текст — бот подставит текущее значение.</div>
          <div className="form-grid">
            <Field label="Тип значения"><select value={selected.type} onChange={(event) => changeType(event.target.value as VariableType)}>{(Object.keys(VARIABLE_TYPE_LABELS) as VariableType[]).map((type) => <option value={type} key={type}>{VARIABLE_TYPE_LABELS[type]}</option>)}</select></Field>
            <Field label="Технический код"><input value={selected.key} onChange={(event) => patch({ key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} /></Field>
            <Field label="Начальное значение"><VariableDefaultInput variable={selected} onChange={(defaultValue) => patch({ defaultValue })} /></Field>
          </div>
          <div className="friendly-note">Используется в <strong>{usage}</strong> действиях или условиях. {usage > 0 ? 'Чтобы удалить переменную, сначала уберите её из блоков на схеме.' : 'Переменную можно безопасно удалить.'}</div>
        </> : <Empty title="Переменная не выбрана" text="Добавьте переменную или выберите её слева." />}
      </section>
    </div>
  </>
}

function VariableDefaultInput({ variable, onChange }: { variable: FunnelVariable; onChange: (value: FunnelVariable['defaultValue']) => void }) {
  if (variable.type === 'boolean') return <select value={String(Boolean(variable.defaultValue))} onChange={(event) => onChange(event.target.value === 'true')}><option value="false">Нет</option><option value="true">Да</option></select>
  return <input type={variable.type === 'number' ? 'number' : 'text'} value={String(variable.defaultValue)} onChange={(event) => onChange(variable.type === 'number' ? Number(event.target.value) : event.target.value)} />
}

function uniqueVariableKey(document: FunnelDocument, raw: string, exceptId?: string): string {
  const base = raw.replace(/^[^a-z]+/, '') || 'variable'
  const used = new Set(document.variables.filter((variable) => variable.id !== exceptId).map((variable) => variable.key))
  if (!used.has(base)) return base
  let suffix = 2
  while (used.has(`${base}_${suffix}`)) suffix += 1
  return `${base}_${suffix}`
}

function TestsSection({ document }: { document: FunnelDocument }) {
  const updateDocument = useEditorStore((state) => state.updateDocument)
  const [selectedId, setSelectedId] = useState(document.tests[0]?.id ?? '')
  const [mode, setMode] = useState<'questions' | 'scales' | 'results' | 'calculator'>('questions')
  const selected = document.tests.find((test) => test.id === selectedId)
  const updateTest = (run: (test: FunnelTest) => void) => updateDocument((draft) => {
    const test = draft.tests.find((item) => item.id === selectedId)
    if (test) run(test)
  })
  const addTest = () => {
    const scale = createScale(1)
    const test: FunnelTest = {
      id: newId('test'),
      name: 'Новый тест',
      description: '',
      shuffleQuestions: false,
      scales: [scale],
      questions: [createQuestion([scale])],
      results: [createResult(scale)],
      combinedResults: [],
      calculation: { method: 'dynamic_percent', proximityThreshold: 8, useCombinedResults: true, missingCombination: 'primary' },
    }
    updateDocument((draft) => { draft.tests.push(test) })
    setSelectedId(test.id)
  }
  return (
    <>
      <PageHeading eyebrow="Диагностика" title="Психологические тесты" text="Вопросы, шкалы, баллы и результаты — без JSON и технических формул." action={<button className="button primary" onClick={addTest}><Plus size={16} /> Создать тест</button>} />
      <div className="catalog-layout">
        <aside className="catalog-list">
          <div className="catalog-list-title"><strong>Тесты</strong><span>{document.tests.length}</span></div>
          {document.tests.map((test) => <button key={test.id} className={selectedId === test.id ? 'active' : ''} onClick={() => setSelectedId(test.id)}><span className="catalog-icon"><Beaker size={16} /></span><span><strong>{test.name}</strong><small>{test.questions.length} вопросов · {test.scales.length} шкал</small></span><ChevronRight size={14} /></button>)}
          {!document.tests.length && <div className="catalog-empty">Создайте первый тест</div>}
        </aside>
        <section className="entity-editor">
          {!selected ? <Empty title="Тест не выбран" text="Создайте тест или выберите его слева." /> : <>
            <div className="entity-title-row"><div><span className="eyebrow">Настройки теста</span><input className="entity-title-input" value={selected.name} onChange={(event) => updateTest((test) => { test.name = event.target.value })} /></div><button className="mini-icon danger" title="Удалить тест" onClick={() => { if (!confirm(`Удалить тест «${selected.name}»? Блоки, где он выбран, потребуют настройки.`)) return; updateDocument((draft) => { draft.tests = draft.tests.filter((test) => test.id !== selected.id) }); setSelectedId('') }}><Trash2 size={17} /></button></div>
            <Field label="Описание"><textarea rows={3} value={selected.description} onChange={(event) => updateTest((test) => { test.description = event.target.value })} /></Field>
            <div className="subtabs">
              <button className={mode === 'questions' ? 'active' : ''} onClick={() => setMode('questions')}>Вопросы</button>
              <button className={mode === 'scales' ? 'active' : ''} onClick={() => setMode('scales')}>Шкалы</button>
              <button className={mode === 'results' ? 'active' : ''} onClick={() => setMode('results')}>Результаты</button>
              <button className={mode === 'calculator' ? 'active' : ''} onClick={() => setMode('calculator')}>Проверить прохождение</button>
            </div>
            {mode === 'questions' && <QuestionsEditor test={selected} update={updateTest} />}
            {mode === 'scales' && <ScalesEditor test={selected} update={updateTest} />}
            {mode === 'results' && <ResultsEditor document={document} test={selected} update={updateTest} />}
            {mode === 'calculator' && <TestCalculator test={selected} />}
          </>}
        </section>
      </div>
    </>
  )
}

function QuestionsEditor({ test, update }: { test: FunnelTest; update: (run: (test: FunnelTest) => void) => void }) {
  const changeQuestions = (questions: TestQuestion[]) => update((draft) => { draft.questions = questions })
  const patchQuestion = (id: string, changes: Partial<TestQuestion>) => changeQuestions(test.questions.map((question) => question.id === id ? { ...question, ...changes } : question))
  const move = (index: number, offset: number) => {
    const next = [...test.questions]
    const target = index + offset
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    changeQuestions(next)
  }
  return <div className="test-editor-section">
    <div className="section-toolbar"><Toggle checked={test.shuffleQuestions} onChange={(shuffleQuestions) => update((draft) => { draft.shuffleQuestions = shuffleQuestions })} label="Перемешивать вопросы" /><button className="button secondary" onClick={() => changeQuestions([...test.questions, createQuestion(test.scales)])}><Plus size={15} /> Добавить вопрос</button></div>
    <div className="question-accordion">
      {test.questions.map((question, index) => <details key={question.id} open={index === 0}>
        <summary><span className={`question-status ${question.enabled ? 'enabled' : ''}`}>{question.enabled ? <Check size={13} /> : index + 1}</span><strong>{question.text || 'Вопрос без текста'}</strong><small>{questionTypeLabel(question.type)}</small><ChevronRight size={15} /></summary>
        <div className="question-editor-body">
          <div className="question-actions"><button disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} /> Выше</button><button disabled={index === test.questions.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /> Ниже</button><button onClick={() => changeQuestions([...test.questions.slice(0, index + 1), { ...structuredClone(question), id: newId('question'), text: `${question.text} — копия`, answers: question.answers.map((answer) => ({ ...answer, id: newId('answer') })) }, ...test.questions.slice(index + 1)])}><Copy size={14} /> Дублировать</button><button className="danger" onClick={() => { if (confirm('Удалить этот вопрос?')) changeQuestions(test.questions.filter((item) => item.id !== question.id)) }}><Trash2 size={14} /> Удалить</button></div>
          <Field label="Текст вопроса"><textarea rows={3} value={question.text} onChange={(event) => patchQuestion(question.id, { text: event.target.value })} /></Field>
          <div className="form-grid">
            <Field label="Тип вопроса"><select value={question.type} onChange={(event) => patchQuestion(question.id, { type: event.target.value as QuestionType })}>{(['single', 'multiple', 'scale', 'number', 'text'] as const).map((type) => <option value={type} key={type}>{questionTypeLabel(type)}</option>)}</select></Field>
            <Toggle checked={question.enabled} onChange={(enabled) => patchQuestion(question.id, { enabled })} label="Вопрос включён" />
            <Toggle checked={question.required} onChange={(required) => patchQuestion(question.id, { required })} label="Обязательный" />
            <Toggle checked={question.shuffleAnswers} onChange={(shuffleAnswers) => patchQuestion(question.id, { shuffleAnswers })} label="Перемешивать ответы" />
          </div>
          {['single', 'multiple', 'scale'].includes(question.type) ? <AnswersTable test={test} question={question} onChange={(answers) => patchQuestion(question.id, { answers })} /> : <div className="friendly-note">Ответ сохраняется как {question.type === 'number' ? 'число' : 'свободный текст'} и не начисляет баллы автоматически.</div>}
        </div>
      </details>)}
    </div>
  </div>
}

function AnswersTable({ test, question, onChange }: { test: FunnelTest; question: TestQuestion; onChange: (answers: TestAnswer[]) => void }) {
  const patch = (id: string, changes: Partial<TestAnswer>) => onChange(question.answers.map((answer) => answer.id === id ? { ...answer, ...changes } : answer))
  return <div className="scoring-editor">
    <div className="section-label"><span>Ответы и баллы</span><b>{question.answers.length}</b></div>
    <div className="score-table">
      <div className="score-row score-head"><span>Ответ</span>{test.scales.map((scale) => <span key={scale.id} title={scale.name}><i style={{ background: scale.color }} />{scale.name}</span>)}<span /></div>
      {question.answers.map((answer) => <div className="score-row" key={answer.id}><input value={answer.text} onChange={(event) => patch(answer.id, { text: event.target.value })} />{test.scales.map((scale) => <label key={scale.id}><small>{scale.name}</small><input type="number" value={answer.scores[scale.id] ?? 0} onChange={(event) => patch(answer.id, { scores: { ...answer.scores, [scale.id]: Number(event.target.value) } })} /></label>)}<button className="mini-icon danger" onClick={() => onChange(question.answers.filter((item) => item.id !== answer.id))}><Trash2 size={14} /></button></div>)}
    </div>
    <button className="button secondary" onClick={() => onChange([...question.answers, { id: newId('answer'), text: 'Новый ответ', scores: Object.fromEntries(test.scales.map((scale) => [scale.id, 0])) }])}><Plus size={15} /> Добавить ответ</button>
  </div>
}

function ScalesEditor({ test, update }: { test: FunnelTest; update: (run: (test: FunnelTest) => void) => void }) {
  const change = (scales: TestScale[]) => update((draft) => { draft.scales = scales })
  const usage = (scaleId: string) => test.questions.reduce((sum, question) => sum + question.answers.filter((answer) => (answer.scores[scaleId] ?? 0) !== 0).length, 0)
  const remove = (scale: TestScale) => {
    const count = usage(scale.id)
    if (!confirm(`Удалить шкалу «${scale.name}»${count ? `? Она используется в ${count} ответах, связанные баллы и результаты будут удалены.` : '?'}`)) return
    update((draft) => {
      draft.scales = draft.scales.filter((item) => item.id !== scale.id)
      draft.questions.forEach((question) => question.answers.forEach((answer) => { delete answer.scores[scale.id] }))
      draft.results = draft.results.filter((result) => result.scaleId !== scale.id)
      draft.combinedResults = draft.combinedResults.filter((result) => !result.scaleIds.includes(scale.id))
    })
  }
  return <div className="test-editor-section">
    <div className="friendly-note">Шкала — это понятная характеристика, по которой ответы начисляют баллы. Технический код создаётся автоматически.</div>
    <div className="scale-list">{test.scales.map((scale, index) => <article key={scale.id}><input type="color" value={scale.color} onChange={(event) => change(test.scales.map((item) => item.id === scale.id ? { ...item, color: event.target.value } : item))} /><div><input value={scale.name} onChange={(event) => change(test.scales.map((item) => item.id === scale.id ? { ...item, name: event.target.value } : item))} /><span>Используется в {usage(scale.id)} ответах</span><details><summary>Дополнительно</summary><code>{scale.code}</code></details></div><div className="scale-actions"><button disabled={index === 0} onClick={() => change(swap(test.scales, index, index - 1))}><ArrowUp size={14} /></button><button disabled={index === test.scales.length - 1} onClick={() => change(swap(test.scales, index, index + 1))}><ArrowDown size={14} /></button><button className="danger" onClick={() => remove(scale)}><Trash2 size={14} /></button></div></article>)}</div>
    <button className="button secondary" onClick={() => update((draft) => { const scale = createScale(draft.scales.length + 1); draft.scales.push(scale); draft.questions.forEach((question) => question.answers.forEach((answer) => { answer.scores[scale.id] = 0 })); draft.results.push(createResult(scale)) })}><Plus size={15} /> Добавить шкалу</button>
  </div>
}

function ResultsEditor({ document, test, update }: { document: FunnelDocument; test: FunnelTest; update: (run: (test: FunnelTest) => void) => void }) {
  const [kind, setKind] = useState<'main' | 'combined'>('main')
  return <div className="test-editor-section">
    <EditorGroup title="Как выбирается результат">
      <p className="human-rule">Для каждой шкалы считается процент от максимума активных вопросов. Побеждает самый высокий процент. Если два результата отличаются не больше чем на заданный порог, можно показать комбинированный текст.</p>
      <div className="form-grid"><Field label="Порог близости, п.п."><input type="number" min="0" max="100" value={test.calculation.proximityThreshold} onChange={(event) => update((draft) => { draft.calculation.proximityThreshold = Number(event.target.value) })} /></Field><Toggle checked={test.calculation.useCombinedResults} onChange={(useCombinedResults) => update((draft) => { draft.calculation.useCombinedResults = useCombinedResults })} label="Использовать комбинированные результаты" /></div>
      <p className="panel-help">Если подходящей комбинации нет, показывается главный одиночный результат.</p>
    </EditorGroup>
    <div className="subtabs small"><button className={kind === 'main' ? 'active' : ''} onClick={() => setKind('main')}>Основные</button><button className={kind === 'combined' ? 'active' : ''} onClick={() => setKind('combined')}>Комбинированные</button></div>
    {kind === 'main' ? <div className="result-editor-list">{test.results.map((result) => <ResultEditor key={result.id} document={document} result={result} scaleName={test.scales.find((scale) => scale.id === result.scaleId)?.name ?? 'Шкала удалена'} onChange={(changes) => update((draft) => { const target = draft.results.find((item) => item.id === result.id); if (target) Object.assign(target, changes) })} />)}</div>
      : <div className="result-editor-list">{test.combinedResults.map((result) => <CombinedResultEditor key={result.id} document={document} test={test} result={result} onChange={(changes) => update((draft) => { const target = draft.combinedResults.find((item) => item.id === result.id); if (target) Object.assign(target, changes) })} onDelete={() => update((draft) => { draft.combinedResults = draft.combinedResults.filter((item) => item.id !== result.id) })} />)}<button className="button secondary" disabled={test.scales.length < 2} onClick={() => update((draft) => { draft.combinedResults.push({ id: newId('combined_result'), scaleIds: [draft.scales[0].id, draft.scales[1].id], name: 'Новая комбинация', shortText: '', fullText: '', recommendations: '', buttons: [] }) })}><Plus size={15} /> Добавить комбинацию</button></div>}
  </div>
}

function ResultEditor({ document, result, scaleName, onChange }: { document: FunnelDocument; result: TestResult; scaleName: string; onChange: (changes: Partial<TestResult>) => void }) {
  return <details open><summary><span className="result-dot" /> <strong>{result.name}</strong><small>{scaleName}</small><ChevronRight size={15} /></summary><div><ResultTextFields document={document} result={result} onChange={onChange} /></div></details>
}

function CombinedResultEditor({ document, test, result, onChange, onDelete }: { document: FunnelDocument; test: FunnelTest; result: CombinedTestResult; onChange: (changes: Partial<CombinedTestResult>) => void; onDelete: () => void }) {
  return <details open><summary><span className="result-dot combined" /><strong>{result.name}</strong><small>Комбинация</small><ChevronRight size={15} /></summary><div><div className="field-pair">{[0, 1].map((index) => <Field label={`Шкала ${index + 1}`} key={index}><select value={result.scaleIds[index]} onChange={(event) => { const pair: [string, string] = [...result.scaleIds]; pair[index] = event.target.value; onChange({ scaleIds: pair }) }}>{test.scales.map((scale) => <option value={scale.id} key={scale.id}>{scale.name}</option>)}</select></Field>)}</div><ResultTextFields document={document} result={result} onChange={onChange} /><button className="button danger-outline" onClick={() => { if (confirm('Удалить комбинированный результат?')) onDelete() }}><Trash2 size={14} /> Удалить комбинацию</button></div></details>
}

function ResultTextFields({ document, result, onChange }: { document: FunnelDocument; result: TestResult | CombinedTestResult; onChange: (changes: never) => void }) {
  return <><Field label="Название"><input value={result.name} onChange={(event) => onChange({ name: event.target.value } as never)} /></Field><Field label="Короткий текст"><textarea rows={2} value={result.shortText} onChange={(event) => onChange({ shortText: event.target.value } as never)} /></Field><Field label="Полный текст"><textarea rows={5} value={result.fullText} onChange={(event) => onChange({ fullText: event.target.value } as never)} /></Field><Field label="Рекомендации"><textarea rows={4} value={result.recommendations} onChange={(event) => onChange({ recommendations: event.target.value } as never)} /></Field><Field label="Связанный материал"><select value={result.assetId ?? ''} onChange={(event) => onChange({ assetId: event.target.value || undefined } as never)}><option value="">Без материала</option>{document.assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}</select></Field><ResultButtons buttons={result.buttons} products={document.products} onChange={(buttons) => onChange({ buttons } as never)} /></>
}

function ResultButtons({ buttons, products, onChange }: { buttons: ResultButton[]; products: Product[]; onChange: (buttons: ResultButton[]) => void }) {
  return <div><div className="section-label"><span>Кнопки после результата</span><b>{buttons.length}</b></div>{buttons.map((button) => <div className="result-button-row" key={button.id}><input value={button.text} onChange={(event) => onChange(buttons.map((item) => item.id === button.id ? { ...item, text: event.target.value } : item))} /><select value={button.action} onChange={(event) => onChange(buttons.map((item) => item.id === button.id ? { ...item, action: event.target.value as ResultButton['action'] } : item))}><option value="branch">Следующая ветка</option><option value="url">Ссылка</option><option value="product">Продукт</option></select>{button.action === 'product' && <select value={button.productId ?? ''} onChange={(event) => onChange(buttons.map((item) => item.id === button.id ? { ...item, productId: event.target.value } : item))}>{products.map((product) => <option value={product.id} key={product.id}>{product.name}</option>)}</select>}<button className="mini-icon danger" onClick={() => onChange(buttons.filter((item) => item.id !== button.id))}><Trash2 size={14} /></button></div>)}<button className="text-button" onClick={() => onChange([...buttons, { id: newId('result_button'), text: 'Подробнее', action: 'branch' }])}><Plus size={14} /> Добавить кнопку</button></div>
}

function TestCalculator({ test }: { test: FunnelTest }) {
  const [answers, setAnswers] = useState<Record<string, string | string[] | number>>({})
  const [result, setResult] = useState<ReturnType<typeof calculateTestResult> | null>(null)
  const active = test.questions.filter((question) => question.enabled)
  return <div className="calculator-card"><div className="friendly-note">Пройдите тест вручную. Ниже будут показаны баллы, динамический максимум, проценты и причина выбора результата.</div>{active.map((question, index) => <Field key={question.id} label={`${index + 1}. ${question.text}`}>{question.type === 'multiple' ? <div className="calculator-options">{question.answers.map((answer) => { const current = answers[question.id] as string[] | undefined; return <label key={answer.id}><input type="checkbox" checked={current?.includes(answer.id) ?? false} onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.checked ? [...(current ?? []), answer.id] : (current ?? []).filter((id) => id !== answer.id) })} />{answer.text}</label> })}</div> : ['single', 'scale'].includes(question.type) ? <select value={String(answers[question.id] ?? '')} onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })}><option value="">Выберите ответ</option>{question.answers.map((answer) => <option value={answer.id} key={answer.id}>{answer.text}</option>)}</select> : <input type={question.type === 'number' ? 'number' : 'text'} value={String(answers[question.id] ?? '')} onChange={(event) => setAnswers({ ...answers, [question.id]: question.type === 'number' ? Number(event.target.value) : event.target.value })} />}</Field>)}<div className="heading-actions"><button className="button primary" onClick={() => { try { setResult(calculateTestResult(test, answers)) } catch (error) { alert(error instanceof Error ? error.message : 'Не удалось рассчитать результат') } }}>Рассчитать результат</button><button className="button secondary" onClick={() => { setAnswers({}); setResult(null) }}><RotateCcw size={15} /> Начать заново</button></div>{result && <div className="calculation-result"><h3>{result.combined?.name ?? result.primary.name}</h3><p>{result.explanation}</p><div className="percentage-list">{test.scales.map((scale) => <div key={scale.id}><span><i style={{ background: scale.color }} />{scale.name}</span><strong>{result.scores[scale.id]} / {result.maximums[scale.id]} · {result.percentages[scale.id].toFixed(1)}%</strong></div>)}</div></div>}</div>
}

function MediaSection({ document }: { document: FunnelDocument }) {
  const updateDocument = useEditorStore((state) => state.updateDocument)
  const [selectedId, setSelectedId] = useState(document.assets[0]?.id ?? '')
  const selected = document.assets.find((asset) => asset.id === selectedId)
  const patch = (changes: Partial<MediaAsset>) => updateDocument((draft) => { const asset = draft.assets.find((item) => item.id === selectedId); if (asset) Object.assign(asset, changes) })
  const add = () => {
    const asset: MediaAsset = { id: newId('asset'), key: `asset_${crypto.randomUUID().slice(0, 8)}`, name: 'Новый материал', type: 'image', required: false, logicalRef: '' }
    updateDocument((draft) => { draft.assets.push(asset) }); setSelectedId(asset.id)
  }
  return <><PageHeading eyebrow="Каталог" title="Медиа" text="Конструктор хранит место файла в сценарии. Сам файл позднее загружается отдельно в Telegram-боте." action={<button className="button primary" onClick={add}><Plus size={16} /> Добавить материал</button>} /><div className="catalog-layout"><aside className="catalog-list">{document.assets.map((asset) => <button className={selectedId === asset.id ? 'active' : ''} key={asset.id} onClick={() => setSelectedId(asset.id)}><span className="catalog-icon"><FileImage size={16} /></span><span><strong>{asset.name}</strong><small>{mediaLabel(asset.type)} · {assetUsageCount(document, asset.id)} использований</small></span><ChevronRight size={14} /></button>)}</aside><section className="entity-editor">{selected ? <><div className="entity-title-row"><div><span className="eyebrow">Материал</span><h2>{selected.name}</h2></div></div><div className="form-grid"><Field label="Название"><input value={selected.name} onChange={(event) => patch({ name: event.target.value })} /></Field><Field label="Тип"><select value={selected.type} onChange={(event) => patch({ type: event.target.value as MediaAsset['type'] })}>{(['image', 'video', 'audio', 'voice', 'video_note', 'document', 'animation'] as const).map((type) => <option value={type} key={type}>{mediaLabel(type)}</option>)}</select></Field><Field label="Логическая ссылка"><input value={selected.logicalRef} placeholder="Будет заполнено при подключении бота" onChange={(event) => patch({ logicalRef: event.target.value })} /></Field><Toggle checked={selected.required} onChange={(required) => patch({ required })} label="Обязательный материал" /></div><div className={`asset-state ${selected.logicalRef ? 'complete' : ''}`}>{selected.logicalRef ? 'Логическая ссылка заполнена' : 'Ссылка пока не заполнена — это допустимо до подключения бота'}</div><button className="button danger-outline" disabled={assetUsageCount(document, selected.id) > 0} onClick={() => { if (!confirm(`Удалить материал «${selected.name}»?`)) return; updateDocument((draft) => { draft.assets = draft.assets.filter((asset) => asset.id !== selected.id) }); setSelectedId('') }}><Trash2 size={14} /> {assetUsageCount(document, selected.id) ? `Используется в ${assetUsageCount(document, selected.id)} местах` : 'Удалить материал'}</button></> : <Empty title="Материал не выбран" text="Добавьте материал или выберите его слева." />}</section></div></>
}

function ProductsSection({ document }: { document: FunnelDocument }) {
  const updateDocument = useEditorStore((state) => state.updateDocument)
  const [selectedId, setSelectedId] = useState(document.products[0]?.id ?? '')
  const selected = document.products.find((product) => product.id === selectedId)
  const patch = (changes: Partial<Product>) => updateDocument((draft) => { const product = draft.products.find((item) => item.id === selectedId); if (product) Object.assign(product, changes) })
  const add = () => {
    const product: Product = { id: newId('product'), key: `product_${crypto.randomUUID().slice(0, 8)}`, name: 'Новый продукт', description: '', price: 0, active: true, afterPurchaseText: 'Спасибо за покупку!' }
    updateDocument((draft) => { draft.products.push(product) }); setSelectedId(product.id)
  }
  return <><PageHeading eyebrow="Предложения" title="Продукты" text="Цена и содержание предложения. Реальная оплата пока только моделируется в предпросмотре." action={<button className="button primary" onClick={add}><Plus size={16} /> Добавить продукт</button>} /><div className="catalog-layout"><aside className="catalog-list">{document.products.map((product) => <button className={selectedId === product.id ? 'active' : ''} key={product.id} onClick={() => setSelectedId(product.id)}><span className="catalog-icon"><Package size={16} /></span><span><strong>{product.name}</strong><small>{money(product.price)} · {product.active ? 'Активен' : 'Выключен'}</small></span><ChevronRight size={14} /></button>)}</aside><section className="entity-editor">{selected ? <><Field label="Название"><input value={selected.name} onChange={(event) => patch({ name: event.target.value })} /></Field><Field label="Описание"><textarea rows={5} value={selected.description} onChange={(event) => patch({ description: event.target.value })} /></Field><div className="form-grid"><Field label="Цена, ₽"><input type="number" min="0" value={selected.price} onChange={(event) => patch({ price: Math.max(0, Number(event.target.value)) })} /></Field><Toggle checked={selected.active} onChange={(active) => patch({ active })} label="Продукт активен" /><Field label="Материал после оплаты"><select value={selected.assetId ?? ''} onChange={(event) => patch({ assetId: event.target.value || undefined })}><option value="">Без материала</option>{document.assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}</select></Field></div><Field label="Текст после покупки"><textarea rows={4} value={selected.afterPurchaseText} onChange={(event) => patch({ afterPurchaseText: event.target.value })} /></Field><div className="friendly-note">Продукт предлагается в {productUsageCount(document, selected.id)} местах воронки.</div><button className="button danger-outline" disabled={productUsageCount(document, selected.id) > 0} onClick={() => { if (!confirm(`Удалить продукт «${selected.name}»?`)) return; updateDocument((draft) => { draft.products = draft.products.filter((product) => product.id !== selected.id) }); setSelectedId('') }}><Trash2 size={14} /> Удалить продукт</button></> : <Empty title="Продукт не выбран" text="Добавьте продукт или выберите его слева." />}</section></div></>
}

function BotSection({ document }: { document: FunnelDocument }) {
  const updateDocument = useEditorStore((state) => state.updateDocument)
  const bot = document.bot
  const update = (run: (draft: FunnelDocument['bot']) => void) => updateDocument((draft) => run(draft.bot))
  const addLink = () => {
    const code = uniqueTrackingCode(document, 'source', 'campaign')
    const link: TrackingLink = { id: newId('tracking'), name: 'Новая отслеживаемая ссылка', code, source: 'source', campaign: 'campaign', active: true }
    update((draft) => { draft.trackingLinks.push(link) })
  }
  return <><PageHeading eyebrow="Telegram" title="Настройки бота" text="Здесь нет токена и секретов — только поведение будущего Telegram-бота." /><div className="settings-stack">
    <EditorGroup title="Основные параметры"><div className="form-grid"><Field label="Отображаемое название"><input value={bot.displayName} onChange={(event) => update((draft) => { draft.displayName = event.target.value })} /></Field><Field label="Username будущего бота"><div className="input-with-prefix"><span>@</span><input value={bot.username.replace(/^@/, '')} placeholder="my_funnel_bot" onChange={(event) => update((draft) => { draft.username = event.target.value.replace(/^@/, '') })} /></div></Field><Field label="Часовой пояс"><input value={bot.timezone} onChange={(event) => update((draft) => { draft.timezone = event.target.value })} /></Field><Field label="Неактивность, дней"><input type="number" min="1" value={bot.inactivityDays} onChange={(event) => update((draft) => { draft.inactivityDays = Math.max(1, Number(event.target.value)) })} /></Field></div></EditorGroup>
    <EditorGroup title="Тихие часы"><div className="form-grid"><Toggle checked={bot.quietHours.enabled} onChange={(enabled) => update((draft) => { draft.quietHours.enabled = enabled })} label="Тихие часы включены" /><Field label="Не отправлять с"><input type="time" value={bot.quietHours.from} onChange={(event) => update((draft) => { draft.quietHours.from = event.target.value })} /></Field><Field label="До"><input type="time" value={bot.quietHours.to} onChange={(event) => update((draft) => { draft.quietHours.to = event.target.value })} /></Field><Field label="Если сообщение попало в тихие часы"><select value={bot.quietHours.behavior} onChange={(event) => update((draft) => { draft.quietHours.behavior = event.target.value as 'postpone' | 'skip' })}><option value="postpone">Перенести на время окончания</option><option value="skip">Не отправлять</option></select></Field></div></EditorGroup>
    <EditorGroup title="Повторный вход"><div className="choice-cards">{([['continue', 'Продолжить с места остановки'], ['restart', 'Начать заново'], ['show_result', 'Показать последний результат']] as const).map(([value, label]) => <label className={bot.reentryPolicy === value ? 'active' : ''} key={value}><input type="radio" checked={bot.reentryPolicy === value} onChange={() => update((draft) => { draft.reentryPolicy = value })} /><strong>{label}</strong></label>)}</div></EditorGroup>
    <EditorGroup title="Отписка"><div className="form-grid"><Field label="Команда"><input value={bot.optOut.command} onChange={(event) => update((draft) => { draft.optOut.command = event.target.value })} /></Field><Field label="Текст подтверждения"><textarea rows={3} value={bot.optOut.confirmationText} onChange={(event) => update((draft) => { draft.optOut.confirmationText = event.target.value })} /></Field><Toggle checked={bot.optOut.blockBackground} onChange={(blockBackground) => update((draft) => { draft.optOut.blockBackground = blockBackground })} label="Не отправлять фоновые сообщения" /><Toggle checked={bot.optOut.allowRestart} onChange={(allowRestart) => update((draft) => { draft.optOut.allowRestart = allowRestart })} label="Разрешить вернуться через новый /start" /></div></EditorGroup>
    <EditorGroup title="Напоминания"><div className="form-grid"><Field label="Максимальное число"><input type="number" min="0" value={bot.reminders.maxCount} onChange={(event) => update((draft) => { draft.reminders.maxCount = Math.max(0, Number(event.target.value)) })} /></Field><Toggle checked={bot.reminders.cancelAfterContinue} onChange={(cancelAfterContinue) => update((draft) => { draft.reminders.cancelAfterContinue = cancelAfterContinue })} label="Не отправлять после продолжения" /><Toggle checked={bot.reminders.respectQuietHours} onChange={(respectQuietHours) => update((draft) => { draft.reminders.respectQuietHours = respectQuietHours })} label="Учитывать тихие часы" /></div></EditorGroup>
    <EditorGroup title="Ссылки и источники" action={<button className="button secondary" onClick={addLink}><Plus size={15} /> Создать ссылку</button>}><p className="panel-help">Ссылки помогают будущему боту сохранить источник пользователя и связать с ним результат, заявку и оплату.</p><div className="tracking-list">{bot.trackingLinks.map((link) => <TrackingLinkEditor key={link.id} document={document} link={link} />)}{!bot.trackingLinks.length && <Empty title="Ссылок пока нет" text="Создайте ссылку для рекламы, публикации или партнёрского канала." />}</div></EditorGroup>
  </div></>
}

function TrackingLinkEditor({ document, link }: { document: FunnelDocument; link: TrackingLink }) {
  const updateDocument = useEditorStore((state) => state.updateDocument)
  const patch = (changes: Partial<TrackingLink>) => updateDocument((draft) => { const target = draft.bot.trackingLinks.find((item) => item.id === link.id); if (target) Object.assign(target, changes) })
  const fullLink = telegramDeepLink(document.bot.username, link.code)
  return <article className="tracking-card"><div className="tracking-card-head"><Link2 size={18} /><input value={link.name} onChange={(event) => patch({ name: event.target.value })} /><Toggle checked={link.active} onChange={(active) => patch({ active })} label={link.active ? 'Активна' : 'Выключена'} /></div><div className="form-grid"><Field label="Источник"><input value={link.source} onChange={(event) => patch({ source: event.target.value })} /></Field><Field label="Кампания"><input value={link.campaign} onChange={(event) => patch({ campaign: event.target.value })} /></Field><Field label="Метка контента"><input value={link.content ?? ''} onChange={(event) => patch({ content: event.target.value || undefined })} /></Field></div><div className="generated-link"><span>{fullLink ? 'Готовая Telegram-ссылка' : 'Код ссылки'}</span><code>{fullLink ?? link.code}</code><button onClick={async () => { await navigator.clipboard.writeText(fullLink ?? link.code) }}><Copy size={14} /> Копировать</button></div>{!fullLink && <p className="panel-help">Укажите username бота выше — после этого появится полная ссылка.</p>}<button className="text-button danger" onClick={() => { if (!confirm(`Удалить ссылку «${link.name}»?`)) return; updateDocument((draft) => { draft.bot.trackingLinks = draft.bot.trackingLinks.filter((item) => item.id !== link.id) }) }}><Trash2 size={14} /> Удалить ссылку</button></article>
}

function createScale(index: number): TestScale { return { id: newId('scale'), code: `S${index}`, name: `Шкала ${index}`, color: ['#7c5ce7', '#2f80ed', '#f2994a', '#27ae60'][index % 4] } }
function createQuestion(scales: TestScale[]): TestQuestion { return { id: newId('question'), text: 'Новый вопрос', type: 'single', enabled: true, required: true, shuffleAnswers: false, answers: ['Вариант A', 'Вариант B'].map((text) => ({ id: newId('answer'), text, scores: Object.fromEntries(scales.map((scale) => [scale.id, 0])) })) } }
function createResult(scale: TestScale): TestResult { return { id: newId('result'), scaleId: scale.id, name: scale.name, shortText: '', fullText: '', recommendations: '', buttons: [] } }
function swap<T>(items: T[], left: number, right: number) { const copy = [...items]; [copy[left], copy[right]] = [copy[right], copy[left]]; return copy }
function questionTypeLabel(type: QuestionType) { return ({ single: 'Один вариант', multiple: 'Несколько вариантов', scale: 'Числовая шкала', number: 'Число', text: 'Свободный текст' } as const)[type] }
function mediaLabel(type: string) { return ({ image: 'Изображение', video: 'Видео', audio: 'Аудио', voice: 'Голосовое сообщение', video_note: 'Видеокружок', document: 'Документ / PDF', animation: 'Анимация' } as Record<string, string>)[type] ?? type }
function money(value: number) { return `${new Intl.NumberFormat('ru-RU').format(value)} ₽` }
function PageHeading({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: React.ReactNode }) { return <div className="workspace-page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>{action}</div> }
function EditorGroup({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) { return <section className="settings-group"><div className="settings-group-title"><h3>{title}</h3>{action}</div>{children}</section> }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label> }
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) { return <label className="toggle-row"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><strong>{label}</strong></span></label> }
function Empty({ title, text }: { title: string; text: string }) { return <div className="entity-empty"><Beaker size={28} /><strong>{title}</strong><p>{text}</p></div> }
