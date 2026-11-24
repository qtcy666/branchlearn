import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import type { Tree } from '../types/tree'
import { useTreeStore } from '../store/useTreeStore'
import { collectCandidates, computeProgress } from '../lib/status'
import { buildShareUrl, MAX_SHARE_URL_LENGTH } from '../lib/share'
import { exportTreeAsPng } from '../lib/exportImage'
import { ProgressBar } from './ProgressBar'
import { TodayPanel } from './TodayPanel'
import { TreeCanvas } from './TreeCanvas'
import { RadialTree } from './RadialTree'

// 3D 视图整包是 three + ez-tree，占了大半体积，却又不是每次都会点开。
// 拆成独立 chunk 后首屏少加载几 MB，顺带让无头冒烟测试不必在 Node 里碰 WebGL。
const Tree3D = lazy(() => import('./Tree3D').then((mod) => ({ default: mod.Tree3D })))
import { EditableTitle } from './EditableTitle'
import { ConfirmDialog } from './ConfirmDialog'
import { NoticeBar } from './NoticeBar'
import { FeedbackWidget } from './FeedbackWidget'
import { AIGenerateDialog } from './AIGenerateDialog'

interface Props {
  tree: Tree
  onBack: () => void
}

/** 三种看法：纵向树（动手改）/ 放射树（看全局形状）/ 3D 树（看的爽）。 */
type ViewMode = 'canvas' | 'radial' | 'tree3d'

/**
 * 3D 视图暂时下线：实现完整保留（Tree3D + tree3dShape/branchLabels），
 * 只是不放进切换器，免得用户点进去看到还没打磨好的效果。
 * 下个版本把这里改成 true，入口就回来了。
 */
const TREE3D_ENABLED = false

const ALL_VIEW_MODES: { key: ViewMode; label: string }[] = [
  { key: 'canvas', label: '树状' },
  { key: 'radial', label: '放射' },
  { key: 'tree3d', label: '3D' },
]

const VIEW_MODES = ALL_VIEW_MODES.filter((mode) => TREE3D_ENABLED || mode.key !== 'tree3d')

function safeFileName(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, '-').trim()
  return cleaned || 'branchlearn'
}

