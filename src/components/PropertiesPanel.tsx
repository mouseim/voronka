import { ArrowDown, ArrowUp, Link2, Plus, Trash2, X } from 'lucide-react'
import { newId, nodeTitle } from '../model/funnel'
import type {
  ChoiceData,
  EndData,
  FunnelDocument,
  FunnelNode,
  MediaData,
  MessageData,
  NodeOption,
  QuestionData,
  StartData,
  TimerData,
} from '../model/types'
import { useEditorStore } from '../store/editor'
import { MediaRegistry } from './MediaRegistry'
import { nodeMeta } from './nodeMeta'

interface PropertiesPanelProps {
  document: FunnelDocument
  activeTab: 'properties' | 'media'
  onTabChange: (tab: 'properties' | 'media') => void
  onCloseMobile?: () => void
}

export function PropertiesPanel({ document, activeTab, onTabChange, onCloseMobile }: PropertiesPanelProps) {
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId)
  const selectNode = useEditorStore((state) => state.selectNode)
  const selected = document.nodes.find((node) => node.id === selectedNodeId)
  return (
    <aside className="side-panel properties-panel">
      <div className="panel-tabs">
        <button className={activeTab === 'properties' ? 'active' : ''} onClick={() => onTabChange('properties')}>Свойства</button>
        <button className={activeTab === 'media' ? 'active' : ''} onClick={() => onTabChange('media')}>Медиа <span>{document.nodes.filter((node) => node.type === 'media').length}</span></button>
        {onCloseMobile && <button className="icon-button mobile-panel-close" onClick={onCloseMobile} aria-label="Закрыть панель"><X size={18} /></button>}
      </div>
      {activeTab === 'media' ? (
        <MediaRegistry document={document} onSelect={(id) => { selectNode(id); onTabChange('properties') }} />
      ) : selected ? (
        <NodeProperties document={document} node={selected} />
      ) : (
        <div className="panel-empty">
          <div className="panel-empty__visual"><Link2 size={30} /></div>
          <h3>Выберите блок</h3>
          <p>Нажмите на блок на полотне, чтобы изменить его текст, настройки и переходы.</p>
        </div>
      )}
    </aside>
  )
}

function NodeProperties({ document, node }: { document: FunnelDocument; node: FunnelNode }) {
  const updateNode = useEditorStore((state) => state.updateNode)
  const updateDocument = useEditorStore((state) => state.updateDocument)
  const deleteNode = useEditorStore((state) => state.deleteNode)
  const meta = nodeMeta[node.type]
  const Icon = meta.icon
  const setData = (patch: Record<string, unknown>) => updateNode(node.id, (draft) => { draft.data = { ...draft.data, ...patch } as FunnelNode['data'] })
  const nextEdges = document.edges.filter((edge) => edge.source === node.id)
  const targetTitle = (handle = 'next') => {
    const edge = nextEdges.find((candidate) => (candidate.sourceHandle ?? 'next') === handle)
    const target = document.nodes.find((candidate) => candidate.id === edge?.target)
    return target ? nodeTitle(target) : 'Не настроен'
  }

  const confirmDelete = () => {
    if (node.type === 'start') return
    if (window.confirm(`Удалить блок «${nodeTitle(node)}» и все его связи?`)) deleteNode(node.id)
  }

  return (
    <div className="properties-scroll">
      <div className="properties-heading">
        <span className="node-type-icon large" style={{ color: meta.color, background: meta.background }}><Icon size={20} /></span>
        <div><span className="eyebrow">{meta.label}</span><h2>{nodeTitle(node)}</h2></div>
      </div>
      <div className="property-id"><span>ID блока</span><code>{node.id}</code></div>
      <Field label="Название блока" required>
        <input value={String(node.data.title)} onChange={(event) => setData({ title: event.target.value })} />
      </Field>

      {node.type === 'start' && <StartFields data={node.data as StartData} setData={setData} />}
      {node.type === 'message' && <MessageFields data={node.data as MessageData} setData={setData} />}
      {node.type === 'choice' && <OptionFields node={node} kind="choice" options={(node.data as ChoiceData).options} updateDocument={updateDocument} />}
      {node.type === 'question' && <QuestionFields node={node} data={node.data as QuestionData} setData={setData} updateDocument={updateDocument} />}
      {node.type === 'timer' && <TimerFields data={node.data as TimerData} setData={setData} />}
      {node.type === 'media' && <MediaFields data={node.data as MediaData} setData={setData} />}
      {node.type === 'end' && <EndFields data={node.data as EndData} setData={setData} />}

      {node.type === 'choice' && <Field label="Текст перед кнопками" required><textarea rows={3} value={(node.data as ChoiceData).prompt} onChange={(event) => setData({ prompt: event.target.value })} /></Field>}

      {node.type !== 'end' && (
        <div className="connection-summary">
          <div className="section-label"><Link2 size={15} /> Переходы</div>
          {['choice', 'question'].includes(node.type) ? (
            ((node.type === 'choice' ? (node.data as ChoiceData).options : (node.data as QuestionData).answers)).map((option) => (
              <div className="connection-row" key={option.id}><span>{option.text || 'Без текста'}</span><strong className={targetTitle(option.id) === 'Не настроен' ? 'muted' : ''}>{targetTitle(option.id)}</strong></div>
            ))
          ) : <div className="connection-row"><span>Следующий блок</span><strong className={targetTitle() === 'Не настроен' ? 'muted' : ''}>{targetTitle()}</strong></div>}
          <small>Соедините порты блоков стрелкой на полотне.</small>
        </div>
      )}

      <div className="properties-footer">
        <button className="button danger ghost" disabled={node.type === 'start'} onClick={confirmDelete}><Trash2 size={16} /> {node.type === 'start' ? 'Старт нельзя удалить' : 'Удалить блок'}</button>
      </div>
    </div>
  )
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}{required && <b>*</b>}</span>{children}{hint && <small>{hint}</small>}</label>
}

