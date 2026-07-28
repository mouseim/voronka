import { ArrowLeft, CheckCircle2, Clock3, FileImage, RotateCcw, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { nodeTitle } from '../model/funnel'
import { calculateTestResult } from '../model/scoring'
import { nextNodeId } from '../model/simulator'
import type {
  ConsentData,
  ExternalLinkData,
  FormData,
  FunnelDocument,
  MediaData,
  MessageData,
  ProductBlockData,
  TestBlockData,
  TimerData,
} from '../model/types'

export function Preview({ document, onClose }: { document: FunnelDocument; onClose: () => void }) {
  const [currentId, setCurrentId] = useState(document.funnel.startNodeId)
  const [history, setHistory] = useState<string[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [testAnswers, setTestAnswers] = useState<Record<string, string | string[] | number>>({})
  const [testResultId, setTestResultId] = useState<string | null>(null)
  const node = document.nodes.find((candidate) => candidate.id === currentId)
  const test = node?.type === 'test' ? document.tests.find((item) => item.id === (node.data as TestBlockData).testId) : undefined
  const calculation = useMemo(() => {
    if (!test || !testResultId) return null
    try { return calculateTestResult(test, testAnswers) } catch { return null }
  }, [test, testAnswers, testResultId])
  const go = (handle = 'next') => {
    if (!node) return
    const target = nextNodeId(document, node.id, handle)
    if (!target) return
    setHistory((items) => [...items, node.id])
    setCurrentId(target)
    setTestResultId(null)
  }
  const back = () => {
    const previous = history.at(-1)
    if (!previous) return
    setHistory((items) => items.slice(0, -1))
    setCurrentId(previous)
    setTestResultId(null)
  }
  const restart = () => {
    setCurrentId(document.funnel.startNodeId)
    setHistory([])
    setElapsed(0)
    setTestAnswers({})
    setTestResultId(null)
  }

  return (
    <div className="preview-overlay">
      <section className="preview-shell" role="dialog" aria-modal="true" aria-label="Предпросмотр воронки">
        <header className="preview-header"><div><span>Предпросмотр пути</span><strong>{document.funnel.name}</strong></div><div className="preview-time"><Clock3 size={14} /> +{elapsed} мин</div><button className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={19} /></button></header>
        <div className="phone-preview">
          <div className="phone-top"><span>{document.bot.displayName || 'Telegram-бот'}</span><small>демонстрационный режим</small></div>
          <div className="chat-area">
            {!node ? <PreviewNotice title="Переход не настроен" text="Вернитесь в схему и соедините этот выход со следующим этапом." /> : (
              <div className="preview-stage">
                <span className="preview-stage-name">{nodeTitle(node)}</span>
                {node.type === 'start' && <BotBubble text="Готовы начать?" />}
                {node.type === 'message' && <MessagePreview data={node.data as MessageData} onBranch={go} />}
                {node.type === 'media' && <MediaPreview document={document} data={node.data as MediaData} onNext={() => go()} />}
                {node.type === 'timer' && <TimerPreview data={node.data as TimerData} onNext={(minutes) => { setElapsed((value) => value + minutes); go() }} />}
                {node.type === 'test' && test && <TestPreview test={test} answers={testAnswers} setAnswers={setTestAnswers} calculation={calculation} onCalculate={() => { const result = calculateTestResult(test, testAnswers); setTestResultId(result.chosenResultId) }} onNext={(resultId) => go(resultId)} />}
                {node.type === 'test' && !test && <PreviewNotice title="Тест не выбран" text="Выберите тест в настройках блока." />}
                {node.type === 'form' && <FormPreview data={node.data as FormData} onSubmit={() => go('submitted')} onCancel={() => go('cancelled')} />}
                {node.type === 'consent' && <ConsentPreview data={node.data as ConsentData} onAccept={() => go('accepted')} onDecline={() => go('declined')} />}
                {node.type === 'product' && <ProductPreview data={node.data as ProductBlockData} onOutcome={go} />}
                {node.type === 'external_link' && <ExternalPreview data={node.data as ExternalLinkData} onNext={() => go()} />}
                {node.type === 'end' && <div className="end-preview"><CheckCircle2 size={32} /><BotBubble text={String((node.data as { text: string }).text)} /><strong>Воронка завершена</strong></div>}
              </div>
            )}
          </div>
          <div className="preview-controls">{history.length > 0 && <button onClick={back}><ArrowLeft size={14} /> Назад</button>}<button onClick={restart}><RotateCcw size={14} /> Сначала</button>{node?.type === 'start' && <button className="primary" onClick={() => go()}>Начать</button>}</div>
        </div>
        <p className="preview-caption">Предпросмотр моделирует Telegram, таймеры и оплату. Сообщения не отправляются, деньги не списываются.</p>
      </section>
    </div>
  )
}

function MessagePreview({ data, onBranch }: { data: MessageData; onBranch: (handle: string) => void }) {
  return <><BotBubble text={data.text} />{data.buttons.length ? <div className="telegram-buttons">{data.buttons.map((button) => <button key={button.id} onClick={() => { if (button.action === 'branch') onBranch(button.id); if (button.action === 'url') window.open(button.url, '_blank', 'noopener,noreferrer'); if (button.action === 'product') alert('В реальном боте здесь откроется оплата выбранного продукта.') }}>{button.text}{button.action === 'url' ? ' ↗' : ''}</button>)}</div> : <div className="telegram-buttons"><button onClick={() => onBranch('next')}>Продолжить</button></div>}</>
}

function MediaPreview({ document, data, onNext }: { document: FunnelDocument; data: MediaData; onNext: () => void }) {
  const asset = document.assets.find((item) => item.id === data.assetId)
  return <><div className="media-placeholder"><FileImage size={34} /><strong>{asset?.name ?? 'Материал не выбран'}</strong><span>{asset ? mediaLabel(asset.type) : 'Заглушка'}</span></div>{data.caption && <BotBubble text={data.caption} />}<div className="telegram-buttons"><button onClick={onNext}>Продолжить</button></div></>
}

function TimerPreview({ data, onNext }: { data: TimerData; onNext: (minutes: number) => void }) {
  const minutes = data.duration * (data.unit === 'days' ? 1440 : data.unit === 'hours' ? 60 : 1)
  return <div className="timer-preview"><Clock3 size={30} /><strong>Пауза: {data.duration} {unitLabel(data.unit)}</strong><p>{data.respectQuietHours ? 'Тихие часы будут учтены.' : 'Продолжение без учёта тихих часов.'}</p><button className="button primary" onClick={() => onNext(minutes)}>Перемотать время</button></div>
}

function TestPreview({ test, answers, setAnswers, calculation, onCalculate, onNext }: { test: FunnelDocument['tests'][number]; answers: Record<string, string | string[] | number>; setAnswers: (answers: Record<string, string | string[] | number>) => void; calculation: ReturnType<typeof calculateTestResult> | null; onCalculate: () => void; onNext: (resultId: string) => void }) {
  if (calculation) return <><BotBubble text={calculation.combined?.fullText ?? calculation.primary.fullText} /><div className="test-result-preview"><h3>{calculation.combined?.name ?? calculation.primary.name}</h3><p>{calculation.combined?.recommendations ?? calculation.primary.recommendations}</p><small>{calculation.explanation}</small></div><div className="telegram-buttons"><button onClick={() => onNext(calculation.chosenResultId)}>Продолжить по результату</button></div></>
  const questions = test.questions.filter((question) => question.enabled)
  return <div className="test-preview"><BotBubble text={test.description || 'Ответьте на вопросы'} />{questions.map((question, index) => <div className="preview-question" key={question.id}><strong>{index + 1}. {question.text}</strong>{['single', 'scale'].includes(question.type) ? question.answers.map((answer) => <label key={answer.id}><input type="radio" name={question.id} checked={answers[question.id] === answer.id} onChange={() => setAnswers({ ...answers, [question.id]: answer.id })} />{answer.text}</label>) : question.type === 'multiple' ? question.answers.map((answer) => { const selected = (answers[question.id] as string[] | undefined) ?? []; return <label key={answer.id}><input type="checkbox" checked={selected.includes(answer.id)} onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.checked ? [...selected, answer.id] : selected.filter((id) => id !== answer.id) })} />{answer.text}</label> }) : <input type={question.type === 'number' ? 'number' : 'text'} value={String(answers[question.id] ?? '')} onChange={(event) => setAnswers({ ...answers, [question.id]: question.type === 'number' ? Number(event.target.value) : event.target.value })} />}</div>)}<button className="button primary full" onClick={onCalculate}>Показать результат</button></div>
}

