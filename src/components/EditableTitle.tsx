import { useEffect, useRef, useState } from 'react'

interface Props {
  value: string
  onCommit: (title: string) => void
  onCancel: () => void
  className?: string
}

export function EditableTitle({ value, onCommit, onCancel, className }: Props) {
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const doneRef = useRef(false)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const finish = (commit: boolean) => {
    if (doneRef.current) return
    doneRef.current = true
    const trimmed = draft.trim()
    if (commit && trimmed) onCommit(trimmed)
    else onCancel()
  }

  return (
    <input
      ref={inputRef}
      className={className ?? 'node-input node-input--rename'}
      value={draft}
      maxLength={80}
      aria-label="节点标题"
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          finish(true)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          finish(false)
        }
      }}
      onBlur={() => finish(true)}
    />
  )
}
