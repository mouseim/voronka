import {
  Bug, CheckCircle2, ChevronRight, Clock3, ExternalLink, FileAudio, FileImage,
  FileText, Film, PackageCheck, Play, RotateCcw, Send, Video, X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { getRuntimeValue } from '../model/expressions'
import { mediaNodeAsset, nodeTitle } from '../model/funnel'
import {
  createSimulatorState, currentSimulatorNode, performSimulationAction, scenarioAssertions,
  simulatorText, type SimulationAction, type SimulatorState,
} from '../model/simulator'
import type {
  ChoiceData, ConsentData, FormData, FunnelDocument, FunnelNode, MediaData, MessageData,
  ProductBlockData, QuestionData, ResultBlockData, TestBlockData, TestQuestion, VariableValue,
} from '../model/types'
import { nodeMeta } from './nodeMeta'

interface PreviewProps { document: FunnelDocument; onClose: () => void }

export function Preview({ document, onClose }: PreviewProps) {
  const [scenarioId, setScenarioId] = useState(document.testScenarios[0]?.id ?? '')
  const selectedScenario = document.testScenarios.find((scenario) => scenario.id === scenarioId)
  const [state, setState] = useState(() => createSimulatorState(document, selectedScenario))
  const [debug, setDebug] = useState(false)
  const [testAnswers, setTestAnswers] = useState<Record<string, VariableValue>>(() => structuredClone(selectedScenario?.answers ?? {}))
  const current = currentSimulatorNode(document, state)
  const assertions = scenarioAssertions(state)

  const act = (action?: SimulationAction) => setState((value) => performSimulationAction(document, { ...value, status: value.status === 'blocked' ? 'running' : value.status }, action))
  const restart = (nextScenarioId = scenarioId) => {
    const scenario = document.testScenarios.find((item) => item.id === nextScenarioId)
    setScenarioId(nextScenarioId)
    setState(createSimulatorState(document, scenario))
    setTestAnswers(structuredClone(scenario?.answers ?? {}))
  }

  return (
    <div className="modal-backdrop preview-backdrop">
      <section className={`preview-shell ${debug ? 'with-debug' : ''}`} role="dialog" aria-modal="true" aria-label="Симулятор воронки">
        <header className="preview-header">
          <div className="preview-avatar">В</div>
          <div><strong>{document.funnel.name}</strong><span>симулятор · версия {document.funnel.version}</span></div>
          {document.testScenarios.length > 0 && <select aria-label="Тестовый сценарий" value={scenarioId} onChange={(event) => restart(event.target.value)}><option value="">Без сценария</option>{document.testScenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}</select>}
          <button className={`icon-button ${debug ? 'active' : ''}`} onClick={() => setDebug(!debug)} title="Режим отладки"><Bug size={18} /></button>
          <button className="icon-button" onClick={() => restart()} title="Начать заново"><RotateCcw size={18} /></button>
          <button className="icon-button" onClick={onClose} title="Закрыть"><X size={20} /></button>
        </header>
        <div className="preview-layout">
          <div className="preview-chat">
            <div className="preview-date">Локальная симуляция · внешние действия не выполняются</div>
            {state.history.filter((item) => item.kind !== 'debug').map((item) => <div key={item.id} className={`chat-bubble ${item.kind}`}>{item.text}</div>)}
            {current ? <CurrentStep document={document} node={current} state={state} act={act} testAnswers={testAnswers} setTestAnswers={setTestAnswers} /> : <div className="preview-error"><strong>Блок не найден</strong><span>{state.currentNodeId}</span></div>}
            {state.error && <div className="preview-error"><strong>Симуляция остановлена</strong><span>{state.error}</span><small>Исправьте данные шага или связь и повторите действие.</small></div>}
            {state.status === 'completed' && <Completion state={state} assertions={assertions} onRestart={() => restart()} />}
          </div>
          {debug && <DebugPanel document={document} state={state} assertions={assertions} />}
        </div>
      </section>
    </div>
  )
}

function CurrentStep({ document, node, state, act, testAnswers, setTestAnswers }: {
  document: FunnelDocument
  node: FunnelNode
  state: SimulatorState
  act: (action?: SimulationAction) => void
  testAnswers: Record<string, VariableValue>
  setTestAnswers: (value: Record<string, VariableValue>) => void
}) {
  if (state.status === 'completed' || state.status === 'error') return null
  if (node.type === 'start') return <div className="chat-card start-card"><span>Точка входа · {String(node.data.entryKey)}</span><strong>{nodeTitle(node)}</strong><button onClick={() => act()}><Play size={15} /> Начать симуляцию</button></div>

  if (node.type === 'message') {
    const data = node.data as MessageData
    return <><div className="chat-bubble bot">{simulatorText(data.text, state)}</div><div className="chat-actions">{data.buttons.map((button) => <button key={button.id} onClick={() => act({ handle: button.id, label: button.text })}>{button.text || 'Без текста'}{button.action === 'url' && <ExternalLink size={14} />}</button>)}{data.continueWithoutButton && <button onClick={() => act()}>Продолжить</button>}</div></>
  }

  if (node.type === 'choice') return <ChoiceStep data={node.data as ChoiceData} act={act} />
  if (node.type === 'question') return <QuestionStep data={node.data as QuestionData} act={act} />

  if (node.type === 'test') {
    const data = node.data as TestBlockData
    const test = document.tests.find((candidate) => candidate.id === data.testId)
    if (!test) return <div className="preview-error">Тест не найден</div>
    return <div className="test-preview"><div className="chat-bubble bot"><strong>{test.name}</strong><br />{data.welcomeText}</div>{test.questions.filter((question) => question.enabled).map((question, index) => <TestQuestionField key={question.id} question={question} index={index} value={testAnswers[question.id]} onChange={(value) => setTestAnswers({ ...testAnswers, [question.id]: value })} />)}<button className="preview-submit" onClick={() => act({ handle: 'completed', answers: testAnswers })}>Рассчитать результат <ChevronRight size={16} /></button></div>
  }

  if (['timer', 'wait_until', 'reminder'].includes(node.type)) {
    const label = node.type === 'wait_until' ? `до ${String(node.data.time ?? node.data.dateTime ?? 'указанного времени')}` : `на ${String(node.data.duration ?? 0)} ${unitText(String(node.data.unit ?? ''))}`
    return <div className="chat-card timer-card"><Clock3 size={24} /><strong>{nodeTitle(node)}</strong><p>В реальном боте выполнение будет отложено {label}. В симуляторе изменится виртуальное время.</p><button onClick={() => act()}>Перемотать время</button></div>
  }

  if (node.type === 'media') {
    const data = node.data as MediaData
    const asset = mediaNodeAsset(node, document)
    const mediaType = data.expectedType ?? asset?.expectedType ?? 'document'
    const Icon = mediaIcon(mediaType)
    return <><div className="media-placeholder"><Icon size={36} /><span>{mediaTypeText(mediaType)}</span><strong>{data.displayName || asset?.displayName || 'Будущий файл'}</strong><code>{data.assetKey || asset?.assetKey || 'ресурс не выбран'}</code></div>{data.caption && <div className="chat-bubble bot">{simulatorText(data.caption, state)}</div>}<div className="chat-actions"><button onClick={() => act()}>Продолжить</button></div></>
  }

  if (node.type === 'form') return <FormStep data={node.data as FormData} act={act} />
  if (node.type === 'consent') {
    const data = node.data as ConsentData
    return <><div className="chat-bubble bot">{data.text}{data.policyUrl && <><br /><a href={data.policyUrl} target="_blank" rel="noreferrer">Политика обработки данных</a></>}</div><div className="chat-actions"><button onClick={() => act({ handle: 'accepted' })}>{data.acceptText}</button>{data.declineEnabled && <button className="secondary" onClick={() => act({ handle: 'declined' })}>{data.declineText}</button>}</div></>
  }

  if (node.type === 'result') {
    const data = node.data as ResultBlockData
    const result = getRuntimeValue(state.values, 'result.main') as Record<string, unknown> | undefined
    const secondary = getRuntimeValue(state.values, 'result.secondary') as Record<string, unknown> | undefined
    return <div className="result-preview"><span className="eyebrow">Персональный результат</span><h2>{String(result?.title ?? 'Результат не определён')}</h2><p>{String(result?.text ?? simulatorText(data.singleTemplate, state))}</p>{Array.isArray(result?.recommendations) && <ul>{result.recommendations.map((item, index) => <li key={index}>{String(item)}</li>)}</ul>}{Boolean(secondary?.title) && <div className="secondary-result"><strong>Дополнительный механизм</strong><span>{String(secondary?.title)}</span></div>}<button className="preview-submit" onClick={() => act()}>Продолжить <ChevronRight size={16} /></button></div>
  }

  if (node.type === 'product') {
    const data = node.data as ProductBlockData
    return <div className="product-preview"><PackageCheck size={30} /><span className="eyebrow">Демо оплаты</span><h2>{data.headline}</h2><p>{data.description}</p><strong>{data.displayPrice}</strong><button onClick={() => act({ paymentOutcome: 'success' })}>{data.payButtonText}</button><button className="secondary" onClick={() => act({ paymentOutcome: 'failure' })}>Смоделировать ошибку</button>{data.allowSkip && <button className="link-button" onClick={() => act({ paymentOutcome: 'skip' })}>Продолжить без покупки</button>}<small>Платёж не выполняется: вы выбираете тестовый исход.</small></div>
  }

  if (node.type === 'external_link') return <div className="chat-card"><ExternalLink size={24} /><strong>{nodeTitle(node)}</strong><p>{String(node.data.url)}</p><button onClick={() => act()}>{String(node.data.buttonText || 'Открыть')}</button><small>Внешняя страница в симуляции не открывается.</small></div>
  if (node.type === 'sub_funnel') return <div className="chat-card"><Send size={24} /><strong>Переход в другую воронку</strong><p>{String(node.data.targetFunnelKey)} · {String(node.data.targetEntryKey)}</p><button onClick={() => act()}>Смоделировать переход</button></div>
  if (node.type === 'end') return null
  return <div className="chat-card"><strong>{nodeTitle(node)}</strong><button onClick={() => act()}>Продолжить</button></div>
}

function ChoiceStep({ data, act }: { data: ChoiceData; act: (action?: SimulationAction) => void }) {
  const [selected, setSelected] = useState<string[]>([])
  if (data.selectionMode === 'single') return <><div className="chat-bubble bot">{data.prompt}</div><div className="chat-actions">{data.options.filter((item) => item.enabled !== false).map((option) => <button key={option.id} onClick={() => act({ handle: option.id, value: option.id, label: option.text })}>{option.text || 'Без текста'}</button>)}</div></>
  const toggle = (id: string) => setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id].slice(0, data.maxSelected))
  return <div className="multi-choice-preview"><div className="chat-bubble bot">{data.prompt}</div>{data.options.filter((item) => item.enabled !== false).map((option) => <label key={option.id}><input type="checkbox" checked={selected.includes(option.id)} onChange={() => toggle(option.id)} /> {option.text}</label>)}<button disabled={selected.length < data.minSelected} onClick={() => act({ handle: data.sharedTransition ? 'confirmed' : selected[0], value: selected, label: selected.join(', ') })}>{data.confirmText}</button></div>
}

