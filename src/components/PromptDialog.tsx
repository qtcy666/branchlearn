import { useEffect, useRef, useState, type FormEvent } from 'react'

interface Props {
  title: string
  description?: string
  placeholder: string
  onSubmit: (value: string) => void
  onClose: () => void
}

export function PromptDialog({
  title,
  description,
  placeholder,
  onSubmit,
  onClose,
}: Props) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const canSubmit = value.trim().length > 0

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return
    onSubmit(value.trim())
  }

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="prompt-title">
        <h2 id="prompt-title" className="dialog-title">
          {title}
        </h2>
        {description && <p className="dialog-desc">{description}</p>}

        <form onSubmit={handleSubmit} className="dialog-form">
          <label className="field">
            <input
              ref={inputRef}
              className="input"
              value={value}
              maxLength={80}
              placeholder={placeholder}
              aria-label={title}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>

          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
              添加
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
