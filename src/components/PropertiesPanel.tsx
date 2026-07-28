import { Copy, GripVertical, Plus, Trash2, X } from 'lucide-react'
import { newId, nodeTitle } from '../model/funnel'
import type {
  ConsentData,
  ExternalLinkData,
  FormData,
  FormField,
  FunnelDocument,
  MediaData,
  MessageButton,
  MessageData,
  ProductBlockData,
  TestBlockData,
  TimerData,
} from '../model/types'
import { useEditorStore } from '../store/editor'

interface PropertiesPanelProps {
  document: FunnelDocument
  onCloseMobile?: () => void
}

export function PropertiesPanel({ document, onCloseMobile }: PropertiesPanelProps) {
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId)
  const updateDocument = useEditorStore((state) => state.updateDocument)
  const deleteNode = useEditorStore((state) => state.deleteNode)
  const node = document.nodes.find((candidate) => candidate.id === selectedNodeId)

  if (!node) {
    return (
      <aside className="side-panel properties-panel">
        <div className="side-panel__heading"><div><span className="eyebrow">Настройки</span><h2>Выберите этап</h2></div></div>
        <div className="properties-empty"><strong>Нажмите на блок в схеме</strong><p>Здесь появятся только понятные настройки выбранного этапа.</p></div>
      </aside>
    )
  }

  const patch = (changes: Record<string, unknown>) => updateDocument((draft) => {
    const target = draft.nodes.find((candidate) => candidate.id === node.id)
    if (target) Object.assign(target.data, changes)
  })
  const removeNode = () => {
    if (node.type === 'start') return
    const connections = document.edges.filter((edge) => edge.source === node.id || edge.target === node.id).length
    if (window.confirm(`Удалить этап «${nodeTitle(node)}»${connections ? ` и связанные стрелки (${connections})` : ''}?`)) deleteNode(node.id)
  }

  return (
    <aside className="side-panel properties-panel">
      <div className="side-panel__heading">
        <div><span className="eyebrow">Настройки этапа</span><h2>{nodeTitle(node)}</h2></div>
        {onCloseMobile && <button className="icon-button" onClick={onCloseMobile} aria-label="Закрыть"><X size={18} /></button>}
      </div>
      <div className="properties-scroll">
        <Field label={node.type === 'start' ? 'Название точки входа' : 'Название этапа'}>
          <input value={node.data.title} onChange={(event) => patch({ title: event.target.value })} />
        </Field>
        {node.type === 'message' && <MessageFields document={document} nodeId={node.id} data={node.data as MessageData} />}
        {node.type === 'media' && <MediaFields document={document} data={node.data as MediaData} patch={patch} />}
        {node.type === 'timer' && <TimerFields data={node.data as TimerData} patch={patch} />}
        {node.type === 'test' && <TestFields document={document} data={node.data as TestBlockData} patch={patch} />}
        {node.type === 'form' && <FormFields data={node.data as FormData} patch={patch} />}
        {node.type === 'consent' && <ConsentFields data={node.data as ConsentData} patch={patch} />}
        {node.type === 'product' && <ProductFields document={document} data={node.data as ProductBlockData} patch={patch} />}
        {node.type === 'external_link' && <ExternalLinkFields data={node.data as ExternalLinkData} patch={patch} />}
        {node.type === 'end' && <Field label="Финальный текст"><textarea rows={7} value={String((node.data as { text: string }).text)} onChange={(event) => patch({ text: event.target.value })} /></Field>}
        {node.type === 'start' && <p className="panel-help">После старта пользователь перейдёт по единственной стрелке. Повторный вход настраивается во вкладке «Бот».</p>}
      </div>
      {node.type !== 'start' && <div className="properties-footer"><button className="button danger-outline full" onClick={removeNode}><Trash2 size={15} /> Удалить этап</button></div>}
    </aside>
  )
}