function QuestionStep({ data, act }: { data: QuestionData; act: (action?: SimulationAction) => void }) {
  const [value, setValue] = useState<VariableValue>(data.inputType === 'multiple_choice' ? [] : '')
  if (['single_choice', 'yes_no'].includes(data.inputType)) return <><div className="chat-bubble bot">{data.question}</div><div className="chat-actions">{data.answers.filter((item) => item.enabled !== false).map((answer) => <button key={answer.id} onClick={() => act({ handle: answer.id, value: answer.id, label: answer.text })}>{answer.text || 'Без текста'}</button>)}</div></>
  if (data.inputType === 'multiple_choice') {
    const selected = Array.isArray(value) ? value.map(String) : []
    return <div className="multi-choice-preview"><div className="chat-bubble bot">{data.question}</div>{data.answers.map((answer) => <label key={answer.id}><input type="checkbox" checked={selected.includes(answer.id)} onChange={() => setValue(selected.includes(answer.id) ? selected.filter((id) => id !== answer.id) : [...selected, answer.id])} /> {answer.text}</label>)}<button onClick={() => act({ handle: data.answers.find((answer) => selected.includes(answer.id))?.id, value })}>Отправить</button></div>
  }
  return <div className="question-input-preview"><div className="chat-bubble bot">{data.question}</div>{data.inputType === 'long_text' ? <textarea value={String(value)} placeholder={data.placeholder} onChange={(event) => setValue(event.target.value)} /> : <input type={['integer', 'number', 'scale'].includes(data.inputType) ? 'number' : data.inputType === 'email' ? 'email' : data.inputType === 'date' ? 'date' : data.inputType === 'time' ? 'time' : 'text'} value={String(value)} placeholder={data.placeholder} min={data.minValue} max={data.maxValue} onChange={(event) => setValue(['integer', 'number', 'scale'].includes(data.inputType) ? Number(event.target.value) : event.target.value)} />}<button onClick={() => act({ handle: 'success', value })}>Отправить</button></div>
}

