import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { parseImportedTrees } from '../lib/storage'
import { useTreeStore } from '../store/useTreeStore'

interface Props {
  onClose: () => void
}

type Status = 'idle' | 'success' | 'error'

export function ImportDialog({ onClose }: Props) {
  const importTrees = useTreeStore((s) => s.importTrees)
  const inputRef = useRef<HTMLInputElement>(null)

  const [dragOver, setDragOver] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleFiles = async (files: FileList | File[]) => {
    let imported = 0
    let failed = 0

    for (const file of Array.from(files)) {
      try {
        const text = await file.text()
        const parsed: unknown = JSON.parse(text)
        const trees = parseImportedTrees(parsed)
        if (trees.length === 0) {
          failed += 1
          continue
        }
        imported += importTrees(trees)
      } catch {
        failed += 1
      }
    }

    if (imported > 0) {
      setStatus('success')
      setMessage(
        failed > 0
          ? `已导入 ${imported} 棵树，另有 ${failed} 个文件无法识别。`
          : `已导入 ${imported} 棵树。`,
      )
    } else {
      setStatus('error')
      setMessage('没有找到可导入的树，请选择「树学」导出的 JSON 文件。')
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragOver(false)
    if (event.dataTransfer.files.length > 0) void handleFiles(event.dataTransfer.files)
  }

  const handleSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    event.target.value = ''
    if (files && files.length > 0) void handleFiles(files)
  }

  const reset = () => {
    setStatus('idle')
    setMessage('')
    setDragOver(false)
  }

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <h2 id="import-title" className="dialog-title">
          导入课程
        </h2>
        <p className="dialog-desc">
          把「树学」导出的 JSON 文件拖进来，或点击选择文件。一个文件里可以包含一棵或多棵树。
        </p>

        {status !== 'success' ? (
          <>
            <div
              className={`import-dropzone${dragOver ? ' is-dragging' : ''}`}
              role="button"
              tabIndex={0}
              aria-label="选择要导入的 JSON 文件"
              onClick={() => inputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click()
              }}
              onDragOver={(event) => {
                event.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <svg
                className="import-dropzone-icon"
                width="36"
                height="36"
                viewBox="0 0 32 32"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M16 26v-7"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M16 19c-3.4-2.2-6-4.6-6.6-7.2M16 19c0-3.8-.1-6.9-.4-9.4M16 19c3.4-2.2 6-4.6 6.6-7.2"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <circle cx="9.4" cy="11.8" r="2" fill="currentColor" />
                <circle cx="15.6" cy="9.6" r="2" fill="currentColor" />
                <circle cx="22.6" cy="11.8" r="2" fill="currentColor" />
              </svg>
              <span className="import-dropzone-title">
                {dragOver ? '松开即可导入' : '把 JSON 文件拖到这里'}
              </span>
              <span className="import-dropzone-hint">或点击选择文件（可多选）</span>
            </div>

            {status === 'error' && <p className="import-error">{message}</p>}

            <input
              ref={inputRef}
              type="file"
              accept="application/json,.json"
              multiple
              hidden
              onChange={handleSelect}
            />

            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                取消
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="import-success">
              <svg
                className="import-success-icon"
                width="36"
                height="36"
                viewBox="0 0 32 32"
                fill="none"
                aria-hidden="true"
              >
                <circle cx="16" cy="16" r="13" fill="var(--accent-soft)" />
                <path
                  d="M10.5 16.5l3.8 3.8 7.2-8"
                  stroke="var(--accent)"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <p className="import-success-text">{message}</p>
            </div>

            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={reset}>
                继续导入
              </button>
              <button type="button" className="btn btn-primary" onClick={onClose}>
                完成
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
