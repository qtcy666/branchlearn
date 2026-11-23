import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { countNodes, type Tree } from '../types/tree'
import { computeProgress } from '../lib/status'
import { useTreeStore } from '../store/useTreeStore'
import type { Template } from '../data/templates'
import { EmptyState } from './EmptyState'
import { ConfirmDialog } from './ConfirmDialog'
import { ImportDialog } from './ImportDialog'
import { AIFillDialog } from './AIFillDialog'

interface Props {
  trees: Tree[]
  onOpen: (id: string) => void
  onNew: () => void
  onUseTemplate: (template: Template) => void
  onHome: () => void
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < day * 30) return `${Math.floor(diff / day)} 天前`
  return new Date(timestamp).toLocaleDateString('zh-CN')
}

export function HomeView({ trees, onOpen, onNew, onUseTemplate, onHome }: Props) {
  const deleteTree = useTreeStore((s) => s.deleteTree)
  const notify = useTreeStore((s) => s.notify)

  const [managing, setManaging] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null)
  const [undo, setUndo] = useState<{ trees: Tree[]; message: string } | null>(null)
  const undoTimer = useRef<number | null>(null)
  const restoreTrees = useTreeStore((s) => s.restoreTrees)

  useEffect(() => {
    return () => {
      if (undoTimer.current) window.clearTimeout(undoTimer.current)
    }
  }, [])

  const handleUndo = () => {
    if (!undo) return
    restoreTrees(undo.trees)
    setUndo(null)
    if (undoTimer.current) window.clearTimeout(undoTimer.current)
    notify('已撤销删除。')
  }

  const undoToast = undo ? (
    <div className="undo-toast" role="status" aria-live="polite">
      <span>{undo.message}</span>
      <button type="button" className="undo-btn" onClick={handleUndo}>
        撤销
      </button>
    </div>
  ) : null

  if (trees.length === 0) {
    return (
      <>
        <EmptyState
          onCreate={onNew}
          onUseTemplate={onUseTemplate}
          onAIGenerate={() => setAiOpen(true)}
        />
        {aiOpen && <AIFillDialog onClose={() => setAiOpen(false)} />}
        {undoToast}
      </>
    )
  }

  const totalNodes = trees.reduce((sum, tree) => sum + countNodes(tree.root), 0)
  const avgProgress = Math.round(
    trees.reduce((sum, tree) => sum + computeProgress(tree.root).percent, 0) / trees.length,
  )

  const toggleSelect = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))

  const exitManaging = () => {
    setManaging(false)
    setSelected([])
  }

  const handleCardKey = (event: KeyboardEvent<HTMLDivElement>, id: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    if (managing) toggleSelect(id)
    else onOpen(id)
  }

  const confirmDelete = () => {
    if (!pendingDelete) return
    const removed = trees.filter((tree) => pendingDelete.includes(tree.id))
    pendingDelete.forEach((id) => deleteTree(id))
    setPendingDelete(null)
    exitManaging()
    if (removed.length === 0) return

    if (undoTimer.current) window.clearTimeout(undoTimer.current)
    setUndo({
      trees: removed,
      message:
        removed.length > 1 ? `已删除 ${removed.length} 棵树` : `已删除「${removed[0]?.title ?? ''}」`,
    })
    undoTimer.current = window.setTimeout(() => setUndo(null), 6000)
  }

  return (
    <section className="home">
      <header className="home-hero">
        <div>
          <button type="button" className="home-back" onClick={onHome}>
            <span aria-hidden="true">←</span>
            首页
          </button>
          <p className="home-eyebrow">树学</p>
          <h1 className="home-title">今天学什么？</h1>
          <p className="home-sub">把一门课拆成能一个个打勾的节点，剩下的交给今天。</p>
        </div>
        <div className="home-stats">
          <div className="home-stat">
            <strong>{trees.length}</strong>
            <span>门课</span>
          </div>
          <div className="home-stat">
            <strong>{totalNodes}</strong>
            <span>个节点</span>
          </div>
          <div className="home-stat">
            <strong>{avgProgress}%</strong>
            <span>平均进度</span>
          </div>
        </div>
      </header>

      <div className="home-bar">
        <h2 className="home-bar-title">全部课程</h2>
        <div className="home-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => (managing ? exitManaging() : setManaging(true))}
          >
            {managing ? '完成' : '管理'}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setImportOpen(true)}
          >
            导入 JSON
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setAiOpen(true)}
          >
            用 AI 生成
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onNew}>
            新建一棵树
          </button>
        </div>
      </div>

      <div className="course-grid">
        {trees.map((tree) => {
          const progress = computeProgress(tree.root)
          const isSelected = selected.includes(tree.id)
          return (
            <div
              key={tree.id}
              role="button"
              tabIndex={0}
              className={`course-card${managing ? ' is-managing' : ''}${isSelected ? ' is-selected' : ''}`}
              onClick={() => (managing ? toggleSelect(tree.id) : onOpen(tree.id))}
              onKeyDown={(event) => handleCardKey(event, tree.id)}
            >
              <div className="course-card-top">
                <span className="course-card-title">{tree.title}</span>
                {managing ? (
                  <span className={`course-check${isSelected ? ' is-on' : ''}`} aria-hidden="true" />
                ) : (
                  <>
                    <span className="course-card-percent">{progress.percent}%</span>
                    <button
                      type="button"
                      className="course-card-remove"
                      aria-label={`删除 ${tree.title}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        setPendingDelete([tree.id])
                      }}
                    >
                      ×
                    </button>
                  </>
                )}
              </div>

              {tree.description && <p className="course-card-desc">{tree.description}</p>}

              <div className="course-card-progress">
                <div
                  className="course-card-progress-fill"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>

              <div className="course-card-meta">
                <span>{countNodes(tree.root)} 个节点</span>
                <span>{relativeTime(tree.updatedAt)}</span>
              </div>
            </div>
          )
        })}
      </div>

      {managing && (
        <div className="bulk-bar">
          <span className="bulk-count">
            已选 {selected.length} / {trees.length}
          </span>
          <div className="bulk-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                setSelected(selected.length === trees.length ? [] : trees.map((tree) => tree.id))
              }
            >
              {selected.length === trees.length ? '取消全选' : '全选'}
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={selected.length === 0}
              onClick={() => setPendingDelete(selected)}
            >
              删除所选
            </button>
          </div>
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.length > 1 ? `删除 ${pendingDelete.length} 棵树？` : '删除这棵树？'}
          message="删除后 6 秒内可以撤销，超时后浏览器里的本地数据会一起清掉。"
          confirmText="删除"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {undoToast}

      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
      {aiOpen && <AIFillDialog onClose={() => setAiOpen(false)} />}
    </section>
  )
}