function TestQuestionField({ question, index, value, onChange }: { question: TestQuestion; index: number; value?: VariableValue; onChange: (value: VariableValue) => void }) {
  if (question.type === 'text' || question.type === 'number' || question.type === 'scale') return <fieldset className="test-question"><legend><span>{index + 1}</span>{question.text}</legend><input type={question.type === 'text' ? 'text' : 'number'} min={question.min} max={question.max} value={String(value ?? '')} onChange={(event) => onChange(question.type === 'text' ? event.target.value : Number(event.target.value))} /></fieldset>
  const selected = Array.isArray(value) ? value.map(String) : [String(value ?? '')]
  return <fieldset className="test-question"><legend><span>{index + 1}</span>{question.text}</legend>{question.answers.filter((answer) => answer.enabled !== false).map((answer) => <label key={answer.id}><input type={question.type === 'multiple' ? 'checkbox' : 'radio'} name={question.id} checked={selected.includes(answer.id)} onChange={() => onChange(question.type === 'multiple' ? (selected.includes(answer.id) ? selected.filter((id) => id !== answer.id) : [...selected.filter(Boolean), answer.id]) : answer.id)} /> {answer.text}</label>)}</fieldset>
}

function FormStep({ data, act }: { data: FormData; act: (action?: SimulationAction) => void }) {
  const [values, setValues] = useState<Record<string, VariableValue>>({})
  return <div className="form-preview"><div className="chat-bubble bot"><strong>{data.title}</strong><br />{data.description}</div>{data.fields.filter((field) => field.type !== 'hidden').map((field) => <label key={field.id}><span>{field.label}{field.required && ' *'}</span>{field.type === 'long_text' ? <textarea value={String(values[field.id] ?? '')} placeholder={field.placeholder} onChange={(event) => setValues({ ...values, [field.id]: event.target.value })} /> : field.type === 'checkbox' || field.type === 'consent' ? <input type="checkbox" checked={Boolean(values[field.id])} onChange={(event) => setValues({ ...values, [field.id]: event.target.checked })} /> : <input type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} value={String(values[field.id] ?? '')} placeholder={field.placeholder} onChange={(event) => setValues({ ...values, [field.id]: field.type === 'number' ? Number(event.target.value) : event.target.value })} />}</label>)}<button className="preview-submit" onClick={() => act({ handle: 'success', values })}>{data.submitText}</button></div>
}