export function TreeWorkspace({ tree, onBack }: Props) {
  const saveState = useTreeStore((s) => s.saveState)
  const renameTree = useTreeStore((s) => s.renameTree)
  const deleteTree = useTreeStore((s) => s.deleteTree)
  const notify = useTreeStore((s) => s.notify)

  const [renaming, setRenaming] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [todayOpen, setTodayOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [view, setView] = useState<ViewMode>('canvas')

  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handleDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleDown)
    return () => document.removeEventListener('mousedown', handleDown)
  }, [menuOpen])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTodayOpen(false)
        setMenuOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const progress = computeProgress(tree.root)
  const todayCount = useMemo(() => collectCandidates(tree.root).length, [tree.root])

  const handleExport = () => {
    const data = JSON.stringify(tree, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const date = new Date().toISOString().slice(0, 10)
    anchor.href = url
    anchor.download = `branchlearn-${safeFileName(tree.title)}-${date}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    setMenuOpen(false)
  }

  const handleExportImage = async () => {
    setMenuOpen(false)
    try {
      await exportTreeAsPng(tree)
    } catch (error) {
      notify(error instanceof Error ? error.message : '导出图片失败')
    }
  }

  const handleShare = async () => {
    setMenuOpen(false)
    const url = buildShareUrl(tree)
    if (url.length > MAX_SHARE_URL_LENGTH) {
      notify(
        `这棵树太大，分享链接有 ${url.length} 个字符，部分聊天软件会截断。建议改用「导出 JSON」。`,
      )
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      notify('分享链接已复制。发给同学，他们打开就能看到这棵树的只读版本。')
    } catch {
      window.prompt('复制这个链接发给同学：', url)
    }
  }

  return (
    <div className="workspace">
      <header className="workspace-bar">
        <button type="button" className="workspace-back" onClick={onBack}>
          <span aria-hidden="true">←</span> 全部课程
        </button>

        <div className="workspace-heading">
          {renaming ? (
            <EditableTitle
              className="workspace-title-input"
              value={tree.title}
              onCommit={(title) => {
                renameTree(tree.id, title)
                setRenaming(false)
              }}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <h1
              className="workspace-title"
              onDoubleClick={() => setRenaming(true)}
              title="双击改名"
            >
              {tree.title}
            </h1>
          )}
          <span className={`workspace-save workspace-save--${saveState}`}>
            {saveState === 'saving' ? '保存中' : saveState === 'saved' ? '已保存' : ''}
          </span>
        </div>

        <div className="workspace-progress">
          <ProgressBar progress={progress} />
        </div>

        <div className="workspace-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm today-trigger"
            onClick={() => setTodayOpen(true)}
          >
            今天做什么
            {todayCount > 0 && <span className="today-badge">{todayCount}</span>}
          </button>

          <div className="view-switch" role="group" aria-label="切换视图">
            {VIEW_MODES.map((mode) => (
              <button
                key={mode.key}
                type="button"
                className={`view-switch-btn${view === mode.key ? ' is-active' : ''}`}
                onClick={() => setView(mode.key)}
                aria-pressed={view === mode.key}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <div className="tree-menu" ref={menuRef}>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="这棵树的更多操作"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <circle cx="3" cy="7" r="1.4" fill="currentColor" />
                <circle cx="7" cy="7" r="1.4" fill="currentColor" />
                <circle cx="11" cy="7" r="1.4" fill="currentColor" />
              </svg>
            </button>

            {menuOpen && (
              <div className="menu" role="menu">
                <button
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  onClick={() => {
                    setRenaming(true)
                    setMenuOpen(false)
                  }}
                >
                  重命名这棵树
                </button>
                <button type="button" className="menu-item" role="menuitem" onClick={handleExport}>
                  导出 JSON
                </button>
                <button
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  onClick={handleExportImage}
                >
                  导出图片
                </button>
                <button type="button" className="menu-item" role="menuitem" onClick={handleShare}>
                  复制分享链接
                </button>
                <button
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  onClick={() => {
                    setAiOpen(true)
                    setMenuOpen(false)
                  }}
                >
                  用 AI 重新生成
                </button>
                <button
                  type="button"
                  className="menu-item menu-item--danger"
                  role="menuitem"
                  onClick={() => {
                    setConfirmDelete(true)
                    setMenuOpen(false)
                  }}
                >
                  删除这棵树
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <NoticeBar />

      <div
        className={`workspace-body${view === 'tree3d' ? ' workspace-body--3d' : ''}${
          view === 'radial' ? ' workspace-body--radial' : ''
        }`}
      >
        {view === 'canvas' && <TreeCanvas tree={tree} />}
        {view === 'radial' && <RadialTree tree={tree} />}
        {view === 'tree3d' && (
          <Suspense
            fallback={
              <div className="view-loading">
                <span className="view-loading-dot" />
                正在生成 3D 树…
              </div>
            }
          >
            <Tree3D tree={tree} />
          </Suspense>
        )}
      </div>

      {todayOpen && (
        <div
          className="drawer-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setTodayOpen(false)
          }}
        >
          <aside className="drawer" role="dialog" aria-modal="true" aria-label="今天做什么">
            <div className="drawer-head">
              <span className="drawer-title">今天做什么</span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setTodayOpen(false)}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <TodayPanel tree={tree} />
            <FeedbackWidget tree={tree} />
          </aside>
        </div>
      )}

      {aiOpen && <AIGenerateDialog tree={tree} onClose={() => setAiOpen(false)} />}

      {confirmDelete && (
        <ConfirmDialog
          title="删除整棵树？"
          message={`「${tree.title}」以及它的全部节点都会被删除，且无法撤销。如果只是想重新开始，建议先导出 JSON 备份。`}
          confirmText="删除"
          danger
          onConfirm={() => {
            deleteTree(tree.id)
            setConfirmDelete(false)
            onBack()
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}
