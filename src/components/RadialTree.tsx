import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useTreeStore } from '../store/useTreeStore'
import { displayStatus } from '../lib/status'
import { layoutRadial } from '../lib/radialTree'
import type { NodeStatus, Tree } from '../types/tree'

/**
 * 径向树视图。
 *
 * 定位：2D 纵向树回答「这一章下面有哪几节」，径向树回答「整门课摊开后是什么形状」。
 * 圆心是课程本身，每一环是一层，扇区的宽窄＝这块内容的体量。
 * 和 3D 树共用同一套状态与折叠语义，只是换了个投影。
 */

const STATUS_STROKE: Record<NodeStatus, string> = {
  todo: '#c9c1ad',
  learning: '#d08a2c',
  done: '#3f7a3a',
}

const MIN_ZOOM = 0.45
const MAX_ZOOM = 2.6

/** 拖动超过这个像素就不算点击，避免平移时误触状态。 */
const DRAG_SLOP = 5

/** 圆心那枚"课程本身"的圆盘半径，主干从这里长出去。 */
const CORE_R = 27

interface Props {
  tree: Tree
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 层级越浅线越粗：主干 6px，一级 3.4px，叶片级 1.8px。 */
function linkWidth(depth: number): number {
  if (depth <= 1) return 6
  if (depth === 2) return 3.4
  return 1.8
}

export function RadialTree({ tree }: Props) {
  const cycleNodeStatus = useTreeStore((s) => s.cycleNodeStatus)
  const toggleCollapse = useTreeStore((s) => s.toggleCollapse)

  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [hoverId, setHoverId] = useState<string | null>(null)

  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(
    null,
  )
  // 单击改状态要延后 220ms：双击折叠时浏览器会先派发两次 click，
  // 不挡一下就会出现「折叠的同时状态被切了两级」。
  const pendingClickRef = useRef<{ id: string; timer: number } | null>(null)

  useEffect(
    () => () => {
      if (pendingClickRef.current) window.clearTimeout(pendingClickRef.current.timer)
    },
    [],
  )

  const handleNodeClick = (id: string) => {
    if (dragRef.current) return
    const pending = pendingClickRef.current
    if (pending) {
      window.clearTimeout(pending.timer)
      pendingClickRef.current = null
      // 同一个节点连点两次 = 双击，交给 onDoubleClick 处理折叠
      if (pending.id === id) return
      // 点了另一个节点：把上一次欠下的切换补上，别吞掉用户的操作
      cycleNodeStatus(pending.id)
    }
    pendingClickRef.current = {
      id,
      timer: window.setTimeout(() => {
        pendingClickRef.current = null
        cycleNodeStatus(id)
      }, 220),
    }
  }

  useEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect
      setSize({ width: rect.width, height: rect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // 换一棵树就回到默认视角
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setHoverId(null)
  }, [tree.id])

  const viewportW = Math.max(1, size.width)
  const viewportH = Math.max(1, size.height)

  // 窄屏留白收窄：手机上本来就没多少横向空间，树干可以顶到边
  const compact = viewportW < 720
  // 窄屏要按"最外圈节点 + 最长标签"倒推半径，否则标签会被裁掉
  const radius = compact
    ? Math.max(84, Math.min(viewportW / 2 - 80, viewportH / 2 - 40))
    : Math.max(96, Math.min(viewportW, viewportH) / 2 - 96)

  const layout = useMemo(() => layoutRadial(tree.root, radius), [tree.root, radius])

  const nodeMap = useMemo(() => {
    const map = new Map<string, (typeof layout.nodes)[number]>()
    for (const node of layout.nodes) map.set(node.id, node)
    return map
  }, [layout.nodes])

  // hover 时高亮「根 → 该节点」这条枝，以及它的整棵子树
  const related = useMemo(() => {
    if (!hoverId) return null
    const hovered = nodeMap.get(hoverId)
    if (!hovered) return null
    const set = new Set<string>([hoverId])
    for (const id of hovered.ancestorIds) set.add(id)
    for (const node of layout.nodes) {
      if (node.ancestorIds.includes(hoverId)) set.add(node.id)
    }
    return set
  }, [hoverId, nodeMap, layout.nodes])

  const isDim = useCallback(
    (id: string) => related !== null && !related.has(id),
    [related],
  )

  // 滚轮缩放：React 的 onWheel 是 passive 的，preventDefault 只能自己挂
  useEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      setZoom((current) => clamp(current * Math.exp(-event.deltaY * 0.0012), MIN_ZOOM, MAX_ZOOM))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
      moved: false,
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) > DRAG_SLOP) {
      drag.moved = true
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    if (drag.moved) setPan({ x: drag.panX + dx, y: drag.panY + dy })
  }

  const handlePointerUp = () => {
    // 立刻清空会打断 click 的位移判定，所以延后一帧
    const drag = dragRef.current
    if (drag?.moved) {
      setTimeout(() => {
        dragRef.current = null
      }, 0)
    } else {
      dragRef.current = null
    }
  }

  const centerX = viewportW / 2 + pan.x
  const centerY = viewportH / 2 + pan.y

  return (
    <div className={`radial${compact ? ' is-compact' : ''}`} ref={wrapRef}>
      <svg
        className="radial-svg"
        width={viewportW}
        height={viewportH}
        viewBox={`0 0 ${viewportW} ${viewportH}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <g transform={`translate(${centerX} ${centerY}) scale(${zoom})`}>
          {/* 参考环：给层次一个隐形的刻度，不抢视线 */}
          {Array.from({ length: layout.maxDepth }, (_, index) => {
            const r = (radius / Math.max(1, layout.maxDepth)) * (index + 1)
            return (
              <circle
                key={`ring-${index}`}
                className="radial-ring"
                r={r}
                fill="none"
                stroke="currentColor"
                strokeWidth={1 / zoom}
                strokeDasharray={`${2 / zoom} ${6 / zoom}`}
              />
            )
          })}

          {/* 中心盘：整门课的本体，主干从它边缘长出去 */}
          <circle className="radial-core" r={CORE_R} fill="#ffffff" />

          {layout.links.map((link) => {
            const to = nodeMap.get(link.toId)
            const from = nodeMap.get(link.fromId)
            if (!to || !from) return null
            // 一级枝走直线：从中心盘沿自身角度直接射出，三条主干才不会拧在一起
            const d =
              from.depth === 0
                ? `M${(CORE_R * Math.cos(to.angle)).toFixed(2)},${(CORE_R * Math.sin(to.angle)).toFixed(2)} L${to.x.toFixed(2)},${to.y.toFixed(2)}`
                : link.path
            return (
              <path
                key={link.id}
                className={`radial-link${isDim(to.id) ? ' is-dim' : ''}`}
                d={d}
                fill="none"
                stroke={to.color}
                strokeWidth={linkWidth(to.depth) / zoom}
                strokeLinecap="round"
                strokeOpacity={to.depth <= 1 ? 0.46 : 0.3}
              />
            )
          })}

          {layout.nodes.map((node) => {
            const status = displayStatus(node.node)
            const dashed = node.collapsed
            const dim = isDim(node.id)
            const active = hoverId === node.id

            // 标签沿径向往外挪一点，再按角度决定文字伸向哪一边
            const isRoot = node.depth === 0
            const labelR = node.r + node.dot + (isRoot ? 14 : 9)
            const cos = Math.cos(node.angle)
            const sin = Math.sin(node.angle)
            // 根在圆心，角度没有意义，固定摆到圆点正下方
            const lx = isRoot ? 0 : labelR * cos
            const ly = isRoot ? 0 : labelR * sin
            const vertical = isRoot || Math.abs(cos) < 0.26
            const anchor = vertical ? 'middle' : cos > 0 ? 'start' : 'end'
            const dy = isRoot
              ? -CORE_R - 15
              : vertical
                ? sin > 0
                  ? node.dot + 12
                  : -node.dot - 8
                : node.dot * 0.5

            return (
              <g
                key={node.id}
                className={`radial-node${dim ? ' is-dim' : ''}${active ? ' is-active' : ''}`}
                onPointerEnter={() => setHoverId(node.id)}
                onPointerLeave={() => setHoverId((current) => (current === node.id ? null : current))}
                onClick={() => handleNodeClick(node.id)}
                onDoubleClick={(event) => {
                  event.stopPropagation()
                  if (node.node.children.length > 0) toggleCollapse(node.id)
                }}
              >
                {/* 扩大点击热区，圆点本身只有 4px */}
                <circle cx={node.x} cy={node.y} r={node.dot + 10} fill="transparent" />

                {dashed && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.dot + 4.5}
                    fill="none"
                    stroke={node.color}
                    strokeWidth={1.2 / zoom}
                    strokeDasharray={`${2.4 / zoom} ${2.4 / zoom}`}
                    strokeOpacity={0.75}
                  />
                )}

                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.dot}
                  fill={status === 'done' ? node.color : node.depth === 0 ? node.color : '#ffffff'}
                  fillOpacity={status === 'done' || node.depth === 0 ? 0.9 : 1}
                  stroke={STATUS_STROKE[status]}
                  strokeWidth={(node.depth === 0 ? 3 : status === 'todo' ? 1.7 : 2.4) / zoom}
                />

                <title>{node.title || '未命名'}</title>

                {(compact ? node.depth > 0 : true) && (
                <text
                  className="radial-label"
                  data-depth={node.depth}
                  x={lx}
                  y={ly}
                  dy={dy}
                  textAnchor={anchor}
                >
                  {node.title || '未命名'}
                  {dashed && <tspan className="radial-label-more"> +{node.hidden}</tspan>}
                </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>

      <p className="radial-hint">
        点节点切换状态 · 双击折叠 · 滚轮缩放 · 拖拽平移
        <button
          type="button"
          className="radial-reset"
          onClick={() => {
            setZoom(1)
            setPan({ x: 0, y: 0 })
          }}
        >
          复位
        </button>
      </p>
    </div>
  )
}