function StartFields({ data, setData }: { data: StartData; setData: (patch: Record<string, unknown>) => void }) {
  return <Field label="Описание для администратора"><textarea rows={4} value={data.note} onChange={(event) => setData({ note: event.target.value })} /></Field>
}

function MessageFields({ data, setData }: { data: MessageData; setData: (patch: Record<string, unknown>) => void }) {
  return <>
    <Field label="Текст сообщения" required><textarea rows={6} value={data.text} onChange={(event) => setData({ text: event.target.value })} /></Field>
    <Field label="Внутреннее примечание"><textarea rows={3} value={data.note} onChange={(event) => setData({ note: event.target.value })} /></Field>
    <label className="switch-row"><input type="checkbox" checked={data.continueEnabled} onChange={(event) => setData({ continueEnabled: event.target.checked })} /><span><strong>Кнопка «Продолжить»</strong><small>Показать кнопку под сообщением</small></span></label>
    {data.continueEnabled && <Field label="Текст кнопки" required><input value={data.buttonText} onChange={(event) => setData({ buttonText: event.target.value })} /></Field>}
  </>
}

function QuestionFields({ node, data, setData, updateDocument }: { node: FunnelNode; data: QuestionData; setData: (patch: Record<string, unknown>) => void; updateDocument: (update: (draft: FunnelDocument) => void) => void }) {
  return <>
    <Field label="Текст вопроса" required><textarea rows={4} value={data.question} onChange={(event) => setData({ question: event.target.value })} /></Field>
    <OptionFields node={node} kind="question" options={data.answers} updateDocument={updateDocument} />
  </>
}

