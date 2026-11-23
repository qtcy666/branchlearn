import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTreeStore } from '../store/useTreeStore'

type StartMode = 'custom' | 'blank'

interface Props {
  onClose: () => void
  onCreated?: (id: string) => void
}

const START_OPTIONS = [
  { id: 'custom', title: '自定义', desc: '自己选择 2 ~ 5 层' },
  { id: 'blank', title: '空白', desc: '只有一个根节点' },
] as const

const DEPTH_RANGE = [2, 3, 4, 5]

export function NewTreeDialog({ onClose, onCreated }: Props) {
  const createTree = useTreeStore((s) => s.createTree)
  const createTreeWithDepth = useTreeStore((s) => s.createTreeWithDepth)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [mode, setMode] = useState<StartMode>('custom')
  const [depth, setDepth] = useState(3)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const canSubmit = title.trim().length > 0

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return

    const name = title.trim()
    const desc = description.trim()
    const id = mode === 'custom' ? createTreeWithDepth(name, desc, depth) : createTree(name, desc)

    onClose()
    onCreated?.(id)
  }

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="new-tree-title">
        <h2 id="new-tree-title" className="dialog-title">
          新建一棵树
        </h2>
        <p className="dialog-desc">
          一棵树对应一门课或一个学习目标。之后可以随时改名、增删节点。
        </p>

        <form onSubmit={handleSubmit} className="dialog-form">
          <label className="field">
            <span className="field-label">课程 / 目标名称</span>
            <input
              ref={inputRef}
              className="input"
              value={title}
              maxLength={60}
              placeholder="例如：线性代数"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <label className="field">
            <span className="field-label">
              一句话说明 <span className="field-optional">选填</span>
            </span>
            <input
              className="input"
              value={description}
              maxLength={120}
              placeholder="例如：期末前把前四章吃透"
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>

          <div className="field">
            <span className="field-label">一开始放点什么</span>
            <div className="start-options" role="radiogroup" aria-label="初始结构">
              {START_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === option.id}
                  className={`start-option${mode === option.id ? ' is-active' : ''}`}
                  onClick={() => setMode(option.id)}
                >
                  <span className="start-option-title">{option.title}</span>
                  <span className="start-option-desc">{option.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {mode === 'custom' && (
            <div className="field">
              <span className="field-label">层数（含根节点）</span>
              <div className="depth-picker" role="radiogroup" aria-label="层数">
                {DEPTH_RANGE.map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={depth === n}
                    className={`depth-option${depth === n ? ' is-active' : ''}`}
                    onClick={() => setDepth(n)}
                  >
                    {n} 层
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
              创建
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
