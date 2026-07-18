import { AlertTriangle, CheckCircle2, X, XCircle } from 'lucide-react'
import type { ValidationIssue } from '../model/types'

interface ValidationDialogProps {
  issues: ValidationIssue[]
  onClose: () => void
  onSelectIssue: (issue: ValidationIssue) => void
}

export function ValidationDialog({ issues, onClose, onSelectIssue }: ValidationDialogProps) {
  const errors = issues.filter((issue) => issue.severity === 'error')
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog validation-dialog" role="dialog" aria-modal="true" aria-labelledby="validation-title">
        <button className="icon-button dialog-close" onClick={onClose} aria-label="Закрыть"><X size={19} /></button>
        <div className={`dialog-status ${errors.length ? 'error' : issues.length ? 'warning' : 'success'}`}>
          {errors.length ? <XCircle size={26} /> : issues.length ? <AlertTriangle size={26} /> : <CheckCircle2 size={26} />}
        </div>
        <h2 id="validation-title">{errors.length ? 'Нужны исправления' : issues.length ? 'Проверка завершена' : 'Воронка готова'}</h2>
        <p className="dialog-lead">{errors.length ? `${errors.length} ошибок мешают корректной работе. Исправьте их перед экспортом.` : warnings.length ? `Ошибок нет, но найдено предупреждений: ${warnings.length}.` : 'Ошибок и предупреждений не найдено.'}</p>
        {!!issues.length && (
          <div className="issue-list">
            {issues.map((issue, index) => (
              <button key={`${issue.code}-${index}`} className={`issue-row ${issue.severity}`} onClick={() => onSelectIssue(issue)}>
                {issue.severity === 'error' ? <XCircle size={18} /> : <AlertTriangle size={18} />}
                <span><strong>{issue.message}</strong>{issue.path && <small className="mono">{issue.path}</small>}</span>
              </button>
            ))}
          </div>
        )}
        <div className="dialog-actions"><button className="button primary" onClick={onClose}>Понятно</button></div>
      </section>
    </div>
  )
}