function OptionFields({ node, kind, options, updateDocument }: { node: FunnelNode; kind: 'choice' | 'question'; options: NodeOption[]; updateDocument: (update: (draft: FunnelDocument) => void) => void }) {
  const min = kind === 'choice' ? 1 : 2
  const key = kind === 'choice' ? 'options' : 'answers'
  const updateOptions = (next: NodeOption[], removedId?: string) => updateDocument((draft) => {
    const target = draft.nodes.find((candidate) => candidate.id === node.id)
    if (target) target.data = { ...target.data, [key]: next } as FunnelNode['data']
    if (removedId) draft.edges = draft.edges.filter((edge) => !(edge.source === node.id && edge.sourceHandle === removedId))
  })
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= options.length) return
    const next = [...options]
    ;[next[index], next[target]] = [next[target], next[index]]
    updateOptions(next)
  }
  return <div className="options-editor">
    <div className="section-label"><span>{kind === 'choice' ? 'Кнопки' : 'Варианты ответа'}</span><b>{options.length}/8</b></div>
    {options.map((option, index) => (
      <div className="option-editor" key={option.id}>
        <div className="option-editor__top"><span>{index + 1}</span><input value={option.text} onChange={(event) => updateOptions(options.map((item) => item.id === option.id ? { ...item, text: event.target.value } : item))} placeholder="Текст варианта" /></div>
        {kind === 'question' && <input className="score-input" value={scoresToText(option.scores)} onChange={(event) => updateOptions(options.map((item) => item.id === option.id ? { ...item, scores: textToScores(event.target.value) } : item))} placeholder="Баллы: sales: 3, growth: 1" title="Произвольные шкалы в формате шкала: баллы" />}
        <div className="option-actions">
          <code title="Устойчивый ID варианта">{option.id.slice(0, 18)}</code>
          <button className="mini-icon" onClick={() => move(index, -1)} disabled={index === 0} title="Выше"><ArrowUp size={14} /></button>
          <button className="mini-icon" onClick={() => move(index, 1)} disabled={index === options.length - 1} title="Ниже"><ArrowDown size={14} /></button>
          <button className="mini-icon danger" onClick={() => updateOptions(options.filter((item) => item.id !== option.id), option.id)} disabled={options.length <= min} title="Удалить"><Trash2 size={14} /></button>
        </div>
      </div>
    ))}
    <button className="button secondary full" disabled={options.length >= 8} onClick={() => updateOptions([...options, { id: newId(kind === 'choice' ? 'option' : 'answer'), text: `${kind === 'choice' ? 'Вариант' : 'Ответ'} ${options.length + 1}` }])}><Plus size={16} /> Добавить {kind === 'choice' ? 'кнопку' : 'ответ'}</button>
  </div>
}

function TimerFields({ data, setData }: { data: TimerData; setData: (patch: Record<string, unknown>) => void }) {
  return <>
    <div className="field-pair"><Field label="Значение" required><input type="number" min="1" step="1" value={data.duration} onChange={(event) => setData({ duration: Number(event.target.value) })} /></Field><Field label="Единица"><select value={data.unit} onChange={(event) => setData({ unit: event.target.value })}><option value="minutes">Минуты</option><option value="hours">Часы</option><option value="days">Дни</option></select></Field></div>
    <Field label="Пояснение для администратора"><textarea rows={3} value={data.note} onChange={(event) => setData({ note: event.target.value })} /></Field>
  </>
}

function MediaFields({ data, setData }: { data: MediaData; setData: (patch: Record<string, unknown>) => void }) {
  return <>
    <Field label="Логический ключ assetKey" required hint="Уникальный ключ без пробелов, например gift_day_1_voice"><input className="mono" value={data.assetKey} onChange={(event) => setData({ assetKey: event.target.value.trim().replace(/\s+/g, '_') })} placeholder="gift_day_1_voice" /></Field>
    <Field label="Отображаемое имя" required><input value={data.displayName} onChange={(event) => setData({ displayName: event.target.value })} placeholder="Голосовое первого дня" /></Field>
    <Field label="Ожидаемый тип"><select value={data.expectedType} onChange={(event) => setData({ expectedType: event.target.value })}><option value="image">Изображение</option><option value="video">Видео</option><option value="audio">Аудио</option><option value="voice">Голосовое сообщение</option><option value="video_note">Видеокружок</option><option value="document">Документ</option></select></Field>
    <Field label="Подпись"><textarea rows={3} value={data.caption} onChange={(event) => setData({ caption: event.target.value })} /></Field>
    <label className="switch-row"><input type="checkbox" checked={data.required} onChange={(event) => setData({ required: event.target.checked })} /><span><strong>Файл обязателен</strong><small>Бот не сможет опубликовать воронку без него</small></span></label>
  </>
}

function EndFields({ data, setData }: { data: EndData; setData: (patch: Record<string, unknown>) => void }) {
  return <><Field label="Финальный текст" required><textarea rows={6} value={data.text} onChange={(event) => setData({ text: event.target.value })} /></Field><Field label="Внутреннее примечание"><textarea rows={3} value={data.note} onChange={(event) => setData({ note: event.target.value })} /></Field></>
}

function scoresToText(scores: NodeOption['scores']) {
  return scores ? Object.entries(scores).map(([key, value]) => `${key}: ${value}`).join(', ') : ''
}

function textToScores(value: string) {
  const result: Record<string, number> = {}
  value.split(',').forEach((part) => {
    const [rawKey, rawValue] = part.split(':')
    const key = rawKey?.trim()
    const score = Number(rawValue?.trim())
    if (key && Number.isFinite(score)) result[key] = score
  })
  return result
}