function MessageFields({ document, nodeId, data }: { document: FunnelDocument; nodeId: string; data: MessageData }) {
  const updateDocument = useEditorStore((state) => state.updateDocument)
  const update = (buttons: MessageButton[]) => updateDocument((draft) => {
    const node = draft.nodes.find((candidate) => candidate.id === nodeId)
    if (node?.type === 'message') (node.data as MessageData).buttons = buttons
  })
  const patchText = (text: string) => updateDocument((draft) => {
    const node = draft.nodes.find((candidate) => candidate.id === nodeId)
    if (node?.type === 'message') (node.data as MessageData).text = text
  })
  const rename = (button: MessageButton, text: string) => updateDocument((draft) => {
    const node = draft.nodes.find((candidate) => candidate.id === nodeId)
    if (node?.type !== 'message') return
    const target = (node.data as MessageData).buttons.find((item) => item.id === button.id)
    if (target) target.text = text
    draft.edges.filter((edge) => edge.source === nodeId && edge.sourceHandle === button.id).forEach((edge) => { edge.label = text })
  })
  const changeAction = (button: MessageButton, action: MessageButton['action']) => {
    const linked = document.edges.some((edge) => edge.source === nodeId && edge.sourceHandle === button.id)
    if (button.action === 'branch' && action !== 'branch' && linked && !window.confirm(`Кнопка «${button.text}» соединена со следующим этапом. Изменить действие и удалить эту стрелку?`)) return
    updateDocument((draft) => {
      const node = draft.nodes.find((candidate) => candidate.id === nodeId)
      if (node?.type !== 'message') return
      const target = (node.data as MessageData).buttons.find((item) => item.id === button.id)
      if (target) Object.assign(target, { action, url: action === 'url' ? target.url ?? 'https://' : undefined, productId: action === 'product' ? target.productId : undefined })
      if (action !== 'branch') draft.edges = draft.edges.filter((edge) => !(edge.source === nodeId && edge.sourceHandle === button.id))
    })
  }
  const remove = (button: MessageButton) => {
    const linked = document.edges.some((edge) => edge.source === nodeId && edge.sourceHandle === button.id)
    if (linked && !window.confirm(`Кнопка «${button.text}» соединена со следующим этапом. Удалить кнопку вместе со стрелкой?`)) return
    updateDocument((draft) => {
      const node = draft.nodes.find((candidate) => candidate.id === nodeId)
      if (node?.type === 'message') (node.data as MessageData).buttons = (node.data as MessageData).buttons.filter((item) => item.id !== button.id)
      draft.edges = draft.edges.filter((edge) => !(edge.source === nodeId && edge.sourceHandle === button.id))
    })
  }
  const move = (index: number, offset: number) => {
    const next = [...data.buttons]
    const target = index + offset
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    update(next)
  }
  return (
    <>
      <Field label="Текст сообщения"><textarea rows={7} value={data.text} onChange={(event) => patchText(event.target.value)} /></Field>
      <div className="section-label"><span>Кнопки</span><b>{data.buttons.length}</b></div>
      <p className="panel-help">Для действия «Продолжить по ветке» справа на карточке появится отдельный круглый выход.</p>
      <div className="simple-button-list">
        {data.buttons.map((button, index) => (
          <div className="option-editor" key={button.id}>
            <div className="option-editor-title"><GripVertical size={15} /><strong>Кнопка {index + 1}</strong><div className="option-mini-actions"><button disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button disabled={index === data.buttons.length - 1} onClick={() => move(index, 1)}>↓</button></div></div>
            <Field label="Текст"><input value={button.text} onChange={(event) => rename(button, event.target.value)} /></Field>
            <Field label="Действие">
              <select value={button.action} onChange={(event) => changeAction(button, event.target.value as MessageButton['action'])}>
                <option value="branch">Продолжить по своей ветке</option>
                <option value="url">Открыть внешнюю ссылку</option>
                <option value="product">Перейти к оплате продукта</option>
              </select>
            </Field>
            {button.action === 'url' && <Field label="Ссылка"><input value={button.url ?? ''} placeholder="https://" onChange={(event) => update(data.buttons.map((item) => item.id === button.id ? { ...item, url: event.target.value } : item))} /></Field>}
            {button.action === 'product' && <Field label="Продукт"><select value={button.productId ?? ''} onChange={(event) => update(data.buttons.map((item) => item.id === button.id ? { ...item, productId: event.target.value || undefined } : item))}><option value="">Выберите продукт</option>{document.products.map((product) => <option value={product.id} key={product.id}>{product.name}</option>)}</select></Field>}
            <div className="option-row-actions">
              <button onClick={() => update([...data.buttons.slice(0, index + 1), { ...button, id: newId('button'), text: `${button.text} — копия` }, ...data.buttons.slice(index + 1)])}><Copy size={14} /> Дублировать</button>
              <button className="danger" onClick={() => remove(button)}><Trash2 size={14} /> Удалить</button>
            </div>
          </div>
        ))}
      </div>
      <button className="button secondary full" onClick={() => update([...data.buttons, { id: newId('button'), text: 'Новая кнопка', action: 'branch' }])}><Plus size={16} /> Добавить кнопку</button>
      {!data.buttons.length && <p className="panel-help">Без кнопок сообщение имеет один обычный выход «Далее».</p>}
    </>
  )
}