function DebugPanel({ document, state, assertions }: { document: FunnelDocument; state: SimulatorState; assertions: ReturnType<typeof scenarioAssertions> }) {
  const current = currentSimulatorNode(document, state)
  return <aside className="debug-panel"><div className="debug-title"><Bug size={17} /><strong>Отладка</strong><span>{state.stepCount} шагов</span></div><section><h4>Текущий блок</h4><code>{current?.id ?? state.currentNodeId}</code><small>{current ? nodeMeta[current.type].label : 'не найден'}</small></section><section><h4>Виртуальное время</h4><code>{state.virtualNow}</code></section><section><h4>Переменные</h4><div className="debug-values">{Object.entries(state.values).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => <div key={key}><b>{key}</b><code>{printValue(value)}</code></div>)}</div></section><section><h4>Шкалы</h4>{Object.keys(state.scores).length ? Object.entries(state.scores).map(([key, score]) => <div className="score-debug" key={key}><span>{key}</span><strong>{score.normalized || score.raw}</strong><i style={{ width: `${Math.min(100, score.normalized || score.raw * 10)}%` }} /></div>) : <small>Баллов пока нет</small>}</section>{assertions.length > 0 && <section><h4>Ожидания сценария</h4>{assertions.map((assertion) => <div className={`assertion ${assertion.passed ? 'passed' : 'failed'}`} key={assertion.label}>{assertion.passed ? '✓' : '○'} {assertion.label}<small>{printValue(assertion.actual)} / {printValue(assertion.expected)}</small></div>)}</section>}<section><h4>Журнал переходов</h4><div className="debug-log">{state.history.filter((item) => item.kind === 'debug' || item.kind === 'error').map((item) => <div key={item.id}><span>{item.kind === 'error' ? '!' : '›'}</span>{item.text}</div>)}</div></section></aside>
}

