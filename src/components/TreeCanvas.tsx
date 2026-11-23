import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from 'react'
import { useTreeStore } from '../store/useTreeStore'
import { DONE_COLORS, isSolidTier } from '../lib/colors'
import { displayStatus } from '../lib/status'
import { countDescendants, findNode, isDescendant } from '../lib/treeOps'
import { DEFAULT_GAPS, PADDING, edgePath, layoutTreeVisual, type TreeGaps } from '../lib/treeLayout'
import {
  DEFAULT_LEVEL_NAMES,
  type NodeStatus,
  type Tree,
  type TreeNode,
} from '../types/tree'
import { EditableTitle } from './EditableTitle'
import { ConfirmDialog } from './ConfirmDialog'
import { PromptDialog } from './PromptDialog'

const STATUS_LABEL: Record<NodeStatus, string> = {
  todo: '未开始',
  learning: '在学',
  done: '已掌握',
}

// 自动适配的下限：低于这个比例，13px 字会被缩到读不出来（<7px），
// 那时宁可让画布横向滚动，也不再把整棵树硬塞进视口。
// 「适配」的下限：再小就只剩一片灰点，没有意义。
// 这棵树是 23 个叶子横排（固有宽高比约 10.7:1），0.72 会让 1280 视口也装不下，
// 所以降到 0.42——宽屏刚好整棵可见，文字仍在可读边缘。
const MIN_FIT_SCALE = 0.42
// 手动缩放的极限：允许用户主动拉到很小去看全貌
const MIN_SCALE = 0.1
const MAX_SCALE = 3

interface DeleteTarget {
  id: string
  title: string
  count: number
}

interface Props {
  tree: Tree
}