function MediaFields({ document, data, patch }: { document: FunnelDocument; data: MediaData; patch: Patch }) {
  return <>
    <Field label="Материал"><select value={data.assetId ?? ''} onChange={(event) => patch({ assetId: event.target.value || undefined })}><option value="">Выберите из каталога</option>{document.assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.name} · {mediaLabel(asset.type)}</option>)}</select></Field>
    <Field label="Подпись"><textarea rows={4} value={data.caption} onChange={(event) => patch({ caption: event.target.value })} /></Field>
    <Toggle checked={data.required} onChange={(required) => patch({ required })} label="Материал обязателен" />
  </>
}

function TimerFields({ data, patch }: { data: TimerData; patch: Patch }) {
  return <>
    <div className="field-pair"><Field label="Через сколько"><input type="number" min="1" value={data.duration} onChange={(event) => patch({ duration: Math.max(1, Number(event.target.value)) })} /></Field><Field label="Единица"><select value={data.unit} onChange={(event) => patch({ unit: event.target.value })}><option value="minutes">Минуты</option><option value="hours">Часы</option><option value="days">Дни</option></select></Field></div>
    <Toggle checked={data.respectQuietHours} onChange={(respectQuietHours) => patch({ respectQuietHours })} label="Учитывать тихие часы" />
  </>
}

function TestFields({ document, data, patch }: { document: FunnelDocument; data: TestBlockData; patch: Patch }) {
  return <>
    <Field label="Тест"><select value={data.testId ?? ''} onChange={(event) => patch({ testId: event.target.value || undefined })}><option value="">Выберите тест</option>{document.tests.map((test) => <option value={test.id} key={test.id}>{test.name}</option>)}</select></Field>
    <Field label="Текст перед тестом"><textarea rows={4} value={data.welcomeText} onChange={(event) => patch({ welcomeText: event.target.value })} /></Field>
    <p className="panel-help">Вопросы, шкалы, баллы и тексты результатов редактируются во вкладке «Тесты».</p>
  </>
}

function FormFields({ data, patch }: { data: FormData; patch: Patch }) {
  const update = (fields: FormField[]) => patch({ fields })
  return <>
    <Field label="Текст перед формой"><textarea rows={4} value={data.introText} onChange={(event) => patch({ introText: event.target.value })} /></Field>
    <div className="section-label"><span>Какие данные запросить</span><b>{data.fields.length}</b></div>
    {data.fields.map((field, index) => <div className="option-editor" key={field.id}><Field label="Поле"><select value={field.type} onChange={(event) => update(data.fields.map((item) => item.id === field.id ? { ...item, type: event.target.value as FormField['type'], label: formLabel(event.target.value as FormField['type']) } : item))}>{(['name', 'username', 'phone', 'email', 'text'] as const).map((type) => <option value={type} key={type}>{formLabel(type)}</option>)}</select></Field><Field label="Подпись"><input value={field.label} onChange={(event) => update(data.fields.map((item) => item.id === field.id ? { ...item, label: event.target.value } : item))} /></Field><Toggle checked={field.required} onChange={(required) => update(data.fields.map((item) => item.id === field.id ? { ...item, required } : item))} label="Обязательное поле" /><div className="option-row-actions"><button className="danger" onClick={() => update(data.fields.filter((item) => item.id !== field.id))}><Trash2 size={14} /> Удалить</button><span>{index + 1}</span></div></div>)}
    <button className="button secondary full" onClick={() => update([...data.fields, { id: newId('field'), type: 'text', label: 'Ваш ответ', required: false }])}><Plus size={16} /> Добавить поле</button>
    <Field label="Кнопка отправки"><input value={data.submitText} onChange={(event) => patch({ submitText: event.target.value })} /></Field>
    <Field label="Подтверждение"><textarea rows={3} value={data.confirmationText} onChange={(event) => patch({ confirmationText: event.target.value })} /></Field>
  </>
}

