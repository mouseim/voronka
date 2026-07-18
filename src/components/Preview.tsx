import { Bug, Clock3, FileAudio, FileImage, FileText, Film, RotateCcw, Send, Video, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { outgoingEdge } from '../model/funnel'
import type { ChoiceData, FunnelDocument, MediaData, MessageData, NodeOption, QuestionData, TimerData } from '../model/types'
import { nodeMeta } from './nodeMeta'

interface PreviewProps {
  document: FunnelDocument
  onClose: () => void
}

interface HistoryItem {
  id: string
  text: string
  kind: 'bot' | 'user' | 'system'
}

export function Preview({ document, onClose }: PreviewProps) {
  const [currentId, setCurrentId] = useState(document.funnel.startNodeId)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [scores, setScores] = useState<Record<string, number>>({})
  const [debug, setDebug] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = useMemo(() => document.nodes.find((node) => node.id === currentId), [document, currentId])

  const go = (handle = 'next', userText?: string, option?: NodeOption) => {
    if (!current) return
    const edge = outgoingEdge(document, current.id, handle)
    if (!edge) {
      setError(`Переход не настроен. Проверьте блок ${current.id}${handle !== 'next' ? ` и вариант ${handle}` : ''}.`)
      return
    }
    if (userText) setHistory((items) => [...items, { id: crypto.randomUUID(), text: userText, kind: 'user' }])
    if (option?.scores) setScores((currentScores) => {
      const next = { ...currentScores }
      Object.entries(option.scores ?? {}).forEach(([scale, value]) => { next[scale] = (next[scale] ?? 0) + value })
      return next
    })
    setError(null)
    setCurrentId(edge.target)
  }

  const restart = () => {
    setCurrentId(document.funnel.startNodeId)
    setHistory([])
    setScores({})
    setError(null)
  }

  if (!current) return <div className="modal-backdrop"><section className="preview-shell"><p>Стартовый блок {document.funnel.startNodeId} не найден.</p><button className="button" onClick={onClose}>Закрыть</button></section></div>
  const meta = nodeMeta[current.type]

  return (
    <div className="modal-backdrop preview-backdrop">
      <section className="preview-shell" role="dialog" aria-modal="true" aria-label="Предпросмотр воронки">
        <header className="preview-header">
          <div className="preview-avatar">В</div>
          <div><strong>{document.funnel.name}</strong><span>симуляция · версия {document.funnel.version}</span></div>
          <button className={`icon-button ${debug ? 'active' : ''}`} onClick={() => setDebug(!debug)} title="Режим отладки"><Bug size={18} /></button>
          <button className="icon-button" onClick={restart} title="Начать заново"><RotateCcw size={18} /></button>
          <button className="icon-button" onClick={onClose} title="Закрыть"><X size={20} /></button>
        </header>
        <div className="preview-chat">
          <div className="preview-date">Предпросмотр · ожидание выполняется мгновенно</div>
          {history.map((item) => <div key={item.id} className={`chat-bubble ${item.kind}`}>{item.text}</div>)}
          <CurrentStep node={current} go={go} />
          {error && <div className="preview-error"><strong>Нет перехода</strong><span>{error}</span></div>}
        </div>
        {debug && (
          <footer className="debug-panel">
            <span><b>Блок</b><code>{current.id}</code></span>
            <span><b>Тип</b><code>{meta.label}</code></span>
            <span><b>Баллы</b><code>{Object.keys(scores).length ? Object.entries(scores).map(([key, value]) => `${key}: ${value}`).join(' · ') : 'пока нет'}</code></span>
          </footer>
        )}
      </section>
    </div>
  )
}

function CurrentStep({ node, go }: { node: FunnelDocument['nodes'][number]; go: (handle?: string, userText?: string, option?: NodeOption) => void }) {
  if (node.type === 'start') return <div className="chat-card start-card"><span>Точка входа</span><strong>{node.data.title}</strong><button onClick={() => go()}>Начать симуляцию <Send size={15} /></button></div>

  if (node.type === 'message') {
    const data = node.data as MessageData
    return <><div className="chat-bubble bot">{data.text}</div><div className="chat-actions"><button onClick={() => go('next', data.buttonText || 'Продолжить')}>{data.continueEnabled ? data.buttonText : 'Продолжить симуляцию'}</button></div></>
  }

  if (node.type === 'choice') {
    const data = node.data as ChoiceData
    return <><div className="chat-bubble bot">{data.prompt}</div><div className="chat-actions">{data.options.map((option) => <button key={option.id} onClick={() => go(option.id, option.text)}>{option.text || 'Без текста'}</button>)}</div></>
  }

  if (node.type === 'question') {
    const data = node.data as QuestionData
    return <><div className="chat-bubble bot">{data.question}</div><div className="chat-actions">{data.answers.map((answer) => <button key={answer.id} onClick={() => go(answer.id, answer.text, answer)}>{answer.text || 'Без текста'}</button>)}</div></>
  }

  if (node.type === 'timer') {
    const data = node.data as TimerData
    return <div className="chat-card timer-card"><Clock3 size={24} /><strong>Запланированная задержка</strong><p>В рабочем боте следующий шаг будет отправлен через {data.duration} {unitText(data.duration, data.unit)}.</p><button onClick={() => go()}>Продолжить симуляцию</button></div>
  }

  if (node.type === 'media') {
    const data = node.data as MediaData
    const Icon = mediaIcon(data.expectedType)
    return <><div className="media-placeholder"><Icon size={36} /><span>{mediaTypeText(data.expectedType)}</span><strong>{data.displayName || 'Будущий файл'}</strong><code>{data.assetKey || 'assetKey не заполнен'}</code></div>{data.caption && <div className="chat-bubble bot">{data.caption}</div>}<div className="chat-actions"><button onClick={() => go()}>Продолжить</button></div></>
  }

  return <div className="chat-card finish-card"><span>✓</span><strong>{String(node.data.title)}</strong><p>{String(node.data.text)}</p><button onClick={() => window.scrollTo({ top: 0 })}>Воронка завершена</button></div>
}

function unitText(value: number, unit: string) {
  const forms = unit === 'minutes' ? ['минуту', 'минуты', 'минут'] : unit === 'hours' ? ['час', 'часа', 'часов'] : ['день', 'дня', 'дней']
  const index = value % 10 === 1 && value % 100 !== 11 ? 0 : [2, 3, 4].includes(value % 10) && ![12, 13, 14].includes(value % 100) ? 1 : 2
  return forms[index]
}

function mediaTypeText(type: string) {
  return ({ image: 'Изображение', video: 'Видео', audio: 'Аудио', voice: 'Голосовое сообщение', video_note: 'Видеокружок', document: 'Документ' } as Record<string, string>)[type]
}

function mediaIcon(type: string) {
  return type === 'image' ? FileImage : type === 'video' ? Film : type === 'audio' || type === 'voice' ? FileAudio : type === 'video_note' ? Video : FileText
}