export function TreeCanvas({ tree }: Props) {
  const addChild = useTreeStore((s) => s.addChild)
  const renameNode = useTreeStore((s) => s.renameNode)
  const deleteNode = useTreeStore((s) => s.deleteNode)
  const toggleCollapse = useTreeStore((s) => s.toggleCollapse)
  const moveNode = useTreeStore((s) => s.moveNode)
  const cycleNodeStatus = useTreeStore((s) => s.cycleNodeStatus)
  const renameLevel = useTreeStore((s) => s.renameLevel)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<DeleteTarget | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [editingLevel, setEditingLevel] = useState<number | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [levelDraft, setLevelDraft] = useState('')

  /**
   * 悬停高亮：鼠标停在一个节点上时，只留下它自己、它的祖先链和整棵子树，
   * 其余分支淡出。对应 ECharts 的 emphasis.focus: 'descendant'，但这里
   * 还能顺带保留祖先链——不然从根到该节点的路径会断开，看不出它挂在哪。
   */
  const treeIndex = useMemo(() => {
    const parent = new Map<string, string | null>()
    const children = new Map<string, string[]>()
    const walk = (node: TreeNode, parentId: string | null) => {
      parent.set(node.id, parentId)
      children.set(
        node.id,
        node.children.map((child) => child.id),
      )
      for (const child of node.children) walk(child, node.id)
    }
    walk(tree.root, null)
    return { parent, children }
  }, [tree.root])

  const isDim = useMemo(() => {
    if (!hoverId) return null
    const keep = new Set<string>([hoverId])

    let cursor = treeIndex.parent.get(hoverId) ?? null
    while (cursor) {
      keep.add(cursor)
      cursor = treeIndex.parent.get(cursor) ?? null
    }

    const stack = [...(treeIndex.children.get(hoverId) ?? [])]
    while (stack.length > 0) {
      const id = stack.pop() as string
      keep.add(id)
      stack.push(...(treeIndex.children.get(id) ?? []))
    }

    return (id: string) => !keep.has(id)
  }, [hoverId, treeIndex])

  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState({ width: 0, height: 0 })
  const [manualScale, setManualScale] = useState<number | null>(null)
  const [scrollTop, setScrollTop] = useState(0)

  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect
      setStage({ width: rect.width, height: rect.height })
    })
    observer.observe(element)
    // 有些环境（内嵌视口 / CDP 改尺寸）ResizeObserver 不回调，补一条窗口监听
    const sync = () => {
      const el = stageRef.current
      if (el) setStage({ width: el.clientWidth, height: el.clientHeight })
    }
    window.addEventListener('resize', sync)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [])

  // 三套间距从 CSS 变量读，JS 与样式保持同一份配置
  const gaps = useMemo<TreeGaps>(() => {
    if (typeof document === 'undefined') return DEFAULT_GAPS
    const cs = getComputedStyle(document.documentElement)
    const num = (name: string, fallback: number) => {
      const value = parseFloat(cs.getPropertyValue(name))
      return Number.isFinite(value) ? value : fallback
    }
    return {
      sibling: num('--gap-sibling', DEFAULT_GAPS.sibling),
      cousin: num('--gap-cousin', DEFAULT_GAPS.cousin),
      level: num('--gap-level', DEFAULT_GAPS.level),
      levelRoot: num('--gap-level-root', DEFAULT_GAPS.levelRoot),
      levelChapter: num('--gap-level-chapter', DEFAULT_GAPS.levelChapter),
      card: num('--gap-card', DEFAULT_GAPS.card),
    }
  }, [])

  const layout = useMemo(() => layoutTreeVisual(tree.root, gaps), [tree.root, gaps])

  // 章节序号：01-05 按同层从左到右的顺序
  const chapterBadges = useMemo(() => {
    const map = new Map<string, string>()
    layout.nodes
      .filter((item) => item.depth === 1)
      .forEach((item, index) => map.set(item.node.id, String(index + 1).padStart(2, '0')))
    return map
  }, [layout])

  // 切换课程时回到「自动适配」
  useEffect(() => {
    setManualScale(null)
  }, [tree.id])

  const canvasWidth = layout.width + PADDING * 2
  const canvasHeight = layout.height + PADDING * 2

  const usableWidth = Math.max(1, stage.width)
  const usableHeight = Math.max(1, stage.height)

  const fitAll = Math.min(usableWidth / canvasWidth, usableHeight / canvasHeight)
  // 完整放进视口；但如果会小到读不出字，就停在可读下限，让画布滚动
  const fillScale =
    stage.width > 0 && stage.height > 0
      ? Math.min(MAX_SCALE, Math.max(MIN_FIT_SCALE, fitAll))
      : 1
  const defaultScale = fillScale
  const scale = manualScale ?? defaultScale

  const scaledWidth = canvasWidth * scale
  const scaledHeight = canvasHeight * scale

  const contentWidth = Math.max(scaledWidth, stage.width)
  const contentHeight = Math.max(scaledHeight, stage.height)
  // 树在画布里居中；比视口大时回到 0（交给滚动）
  const canvasLeft = Math.max(0, (stage.width - scaledWidth) / 2)
  const canvasTop = Math.max(0, (stage.height - scaledHeight) / 2)

  const levels = useMemo(
    () =>
      Array.from({ length: layout.maxDepth + 1 }, (_, depth) => {
        const name = tree.levelNames[depth]?.trim() ?? ''
        const rawCenter =
          PADDING +
          (layout.levelTops[depth] ?? 0) +
          (layout.levelHeights[depth] ?? 0) / 2
        return {
          depth,
          name,
          top: canvasTop + rawCenter * scale,
        }
      }),
    [layout, tree.levelNames, canvasTop, scale],
  )

  // 缩放比例或课程变化时，把视野放到树的正中间（根节点在垂直中线上）
  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    const left = Math.max(0, (contentWidth - stage.width) / 2)
    const top = Math.max(0, (contentHeight - stage.height) / 2)
    element.scrollLeft = left
    element.scrollTop = top
    setScrollTop(top)
  }, [tree.id, scale, contentWidth, contentHeight, stage.width, stage.height])

  const rootLayoutNode = layout.nodes.find((item) => item.depth === 0)
  const addIndexY =
    (rootLayoutNode?.y ?? 0) + (rootLayoutNode?.height ?? layout.baseHeight) + layout.gapY

  const addingNode = addingTo ? findNode(tree.root, addingTo) : null

  const commitLevel = () => {
    if (editingLevel === null) return
    renameLevel(editingLevel, levelDraft)
    setEditingLevel(null)
  }

  const zoomBy = (factor: number) => {
    setManualScale(() => {
      const base = manualScale ?? defaultScale
      return Math.min(MAX_SCALE, Math.max(MIN_SCALE, base * factor))
    })
  }

  // 「适配」：恢复自动比例，并把视野放回树的正中间
  const handleFit = () => {
    setManualScale(null)
    requestAnimationFrame(() => {
      const element = stageRef.current
      if (!element) return
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_FIT_SCALE, fitAll))
      const width = Math.max(canvasWidth * nextScale, stage.width)
      const height = Math.max(canvasHeight * nextScale, stage.height)
      const left = stage.width < 720 ? 0 : Math.max(0, (width - stage.width) / 2)
      const top = Math.max(0, (height - stage.height) / 2)
      element.scrollLeft = left
      element.scrollTop = top
      setScrollTop(top)
    })
  }

  // 按住 ⌘ / Ctrl 滚轮缩放，和触控板双指缩放一致
  useEffect(() => {
    const element = stageRef.current
    if (!element) return

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      zoomBy(event.deltaY > 0 ? 1 / 1.08 : 1.08)
    }

    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [zoomBy])


  const handleDragOver = (event: DragEvent<HTMLDivElement>, node: TreeNode) => {
    if (!dragId || dragId === node.id) return
    if (isDescendant(tree.root, dragId, node.id)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTargetId(node.id)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>, node: TreeNode) => {
    event.preventDefault()
    const dragged = dragId
    setDragId(null)
    setDropTargetId(null)
    if (!dragged || dragged === node.id) return
    if (isDescendant(tree.root, dragged, node.id)) return
    moveNode(dragged, node.id, node.children.length)
  }

  return (
    <div
      className={`canvas-area${scale < 0.6 ? ' is-zoom-low' : ''}`}
      style={{ '--canvas-scale': String(scale), '--node-w': `${layout.baseWidth}px`, '--node-h': `${layout.baseHeight}px` } as CSSProperties}
    >
      {layout.levelTops.length > 0 && (
      <div className="canvas-levels">
        {levels.map((level) => (
          <div key={level.depth} className="canvas-level-slot" style={{ top: level.top - scrollTop }}>
            {editingLevel === level.depth ? (
              <input
                className="canvas-level-input"
                value={levelDraft}
                placeholder={DEFAULT_LEVEL_NAMES[level.depth] || `第 ${level.depth + 1} 层`}
                autoFocus
                maxLength={12}
                aria-label={`第 ${level.depth + 1} 层的名称`}
                onChange={(event) => setLevelDraft(event.target.value)}
                onBlur={commitLevel}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitLevel()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    setEditingLevel(null)
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="canvas-level"
                onClick={() => {
                  setEditingLevel(level.depth)
                  setLevelDraft(level.name)
                }}
                title="点击改这一层的名字"
              >
                {level.name || DEFAULT_LEVEL_NAMES[level.depth] || `第 ${level.depth + 1} 层`}
              </button>
            )}
          </div>
        ))}
      </div>
      )}
      <div
        className="canvas-stage"
        ref={stageRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onMouseLeave={() => setHoverId(null)}
      >
        <div
          className="canvas-content"
          style={{
            width: contentWidth,
            height: contentHeight,
          }}
        >
          <div
            className="canvas"
            style={{
              width: canvasWidth,
              height: canvasHeight,
              left: canvasLeft,
              top: canvasTop,
              transform: `scale(${scale})`,
              transformOrigin: '0 0',
            }}
          >
          <svg
            className="canvas-edges"
            width={canvasWidth}
            height={canvasHeight}
            aria-hidden="true"
          >
            <g transform={`translate(${PADDING}, ${PADDING})`}>
              {(layout.decorations ?? []).map((line) => (
                <path
                  key={line.id}
                  d={line.d}
                  className={
                    isDim && line.chapterId && isDim(line.chapterId) ? 'is-dim' : undefined
                  }
                  fill="none"
                  stroke={
                    line.kind === 'root'
                      ? '#2F6B4F'
                      : line.kind === 'bus'
                        ? 'rgba(47, 107, 79, 0.18)'
                        : 'rgba(47, 107, 79, 0.55)'
                  }
                  strokeWidth={line.kind === 'root' ? 2 : 1.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {layout.edges.map((edge) => (
                  <path
                    key={`${edge.from.node.id}-${edge.to.node.id}`}
                    d={edgePath(edge.from, edge.to)}
                    className={isDim && isDim(edge.to.node.id) ? 'is-dim' : undefined}
                    fill="none"
                    stroke="rgba(47, 107, 79, 0.42)"
                    strokeWidth={edge.to.depth <= 1 ? 1.8 : 1.2}
                    strokeLinecap="round"
                  />
              ))}
            </g>
          </svg>

          {layout.nodes.map((item) => {
            const node = item.node
            const isRoot = item.depth === 0
            const status = displayStatus(node)
            const isDone = status === 'done'
            // 有子节点的节点：状态只读，由子节点汇总决定
            const isDerived = node.children.length > 0
            const isRenaming = renamingId === node.id
            const isDropTarget = dropTargetId === node.id

            return (
              <div
                key={node.id}
                className={[
                  'canvas-node',
                  isSolidTier(item.depth) ? 'is-solid' : 'is-soft',
                  isDim && isDim(node.id) ? 'is-dim' : '',
                  isDropTarget ? 'is-drop' : '',
                  dragId === node.id ? 'is-dragging' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-depth={item.depth}
                data-status={status}
                style={{
                  left: item.x + PADDING,
                  top: item.y + PADDING,
                  width: item.width,
                  height: item.height,
                  // 完成 = 金，未完成 = 层级绿；整块材质一起换，保证卡片和连线不打架
                  '--node-color': isDone ? DONE_COLORS.core : item.color,
                  '--node-soft': isDone ? DONE_COLORS.light : item.soft,
                  '--node-soft-border': isDone ? DONE_COLORS.border : item.softBorder,
                  '--node-ink': isDone ? DONE_COLORS.ink : item.ink,
                } as CSSProperties}
                draggable={!isRoot && !isRenaming}
                onMouseEnter={() => setHoverId(node.id)}
                onMouseLeave={() => setHoverId((current) => (current === node.id ? null : current))}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', node.id)
                  setDragId(node.id)
                }}
                onDragOver={(event) => handleDragOver(event, node)}
                onDragLeave={() =>
                  setDropTargetId((current) => (current === node.id ? null : current))
                }
                onDrop={(event) => handleDrop(event, node)}
                onDragEnd={() => {
                  setDragId(null)
                  setDropTargetId(null)
                }}
                onDoubleClick={() => {
                  if (!isRenaming) setRenamingId(node.id)
                }}
              >
                {chapterBadges.has(node.id) && (
                  <span className="canvas-badge">{chapterBadges.get(node.id)}</span>
                )}

                <button
                  type="button"
                  className={[
                    'status-dot',
                    `status-dot--${status}`,
                    isDerived ? 'status-dot--auto' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={
                    isDerived
                      ? undefined
                      : (event) => {
                          event.stopPropagation()
                          cycleNodeStatus(node.id)
                        }
                  }
                  onDoubleClick={(event) => event.stopPropagation()}
                  aria-disabled={isDerived || undefined}
                  title={
                    isDerived
                      ? '完成状态由子节点自动汇总：下面全部完成后自动变金'
                      : '点击切换：未开始 → 在学 → 已掌握'
                  }
                  aria-label={
                    isDerived
                      ? `状态：${STATUS_LABEL[status]}（由子节点汇总）`
                      : `状态：${STATUS_LABEL[status]}，点击切换`
                  }
                />

                {isRenaming ? (
                  <EditableTitle
                    className="canvas-input"
                    value={node.title}
                    onCommit={(title) => {
                      renameNode(node.id, title)
                      setRenamingId(null)
                    }}
                    onCancel={() => setRenamingId(null)}
                  />
                ) : (
                  <span
                    className="canvas-title"
                    title={node.title ? `${node.title}（双击改名）` : '双击起名'}
                  >
                    {node.title ? (
                      item.lines.join('\n')
                    ) : (
                      <span className="canvas-title-empty">未命名</span>
                    )}
                  </span>
                )}

                {item.depth === 1 && (
                  <i
                    className="canvas-progress"
                    data-status={status}
                    onClick={
                      isDerived
                        ? undefined
                        : (event) => {
                            event.stopPropagation()
                            cycleNodeStatus(node.id)
                          }
                    }
                    title={
                      isDerived
                        ? `进度：${STATUS_LABEL[status]}（由子节点汇总）`
                        : `进度：${STATUS_LABEL[status]}（点击切换）`
                    }
                    onDoubleClick={(event) => event.stopPropagation()}
                  />
                )}

                <span className="canvas-actions" onDoubleClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    className="canvas-action"
                    onClick={() => setAddingTo(node.id)}
                    title="添加子节点"
                    aria-label={`在「${node.title}」下添加节点`}
                  >
                    ＋
                  </button>
                  {!isRoot && (
                    <>
                      <button
                        type="button"
                        className="canvas-action canvas-action--danger"
                        onClick={() =>
                          setPendingDelete({
                            id: node.id,
                            title: node.title,
                            count: countDescendants(node),
                          })
                        }
                        title="删除"
                        aria-label={`删除「${node.title}」`}
                      >
                        ×
                      </button>
                    </>
                  )}
                </span>

                {node.children.length > 0 && (
                  <button
                    type="button"
                    className={`canvas-handle ${node.collapsed ? 'is-collapsed' : ''}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleCollapse(node.id)
                    }}
                    title={node.collapsed ? `展开 ${node.children.length} 个子节点` : '折叠'}
                    aria-label={node.collapsed ? '展开' : '折叠'}
                    aria-expanded={!node.collapsed}
                  >
                    {node.collapsed ? node.children.length : '−'}
                  </button>
                )}
              </div>
            )
          })}

          {tree.root.children.length === 0 && (
            <button
              type="button"
              className="canvas-add-first"
              style={{
                left: PADDING + (layout.nodes[0]?.x ?? 0),
                top: PADDING + addIndexY,
              }}
              onClick={() => setAddingTo(tree.root.id)}
            >
              ＋ 添加第一章
            </button>
          )}
          </div>
        </div>
      </div>

      <div className="canvas-zoom">
          <button type="button" onClick={() => zoomBy(1 / 1.15)} aria-label="缩小">
            −
          </button>
          <button
            type="button"
            className="canvas-zoom-value"
            onClick={handleFit}
            title="恢复到自动适配"
          >
            {Math.round(scale * 100)}%
          </button>
          <button type="button" onClick={() => zoomBy(1.15)} aria-label="放大">
            +
          </button>
          <span className="canvas-zoom-sep" aria-hidden="true" />
          <button
            type="button"
            className="canvas-zoom-fit"
            onClick={handleFit}
            title="恢复最佳比例"
          >
            适配
          </button>
        </div>

      {addingNode && (
        <PromptDialog
          title={
            addingNode.children.length === 0 ? '添加子节点' : `在「${addingNode.title}」下添加`
          }
          description="回车确认。之后可以双击改名、拖动调整层级。"
          placeholder="例如：矩阵的乘法"
          onSubmit={(title) => {
            addChild(addingNode.id, title)
            setAddingTo(null)
          }}
          onClose={() => setAddingTo(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="删除这个节点？"
          message={
            pendingDelete.count > 0
              ? `「${pendingDelete.title}」及其下的 ${pendingDelete.count} 个子节点会被一起删除，且无法撤销。`
              : `「${pendingDelete.title}」会被删除，且无法撤销。`
          }
          confirmText="删除"
          danger
          onConfirm={() => {
            deleteNode(pendingDelete.id)
            setPendingDelete(null)
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