function ConsentFields({ data, patch }: { data: ConsentData; patch: Patch }) {
  return <>
    <Field label="Текст согласия"><textarea rows={6} value={data.text} onChange={(event) => patch({ text: event.target.value })} /></Field>
    <Field label="Ссылка на политику"><input value={data.policyUrl} placeholder="https://" onChange={(event) => patch({ policyUrl: event.target.value })} /></Field>
    <Field label="Кнопка согласия"><input value={data.acceptText} onChange={(event) => patch({ acceptText: event.target.value })} /></Field>
    <Toggle checked={data.declineEnabled} onChange={(declineEnabled) => patch({ declineEnabled })} label="Показывать кнопку отказа" />
    {data.declineEnabled && <Field label="Кнопка отказа"><input value={data.declineText} onChange={(event) => patch({ declineText: event.target.value })} /></Field>}
  </>
}

function ProductFields({ document, data, patch }: { document: FunnelDocument; data: ProductBlockData; patch: Patch }) {
  return <>
    <Field label="Продукт"><select value={data.productId ?? ''} onChange={(event) => { const product = document.products.find((item) => item.id === event.target.value); patch({ productId: product?.id, price: product?.price ?? data.price }) }}><option value="">Выберите продукт</option>{document.products.map((product) => <option value={product.id} key={product.id}>{product.name}</option>)}</select></Field>
    <Field label="Заголовок"><input value={data.headline} onChange={(event) => patch({ headline: event.target.value })} /></Field>
    <Field label="Описание"><textarea rows={4} value={data.description} onChange={(event) => patch({ description: event.target.value })} /></Field>
    <Field label="Цена, ₽"><input type="number" min="0" step="1" value={data.price} onChange={(event) => patch({ price: Math.max(0, Number(event.target.value)) })} /></Field>
    <Field label="Кнопка оплаты"><input value={data.payButtonText} onChange={(event) => patch({ payButtonText: event.target.value })} /></Field>
    <Toggle checked={data.allowSkip} onChange={(allowSkip) => patch({ allowSkip })} label="Можно продолжить без покупки" />
    <p className="panel-help">В предпросмотре исход оплаты моделируется. Реальная платёжная система не подключена.</p>
  </>
}

function ExternalLinkFields({ data, patch }: { data: ExternalLinkData; patch: Patch }) {
  return <>
    <Field label="Текст перед кнопкой"><textarea rows={4} value={data.text} onChange={(event) => patch({ text: event.target.value })} /></Field>
    <Field label="Подпись кнопки"><input value={data.buttonText} onChange={(event) => patch({ buttonText: event.target.value })} /></Field>
    <Field label="URL"><input value={data.url} placeholder="https://" onChange={(event) => patch({ url: event.target.value })} /></Field>
    <Toggle checked={data.continueAfterClick} onChange={(continueAfterClick) => patch({ continueAfterClick })} label="Продолжить воронку после клика" />
  </>
}

type Patch = (changes: Record<string, unknown>) => void
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label> }
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) { return <label className="toggle-row"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><strong>{label}</strong></span></label> }
function formLabel(type: FormField['type']) { return ({ name: 'Имя', username: 'Username', phone: 'Телефон', email: 'Email', text: 'Текст' } as const)[type] }
function mediaLabel(type: string) { return ({ image: 'Изображение', video: 'Видео', audio: 'Аудио', voice: 'Голосовое', video_note: 'Видеокружок', document: 'Документ', animation: 'Анимация' } as Record<string, string>)[type] ?? type }
