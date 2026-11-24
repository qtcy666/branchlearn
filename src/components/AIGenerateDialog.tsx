import { useEffect, useRef, useState } from 'react'
import type { Tree } from '../types/tree'
import { useTreeStore } from '../store/useTreeStore'
import { mockGenerate, schemaToTree } from '../lib/aiGenerate'
import { diffTrees, flattenDiff, type DiffKind, type TreeDiff } from '../lib/treeDiff'
import type { SchemaTree } from '../lib/treeSchema'

type Stage = 'idle' | 'loading' | 'preview' | 'applied' | 'error'

const KIND_MARK: Record<DiffKind, string> = {
  added: '+',
  changed: '~',
  removed: '−',
  same: ' ',
}

const KIND_LABEL: Record<DiffKind, string> = {
  added: '新增',
  changed: '修改',
  removed: '删除',
  same: '不变',
}

interface Props {
  onClose: () => void
  /** 传入表示「对比并替换这棵树」；不传表示新建一棵。 */
  tree?: Tree | null
  onApplied?: (treeId: string) => void
}

export function AIGenerateDialog({ onClose, tree = null, onApplied }: Props) {
  const applyGenerated = useTreeStore((s) => s.applyGenerated)
  const undoGenerated = useTreeStore((s) => s.undoGenerated)
  const notify = useTreeStore((s) => s.notify)

  const [stage, setStage] = useState<Stage>('idle')
  const [topic, setTopic] = useState(tree?.title ?? '')
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [schema, setSchema] = useState<SchemaTree | null>(null)
  const [diff, setDiff] = useState<TreeDiff | null>(null)
  const [error, setError] = useState('')

  const controller = useRef<AbortController | null>(null)

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
    }
  }, [onClose])

  const cancel = () => {
    controller.current?.abort()
    controller.current = null
    setStage('idle')
  }

  const start = async () => {
    const text = topic.trim()
    if (!text) {
      setError('先写一个主题，例如「线性代数」。')
      setStage('error')
      return
    }

    controller.current?.abort()
    const ac = new AbortController()
    controller.current = ac

    setStage('loading')
    setError('')
    setSchema(null)
    setDiff(null)
    setDone(0)
    setTotal(0)

    try {
      for await (const event of mockGenerate(text, ac.signal)) {
        if (ac.signal.aborted) return
        if (event.type === 'progress') {
          setDone(event.done)
          setTotal(event.total)
        } else {
          setSchema(event.tree)
          setDiff(diffTrees(tree, event.tree))
          setStage('preview')
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError('生成失败，请重试。')
      setStage('error')
    }
  }

  const apply = () => {
    if (!schema) return
    const generated = schemaToTree(schema, tree?.description ?? '')
    const id = applyGenerated(generated, tree?.id ?? null)
    if (!id) {
      setError('应用失败：找不到当前树，请刷新后重试。')
      setStage('error')
      return
    }
    setStage('applied')
    notify('已应用 AI 生成，按 Ctrl+Z 可撤销。')
    onApplied?.(id)
  }

  const revert = () => {
    undoGenerated()
    setStage('preview')
  }

  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  const rows = diff ? flattenDiff(diff.root) : []

  return (
    <div className="overlay" role="presentation">
      <div
        className="dialog ai-gen"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-gen-title"
      >
        <h2 id="ai-gen-title" className="dialog-title">
          用 AI 生成知识树
        </h2>
        <p className="dialog-desc">
          {tree ? `先生成预览，确认后再替换「${tree.title}」。` : '先生成预览，确认后再加入课程列表。'}
        </p>

        {(stage === 'idle' || stage === 'error') && (
          <>
            <label className="ai-fill-label" htmlFor="ai-gen-topic">
              学什么
            </label>
            <input
              id="ai-gen-topic"
              className="ai-fill-input"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void start()
              }}
              placeholder="例如：线性代数、概率论、数据结构"
              maxLength={40}
              autoFocus
            />
            {stage === 'error' && error && <p className="ai-fill-error">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void start()}>
                生成预览
              </button>
            </div>
          </>
        )}

        {stage === 'loading' && (
          <>
            <div className="ai-gen-progress" role="status" aria-live="polite">
              <span>
                正在生成 {done}/{total || '…'} 个节点
              </span>
              <span>{percent}%</span>
            </div>
            <div className="ai-gen-bar" aria-hidden="true">
              <i style={{ width: `${percent}%` }} />
            </div>
            <p className="ai-fill-note">这是本地 mock，不会联网，也不会产生费用。</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={cancel}>
                取消
              </button>
            </div>
          </>
        )}

        {stage === 'preview' && diff && (
          <>
            <div className="ai-gen-stats">
              <span className="ai-gen-stat ai-gen-stat--added">
                新增 {diff.added}
              </span>
              <span className="ai-gen-stat ai-gen-stat--changed">
                修改 {diff.changed}
              </span>
              <span className="ai-gen-stat ai-gen-stat--removed">
                删除 {diff.removed}
              </span>
            </div>

            <div className="ai-gen-diff" role="list" aria-label="变更预览">
              {rows.map((row, index) => (
                <div
                  key={`${row.depth}-${index}-${row.title}`}
                  className={`ai-gen-row ai-gen-row--${row.kind}`}
                  style={{ paddingLeft: 8 + row.depth * 18 }}
                  role="listitem"
                >
                  <span className="ai-gen-mark" aria-hidden="true">
                    {KIND_MARK[row.kind]}
                  </span>
                  <span className="ai-gen-title">{row.title}</span>
                  <span className="ai-gen-kind">{KIND_LABEL[row.kind]}</span>
                </div>
              ))}
            </div>

            <p className="ai-fill-note">
              应用后会生成新节点并标记来源为 AI，坐标和布局仍由本地计算。
            </p>

            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setStage('idle')}>
                丢弃
              </button>
              <button type="button" className="btn btn-primary" onClick={apply}>
                应用
              </button>
            </div>
          </>
        )}

        {stage === 'applied' && (
          <>
            <p className="ai-gen-done" role="status" aria-live="polite">
              已应用。需要还原的话，点「撤销」即可回到应用前。
            </p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={revert}>
                撤销
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