function Completion({ state, assertions, onRestart }: { state: SimulatorState; assertions: ReturnType<typeof scenarioAssertions>; onRestart: () => void }) {
  const allPassed = assertions.length === 0 || assertions.every((item) => item.passed)
  return <div className="chat-card finish-card"><CheckCircle2 size={32} /><strong>Воронка завершена</strong><p>{state.resultCode ? `Результат: ${state.resultCode}` : 'Сценарий дошёл до финального блока.'}</p>{assertions.length > 0 && <span className={allPassed ? 'success-text' : 'warning-text'}>{allPassed ? 'Все ожидания сценария выполнены' : 'Часть ожиданий не совпала'}</span>}<button onClick={onRestart}><RotateCcw size={15} /> Пройти ещё раз</button></div>
}

function unitText(unit: string) { return ({ seconds: 'секунд', minutes: 'минут', hours: 'часов', days: 'дней' } as Record<string, string>)[unit] ?? unit }
function mediaTypeText(type: string) { return ({ image: 'Изображение', video: 'Видео', audio: 'Аудио', voice: 'Голосовое сообщение', video_note: 'Видеокружок', document: 'Документ', animation: 'Анимация' } as Record<string, string>)[type] ?? type }
function mediaIcon(type: string) { return type === 'image' ? FileImage : type === 'video' || type === 'animation' ? Film : type === 'audio' || type === 'voice' ? FileAudio : type === 'video_note' ? Video : FileText }
function printValue(value: unknown) { if (value === undefined) return '—'; if (typeof value === 'object') { try { const text = JSON.stringify(value); return text.length > 140 ? `${text.slice(0, 137)}…` : text } catch { return '[object]' } } return String(value) }