function FormPreview({ data, onSubmit, onCancel }: { data: FormData; onSubmit: () => void; onCancel: () => void }) {
  return <><BotBubble text={data.introText} /><div className="preview-form">{data.fields.map((field) => <label key={field.id}><span>{field.label}{field.required ? ' *' : ''}</span><input type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'} placeholder={field.label} /></label>)}<button className="button primary" onClick={onSubmit}>{data.submitText}</button><button className="text-button" onClick={onCancel}>Отмена</button></div></>
}

function ConsentPreview({ data, onAccept, onDecline }: { data: ConsentData; onAccept: () => void; onDecline: () => void }) {
  return <><BotBubble text={data.text} />{data.policyUrl && <a className="preview-link" href={data.policyUrl} target="_blank" rel="noreferrer">Политика обработки данных ↗</a>}<div className="telegram-buttons"><button onClick={onAccept}>{data.acceptText}</button>{data.declineEnabled && <button onClick={onDecline}>{data.declineText}</button>}</div></>
}

function ProductPreview({ data, onOutcome }: { data: ProductBlockData; onOutcome: (handle: string) => void }) {
  return <><div className="product-preview-card"><span>Предложение</span><h3>{data.headline}</h3><p>{data.description}</p><strong>{new Intl.NumberFormat('ru-RU').format(data.price)} ₽</strong></div><div className="telegram-buttons"><button onClick={() => onOutcome('paid')}>{data.payButtonText}</button><button onClick={() => onOutcome('failed')}>Смоделировать ошибку</button><button onClick={() => onOutcome('already_purchased')}>Уже куплено</button>{data.allowSkip && <button onClick={() => onOutcome('skip')}>Продолжить без покупки</button>}</div></>
}

function ExternalPreview({ data, onNext }: { data: ExternalLinkData; onNext: () => void }) {
  return <><BotBubble text={data.text} /><a className="preview-link-button" href={data.url} target="_blank" rel="noreferrer" onClick={() => data.continueAfterClick && window.setTimeout(onNext, 100)}>{data.buttonText} ↗</a>{data.continueAfterClick && <p className="panel-help">После клика воронка продолжится.</p>}</>
}

function BotBubble({ text }: { text: string }) { return <div className="bot-bubble">{text || 'Текст не заполнен'}</div> }
function PreviewNotice({ title, text }: { title: string; text: string }) { return <div className="preview-notice"><strong>{title}</strong><p>{text}</p></div> }
function mediaLabel(type: string) { return ({ image: 'Изображение', video: 'Видео', audio: 'Аудио', voice: 'Голосовое', video_note: 'Видеокружок', document: 'Документ', animation: 'Анимация' } as Record<string, string>)[type] ?? type }
function unitLabel(unit: string) { return unit === 'minutes' ? 'мин.' : unit === 'hours' ? 'ч.' : 'дн.' }
