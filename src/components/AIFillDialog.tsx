import { useEffect, useRef, useState } from 'react'
import {
  COURSE_SHAPE,
  buildTreeFromFill,
  validateFill,
  type FillResult,
} from '../data/treeShape'
import { FillError, describeFillError, requestFill } from '../lib/fillApi'
import { useTreeStore } from '../store/useTreeStore'
import { countNodes } from '../types/tree'

const HINTS = [
  '正在联网检索课程大纲…',
  '正在比对教材目录…',
  '正在填充章节与知识点…',
  '正在检查结构…',
]

const HINT_INTERVAL = 6000

type Stage = 'idle' | 'loading' | 'preview'

interface Props {
  onClose: () => void
}

export function AIFillDialog({ onClose }: Props) {
  const importTrees = useTreeStore((s) => s.importTrees)
  const notify = useTreeStore((s) => s.notify)

  const [stage, setStage] = useState<Stage>('idle')
  const [query, setQuery] = useState('')
  const [goal, setGoal] = useState('')
  const [hint, setHint] = useState(HINTS[0])
  const [error, setError] = useState('')
  const [details, setDetails] = useState<string[]>([])
  const [result, setResult] = useState<FillResult | null>(null)

  const controller = useRef<AbortController | null>(null)
  const hintTimer = useRef<number | null>(null)

  const stopHint = () => {
    if (hintTimer.current !== null) {
      window.clearInterval(hintTimer.current)
      hintTimer.current = null
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      controller.current?.abort()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      controller.current?.abort()
      stopHint()
    }
  }, [onClose])

  const start = async () => {
    const text = query.trim()
    if (!text) {
      setError('先写一个课程名，比如「离散数学」。')
      return
    }

    setStage('loading')
    setError('')
    setDetails([])
    setResult(null)

    let index = 0
    setHint(HINTS[0])
    stopHint()
    hintTimer.current = window.setInterval(() => {
      index = (index + 1) % HINTS.length
      setHint(HINTS[index] ?? HINTS[0])
    }, HINT_INTERVAL)

    const ctrl = new AbortController()
    controller.current = ctrl

    try {
      const data = await requestFill({
        query: text,
        goal: goal.trim() || undefined,
        shape: COURSE_SHAPE,
        signal: ctrl.signal,
      })
      setResult(data)
      setDetails(validateFill(data, COURSE_SHAPE))
      setStage('preview')
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setStage('idle')
        return
      }
      setError(describeFillError(err))
      if (err instanceof FillError) setDetails(err.details)
      setStage('idle')
    } finally {
      stopHint()
      controller.current = null
    }
  }

  const cancel = () => {
    controller.current?.abort()
    stopHint()
    setStage('idle')
  }

  const confirm = () => {
    if (!result || details.length > 0) return
    const tree = buildTreeFromFill(result, COURSE_SHAPE)
    importTrees([tree])
    notify(`已生成「${tree.title}」，共 ${countNodes(tree.root)} 个节点。`)
    onClose()
  }

  const chapters = result?.children ?? []
  const total = result ? 1 + chapters.reduce((sum, ch) => sum + 1 + (ch.children?.length ?? 0), 0) : 0

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dialog ai-fill" role="dialog" aria-modal="true" aria-labelledby="ai-fill-title">
        <h2 id="ai-fill-title" className="dialog-title">
          用 AI 生成一棵树
        </h2>
        <p className="dialog-desc">
          写一个课程名。AI 会联网检索公开的课程大纲，按「课程 → 章节 → 知识点」填满，
          结构由模板决定，是否采用由你决定。
        </p>

        {stage === 'idle' && (
          <>
            <label className="ai-fill-label" htmlFor="ai-fill-query">
              课程名
            </label>
            <input
              id="ai-fill-query"
              className="ai-fill-input"
              value={query}
              maxLength={40}
              autoFocus
              placeholder="例如：离散数学"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void start()
              }}
            />

            <label className="ai-fill-label" htmlFor="ai-fill-goal">
              目标（可选）
            </label>
            <input
              id="ai-fill-goal"
              className="ai-fill-input"
              value={goal}
              maxLength={40}
              placeholder="例如：期末复习、30 天入门"
              onChange={(event) => setGoal(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void start()
              }}
            />

            {error && <p className="ai-fill-error">{error}</p>}

            {details.length > 0 && (
              <ul className="ai-fill-details">
                {details.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}

            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void start()}>
                生成
              </button>
            </div>
          </>
        )}

        {stage === 'loading' && (
          <>
            <div className="ai-fill-loading" role="status" aria-live="polite">
              <span className="ai-fill-spinner" aria-hidden="true" />
              <span>{hint}</span>
            </div>
            <p className="ai-fill-note">联网检索通常需要 15–40 秒，最长等 60 秒。</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={cancel}>
                取消
              </button>
            </div>
          </>
        )}

        {stage === 'preview' && result && (
          <>
            <div className="ai-fill-preview">
              <p className="ai-fill-root">{result.root}</p>
              <p className="ai-fill-meta">
                {chapters.length} 个章节 · {total} 个节点 · {COURSE_SHAPE.levels.length} 层
              </p>
              <ul className="ai-fill-chapters">
                {chapters.slice(0, 5).map((chapter, index) => (
                  <li key={`${chapter.title}-${index}`}>
                    <span>{chapter.title}</span>
                    <em>{chapter.children?.length ?? 0} 个知识点</em>
                  </li>
                ))}
              </ul>
              {chapters.length > 5 && (
                <p className="ai-fill-note">还有 {chapters.length - 5} 个章节未展示</p>
              )}
            </div>

            {details.length > 0 && (
              <div className="ai-fill-error">
                结构没通过校验，先别建树：
                <ul className="ai-fill-details">
                  {details.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="dialog-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setStage('idle')
                  setResult(null)
                }}
              >
                重新描述
              </button>
              {details.length === 0 && (
                <button type="button" className="btn btn-primary" onClick={confirm}>
                  建成这棵树
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
