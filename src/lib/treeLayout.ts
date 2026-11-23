import { isSolidTier, levelColor, tint } from './colors'
import type { TreeNode } from '../types/tree'

/**
 * 纵向树布局（上 → 下），紧凑版。
 *
 * 与旧版的区别：
 * 1. 节点宽高按真实文本测量，不再全树统一；
 * 2. 每个子树只占自己真实需要的宽度（max(自身宽, 子节点总宽)），
 *    父节点居中于这个区间，因此短分支不会再撑出固定网格的空白；
 * 3. 层高按该层最高的节点自适应，不再固定 nodeHeight + gapY；
 * 4. 长文本折成两行，超出截断加省略号，完整内容留在 title 里。
 *
 * 坐标约定：
 * - x 是节点左边缘，y 是节点上边缘（相对内容区原点，不含 PADDING）；
 * - 同层节点垂直居中于该层高度；
 * - 折叠节点按叶子处理，子树不占空间。
 */

/** 画布内边距（固定）。 */
export const PADDING = 26

/* ---------------------------------------------------------
   文本测量：必须与 canvas.css 里 .canvas-title 的字号一致
   --------------------------------------------------------- */
const FONT_SIZE = 13
const LINE_HEIGHT = 1.3
const FONT_WEIGHT = 600
const FONT_FAMILY = '"PingFang SC", "Noto Sans SC", system-ui, -apple-system, sans-serif'
const FONT = `${FONT_WEIGHT} ${FONT_SIZE}px ${FONT_FAMILY}`

const PAD_X = 14
const PAD_Y = 10
const MAX_TEXT_WIDTH = 148
const MIN_NODE_WIDTH = 86
const MAX_NODE_WIDTH = MAX_TEXT_WIDTH + PAD_X * 2 + 4
const MAX_LINES = 2
const MIN_NODE_HEIGHT = 46
const LINE_H = FONT_SIZE * LINE_HEIGHT

/** 兄弟间距与层间间距的最小安全值。 */
export const GAP_X = 4
export const GAP_Y = 26

/** 三套独立间距 + 章卡片间距，可用 CSS 变量覆盖。 */
export interface TreeGaps {
  /** 同父兄弟节点之间（双方都没有子节点） */
  sibling: number
  /** 相邻不同子树之间 */
  cousin: number
  /** 层与层之间（兜底） */
  level: number
  /** 根 → 章 */
  levelRoot: number
  /** 章 → 叶 */
  levelChapter: number
  /** 章卡片之间 */
  card: number
}

export const GAP_SIBLING = 4
export const GAP_COUSIN = 12
export const GAP_LEVEL = 380
export const GAP_LEVEL_ROOT = 400
export const GAP_LEVEL_CHAPTER = 380
export const GAP_CARD = 24

export const DEFAULT_GAPS: TreeGaps = {
  sibling: GAP_SIBLING,
  cousin: GAP_COUSIN,
  level: GAP_LEVEL,
  levelRoot: GAP_LEVEL_ROOT,
  levelChapter: GAP_LEVEL_CHAPTER,
  card: GAP_CARD,
}

export interface TreeSize {
  nodeWidth: number
  nodeHeight: number
  gapX: number
  gapY: number
}

/** 兜底尺寸（外部若仍按旧签名调用可继续工作）。 */
export const DEFAULT_SIZE: TreeSize = {
  nodeWidth: 120,
  nodeHeight: 56,
  gapX: GAP_X,
  gapY: GAP_Y,
}

/** 旧接口保留：现在布局不再依赖整体缩放，返回的只是参考尺寸。 */
export function sizeForDepth(maxDepth: number): TreeSize {
  if (maxDepth <= 0) return { nodeWidth: 150, nodeHeight: 68, gapX: GAP_X, gapY: GAP_Y }
  if (maxDepth === 1) return { nodeWidth: 136, nodeHeight: 62, gapX: GAP_X, gapY: GAP_Y }
  return { ...DEFAULT_SIZE }
}

/** 树的层数（最大深度），根节点为 0。 */
export function treeDepth(node: TreeNode): number {
  if (node.children.length === 0) return 0
  let max = 0
  for (const child of node.children) {
    max = Math.max(max, treeDepth(child))
  }
  return max + 1
}

/* ---------------------------------------------------------
   Canvas 文本测量（Node 环境自动回退到字宽估算）
   --------------------------------------------------------- */
let measureCtx: CanvasRenderingContext2D | null | undefined
const widthCache = new Map<string, number>()

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx
  if (typeof document === 'undefined') {
    measureCtx = null
    return measureCtx
  }
  measureCtx = document.createElement('canvas').getContext('2d')
  return measureCtx
}

export function resetMeasurementCache(): void {
  widthCache.clear()
}

function textWidth(text: string): number {
  const hit = widthCache.get(text)
  if (hit !== undefined) return hit

  const ctx = getMeasureCtx()
  let width: number
  if (ctx) {
    ctx.font = FONT
    width = ctx.measureText(text).width
  } else {
    width = 0
    for (const ch of text) {
      width += ch.charCodeAt(0) > 0x2e80 ? FONT_SIZE : FONT_SIZE * 0.55
    }
  }

  widthCache.set(text, width)
  return width
}

/** 贪心折行，最多两行，超出补省略号。 */
function wrapText(source: string): string[] {
  const text = source.trim()
  if (!text) return ['未命名']

  const lines: string[] = []
  let current = ''

  for (const ch of Array.from(text)) {
    const next = current + ch
    if (current === '' || textWidth(next) <= MAX_TEXT_WIDTH) {
      current = next
    } else {
      lines.push(current)
      current = ch
    }
  }
  if (current) lines.push(current)

  if (lines.length <= MAX_LINES) return lines

  const kept = lines.slice(0, MAX_LINES)
  const last = Array.from(kept[MAX_LINES - 1])
  while (last.length > 1 && textWidth(last.join('') + '…') > MAX_TEXT_WIDTH) {
    last.pop()
  }
  kept[MAX_LINES - 1] = last.join('') + '…'
  return kept
}

export interface NodeBox {
  width: number
  height: number
  lines: string[]
}

export function measureNodeBox(node: TreeNode): NodeBox {
  const lines = wrapText(node.title)
  const widest = lines.reduce((max, line) => Math.max(max, textWidth(line)), 0)

  // +4 是抗锯齿余量：measureText 常比实际渲染略窄，不给余量会被挤成两行
  const width = Math.round(
    Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, widest + PAD_X * 2 + 4)),
  )
  const height = Math.round(Math.max(MIN_NODE_HEIGHT, lines.length * LINE_H + PAD_Y * 2))

  return { width, height, lines }
}

/* ---------------------------------------------------------
   布局
   --------------------------------------------------------- */
export interface LayoutNode {
  node: TreeNode
  depth: number
  x: number
  y: number
  width: number
  height: number
  lines: string[]
  color: string
  soft: string
  softBorder: string
  ink: string
  /** 章节点左侧的 01-05 序号。 */
  badge?: string
}

export interface LayoutEdge {
  from: LayoutNode
  to: LayoutNode
  color: string
}

export interface TreeLayout {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  width: number
  height: number
  maxDepth: number
  /** 每层顶部 y 与层高，供左侧层名对齐。 */
  levelTops: number[]
  levelHeights: number[]
  /** 节点尺寸参考值（CSS 变量兜底）。 */
  baseWidth: number
  baseHeight: number
  gapY: number
  /** tree = 经典纵向树；其余为不同呈现版式。 */
  mode: 'tree' | 'grouped' | 'horizontal' | 'vertical' | 'visual'
  /** 不走 edgePath 的正交装饰线（根总线、章内网格臂）。 */
  decorations?: Decoration[]
}

export interface Decoration {
  id: string
  d: string
  kind: 'root' | 'leaf' | 'bus'
  chapterId?: string
}

export type NodeMeasurer = (node: TreeNode, depth: number) => NodeBox

export function layoutTree(
  root: TreeNode,
  measureBox: NodeMeasurer = measureNodeBox,
  gaps: TreeGaps = DEFAULT_GAPS,
): TreeLayout {
  const boxCache = new Map<string, NodeBox>()
  const spanCache = new Map<string, number>()

  const hasKids = (node: TreeNode) => !node.collapsed && node.children.length > 0

  /** 子节点深度决定用哪一档间距：章用卡片间距，叶子之间用兄弟间距，其余用跨子树间距。 */
  const gapBetween = (a: TreeNode, b: TreeNode, childDepth: number): number => {
    if (childDepth === 1) return gaps.card
    if (!hasKids(a) && !hasKids(b)) return gaps.sibling
    return gaps.cousin
  }

  const measure = (node: TreeNode, depth: number): NodeBox => {
    const hit = boxCache.get(node.id)
    if (hit) return hit
    const box = measureBox(node, depth)
    boxCache.set(node.id, box)
    return box
  }

  /** 子树占位宽度：自身宽与子节点总宽取大者。 */
  const subtreeSpan = (node: TreeNode, depth: number): number => {
    const hit = spanCache.get(node.id)
    if (hit !== undefined) return hit

    const box = measure(node, depth)
    const visible = node.collapsed ? [] : node.children

    let span = box.width
    if (visible.length > 0) {
      let total = 0
      visible.forEach((child, index) => {
        if (index > 0) total += gapBetween(visible[index - 1], child, depth + 1)
        total += subtreeSpan(child, depth + 1)
      })
      span = Math.max(box.width, total)
    }

    spanCache.set(node.id, span)
    return span
  }

  const nodes: LayoutNode[] = []
  const edges: LayoutEdge[] = []
  const levelHeights: number[] = []

  const place = (node: TreeNode, depth: number, left: number): LayoutNode => {
    const box = measure(node, depth)
    const span = subtreeSpan(node, depth)
    const centerX = left + span / 2

    const color = levelColor(depth)
    const layoutNode: LayoutNode = {
      node,
      depth,
      x: centerX - box.width / 2,
      y: 0,
      width: box.width,
      height: box.height,
      lines: box.lines,
      color,
      soft: tint(color, 0.2),
      softBorder: tint(color, 0.15),
      ink: isSolidTier(depth) ? '#ffffff' : '#2b4a3a',
    }

    nodes.push(layoutNode)
    levelHeights[depth] = Math.max(levelHeights[depth] ?? 0, box.height)

    const visible = node.collapsed ? [] : node.children
    if (visible.length > 0) {
      const spans = visible.map((child) => subtreeSpan(child, depth + 1))
      const total =
        spans.reduce((sum, value) => sum + value, 0) +
        visible.reduce(
          (sum, child, index) => (index > 0 ? sum + gapBetween(visible[index - 1], child, depth + 1) : sum),
          0,
        )
      let cursor = left + (span - total) / 2

      visible.forEach((child, index) => {
        const childNode = place(child, depth + 1, cursor)
        edges.push({ from: layoutNode, to: childNode, color: childNode.color })
        cursor += spans[index] + (index < visible.length - 1 ? gapBetween(child, visible[index + 1], depth + 1) : 0)
      })
    }

    return layoutNode
  }

  place(root, 0, 0)

  const maxDepth = Math.max(0, levelHeights.length - 1)

  const levelTops: number[] = []
  let cursorY = 0
  for (let depth = 0; depth <= maxDepth; depth++) {
    levelTops[depth] = cursorY
    cursorY += (levelHeights[depth] ?? 0) + (depth === 0 ? gaps.levelRoot : gaps.levelChapter)
  }
  const height = levelTops[maxDepth] + (levelHeights[maxDepth] ?? 0)

  for (const item of nodes) {
    const laneHeight = levelHeights[item.depth] ?? item.height
    item.y = levelTops[item.depth] + (laneHeight - item.height) / 2
  }

  const width = subtreeSpan(root, 0)

  const baseWidth = nodes.length
    ? Math.round(nodes.reduce((sum, item) => sum + item.width, 0) / nodes.length)
    : DEFAULT_SIZE.nodeWidth
  const baseHeight = nodes.length
    ? Math.round(nodes.reduce((sum, item) => sum + item.height, 0) / nodes.length)
    : DEFAULT_SIZE.nodeHeight

  return {
    nodes,
    edges,
    width,
    height,
    maxDepth,
    levelTops,
    levelHeights,
    baseWidth,
    baseHeight,
    gapY: gaps.levelRoot,
    mode: 'tree',
  }
}

/* ---------------------------------------------------------
   分组布局：章为一列（宽屏）或一行（窄屏），知识点挂在章内
   ---------------------------------------------------------
   23 个叶子平铺会让树变成 3000px 宽的横条，缩放到能看全时字只剩 5px。
   这里把层级压成两维：横向放章，纵向放章内知识点，
   树的外形接近画布比例，才能放大到铺满。
*/

export function layoutGrouped(root: TreeNode, narrow: boolean): TreeLayout {
  const boxCache = new Map<string, NodeBox>()
  const measure = (node: TreeNode): NodeBox => {
    const hit = boxCache.get(node.id)
    if (hit) return hit
    const box = measureNodeBox(node)
    boxCache.set(node.id, box)
    return box
  }

  const CHAPTER_GAP = narrow ? 22 : 34
  const LEAF_GAP_X = 20
  const LEAF_GAP_Y = 8
  const INDENT = 36
  const CHAPTER_TO_LEAF = 26

  const nodes: LayoutNode[] = []
  const edges: LayoutEdge[] = []

  const push = (node: TreeNode, depth: number, x: number, y: number): LayoutNode => {
    const box = measure(node)
    const color = levelColor(depth)
    const item: LayoutNode = {
      node,
      depth,
      x,
      y,
      width: box.width,
      height: box.height,
      lines: box.lines,
      color,
      soft: tint(color, 0.2),
      softBorder: tint(color, 0.15),
      ink: isSolidTier(depth) ? '#ffffff' : '#2b4a3a',
    }
    nodes.push(item)
    return item
  }

  const rootBox = measure(root)
  const rootItem = push(root, 0, 0, 0)

  const chapters = root.collapsed ? [] : root.children
  const rows = chapters.map((chapter) => {
    const chapterBox = measure(chapter)
    const leaves = chapter.collapsed ? [] : chapter.children
    const leafBoxes = leaves.map(measure)

    let width: number
    let height: number
    if (narrow) {
      const widestLeaf = leafBoxes.reduce((max, box) => Math.max(max, box.width), 0)
      width = Math.max(chapterBox.width, leaves.length ? INDENT + widestLeaf : 0)
      height =
        chapterBox.height +
        (leaves.length
          ? LEAF_GAP_Y +
            leafBoxes.reduce((sum, box) => sum + box.height, 0) +
            (leaves.length - 1) * LEAF_GAP_Y
          : 0)
    } else {
      const leavesWidth =
        leafBoxes.reduce((sum, box) => sum + box.width, 0) +
        Math.max(0, leaves.length - 1) * LEAF_GAP_X
      width = chapterBox.width + (leaves.length ? CHAPTER_TO_LEAF + leavesWidth : 0)
      height = leafBoxes.reduce((max, box) => Math.max(max, box.height), chapterBox.height)
    }
    return { chapter, leaves, chapterBox, leafBoxes, width, height }
  })

  const width = rows.reduce((max, row) => Math.max(max, row.width), rootBox.width)
  rootItem.x = Math.max(0, (width - rootBox.width) / 2)

  let cursorY = rootBox.height + CHAPTER_GAP
  for (const row of rows) {
    const chapterItem = push(row.chapter, 1, 0, cursorY)
    edges.push({ from: rootItem, to: chapterItem, color: chapterItem.color })

    if (narrow) {
      let leafY = cursorY + row.chapterBox.height + LEAF_GAP_Y
      row.leaves.forEach((leaf, index) => {
        const leafItem = push(leaf, 2, INDENT, leafY)
        edges.push({ from: chapterItem, to: leafItem, color: leafItem.color })
        leafY += row.leafBoxes[index].height + LEAF_GAP_Y
      })
    } else {
      let leafX = row.chapterBox.width + CHAPTER_TO_LEAF
      row.leaves.forEach((leaf, index) => {
        const leafBox = row.leafBoxes[index]
        const leafItem = push(leaf, 2, leafX, cursorY + (row.height - leafBox.height) / 2)
        edges.push({ from: chapterItem, to: leafItem, color: leafItem.color })
        leafX += leafBox.width + LEAF_GAP_X
      })
    }
    cursorY += row.height + CHAPTER_GAP
  }

  const height = Math.max(rootBox.height, cursorY - CHAPTER_GAP)
  const maxDepth = nodes.reduce((max, item) => Math.max(max, item.depth), 0)

  const baseWidth = nodes.length
    ? Math.round(nodes.reduce((sum, item) => sum + item.width, 0) / nodes.length)
    : DEFAULT_SIZE.nodeWidth
  const baseHeight = nodes.length
    ? Math.round(nodes.reduce((sum, item) => sum + item.height, 0) / nodes.length)
    : DEFAULT_SIZE.nodeHeight

  const chapterBlockHeight = Math.max(0, height - rootBox.height - CHAPTER_GAP)

  return {
    nodes,
    edges,
    width,
    height,
    maxDepth,
    levelTops: [0, rootBox.height + CHAPTER_GAP, rootBox.height + CHAPTER_GAP],
    levelHeights: [rootBox.height, chapterBlockHeight, chapterBlockHeight],
    baseWidth,
    baseHeight,
    gapY: CHAPTER_GAP,
    mode: 'grouped',
  }
}

/** 从父节点底部中心到子节点顶部中心的垂直贝塞尔曲线。 */
export function edgePath(from: LayoutNode, to: LayoutNode): string {
  const x1 = from.x + from.width / 2
  const y1 = from.y + from.height
  const x2 = to.x + to.width / 2
  const y2 = to.y
  const midY = y1 + (y2 - y1) / 2

  // 上沿 → 下沿的二次曲线；控制点落在中线上，视觉上接近柔性主干
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
}

export function edgePathOrtho(from: LayoutNode, to: LayoutNode): string {
  const x1 = from.x + from.width / 2
  const y1 = from.y + from.height
  const x2 = to.x + to.width / 2
  const y2 = to.y
  const stem = Math.min(56, Math.max(20, (y2 - y1) / 4))
  const midY = y1 + stem
  return `M ${x1} ${y1} V ${midY} H ${x2} V ${y2}`
}

/* ---------------------------------------------------------
   横向 tidy tree（规范 v1）：根在左，层级向右展开，
   子节点纵向堆叠、父节点居中于子树高度
   --------------------------------------------------------- */
const H_GAP_SIBLING = 24
const H_GAP_COUSIN = 48
const H_GAP_LEVEL = 96

export function layoutHorizontal(root: TreeNode): TreeLayout {
  const nodes: LayoutNode[] = []
  const edges: LayoutEdge[] = []
  const boxById = new Map<string, NodeBox>()
  const depthById = new Map<string, number>()
  const heightByDepth = new Map<number, number>()

  const collect = (node: TreeNode, depth: number) => {
    const box = measureNodeBox(node)
    boxById.set(node.id, box)
    depthById.set(node.id, depth)
    heightByDepth.set(depth, Math.max(heightByDepth.get(depth) ?? 0, box.height))
    if (!node.collapsed) node.children.forEach((child) => collect(child, depth + 1))
  }
  collect(root, 0)

  // 同一 depth 层统一高度，避免参差
  const heightOf = (node: TreeNode) =>
    heightByDepth.get(depthById.get(node.id) ?? 0) ?? MIN_NODE_HEIGHT

  const spanById = new Map<string, number>()
  const computeSpan = (node: TreeNode): number => {
    const own = heightOf(node)
    if (node.collapsed || node.children.length === 0) {
      spanById.set(node.id, own)
      return own
    }
    const gap = depthById.get(node.id) === 0 ? H_GAP_COUSIN : H_GAP_SIBLING
    let total = 0
    node.children.forEach((child, index) => {
      total += computeSpan(child)
      if (index > 0) total += gap
    })
    const span = Math.max(own, total)
    spanById.set(node.id, span)
    return span
  }
  computeSpan(root)

  let maxRight = 0
  const place = (node: TreeNode, x: number, top: number): LayoutNode => {
    const box = boxById.get(node.id)!
    const depth = depthById.get(node.id)!
    const height = heightOf(node)
    const span = spanById.get(node.id)!
    const y = top + (span - height) / 2
    const color = levelColor(depth)
    const item: LayoutNode = {
      node,
      depth,
      x,
      y,
      width: box.width,
      height,
      lines: box.lines,
      color,
      soft: tint(color, 0.2),
      softBorder: tint(color, 0.15),
      ink: isSolidTier(depth) ? '#ffffff' : '#2b4a3a',
    }
    nodes.push(item)
    maxRight = Math.max(maxRight, x + box.width)

    if (!node.collapsed && node.children.length > 0) {
      const gap = depth === 0 ? H_GAP_COUSIN : H_GAP_SIBLING
      let cursor = top
      for (const child of node.children) {
        const childItem = place(child, x + box.width + H_GAP_LEVEL, cursor)
        edges.push({ from: item, to: childItem, color: childItem.color })
        cursor += spanById.get(child.id)! + gap
      }
    }
    return item
  }
  place(root, 0, 0)

  const baseWidth = nodes.length
    ? Math.round(nodes.reduce((sum, item) => sum + item.width, 0) / nodes.length)
    : 160
  const baseHeight = nodes.length
    ? Math.round(nodes.reduce((sum, item) => sum + item.height, 0) / nodes.length)
    : 40

  return {
    nodes,
    edges,
    width: maxRight,
    height: spanById.get(root.id) ?? heightOf(root),
    maxDepth: nodes.reduce((max, item) => Math.max(max, item.depth), 0),
    levelTops: [],
    levelHeights: [],
    baseWidth,
    baseHeight,
    gapY: H_GAP_LEVEL,
    mode: 'horizontal',
  }
}

/* 窄视口（<900px）纵向版：根在上，子节点横向堆叠，父节点居中于子树宽度 */
const H_GAP_LEVEL_NARROW = 72

export function layoutVertical(root: TreeNode): TreeLayout {
  const nodes: LayoutNode[] = []
  const edges: LayoutEdge[] = []
  const boxById = new Map<string, NodeBox>()
  const depthById = new Map<string, number>()
  const heightByDepth = new Map<number, number>()

  const collect = (node: TreeNode, depth: number) => {
    const box = measureNodeBox(node)
    boxById.set(node.id, box)
    depthById.set(node.id, depth)
    heightByDepth.set(depth, Math.max(heightByDepth.get(depth) ?? 0, box.height))
    if (!node.collapsed) node.children.forEach((child) => collect(child, depth + 1))
  }
  collect(root, 0)

  const heightOf = (node: TreeNode) =>
    heightByDepth.get(depthById.get(node.id) ?? 0) ?? MIN_NODE_HEIGHT

  const spanById = new Map<string, number>()
  const computeSpan = (node: TreeNode): number => {
    const own = boxById.get(node.id)!.width
    if (node.collapsed || node.children.length === 0) {
      spanById.set(node.id, own)
      return own
    }
    const gap = depthById.get(node.id) === 0 ? H_GAP_COUSIN : H_GAP_SIBLING
    let total = 0
    node.children.forEach((child, index) => {
      total += computeSpan(child)
      if (index > 0) total += gap
    })
    const span = Math.max(own, total)
    spanById.set(node.id, span)
    return span
  }
  computeSpan(root)

  const yByDepth: number[] = [0]
  const deepest = Math.max(...[...depthById.values()])
  for (let d = 1; d <= deepest; d += 1) {
    yByDepth[d] = yByDepth[d - 1] + (heightByDepth.get(d - 1) ?? MIN_NODE_HEIGHT) + H_GAP_LEVEL_NARROW
  }

  const place = (node: TreeNode, left: number): LayoutNode => {
    const box = boxById.get(node.id)!
    const depth = depthById.get(node.id)!
    const span = spanById.get(node.id)!
    const x = left + (span - box.width) / 2
    const y = yByDepth[depth]
    const color = levelColor(depth)
    const item: LayoutNode = {
      node,
      depth,
      x,
      y,
      width: box.width,
      height: heightOf(node),
      lines: box.lines,
      color,
      soft: tint(color, 0.2),
      softBorder: tint(color, 0.15),
      ink: isSolidTier(depth) ? '#ffffff' : '#2b4a3a',
    }
    nodes.push(item)

    if (!node.collapsed && node.children.length > 0) {
      const gap = depth === 0 ? H_GAP_COUSIN : H_GAP_SIBLING
      let cursor = left
      for (const child of node.children) {
        const childItem = place(child, cursor)
        edges.push({ from: item, to: childItem, color: childItem.color })
        cursor += spanById.get(child.id)! + gap
      }
    }
    return item
  }
  place(root, 0)

  return {
    nodes,
    edges,
    width: spanById.get(root.id) ?? 320,
    height: (yByDepth[deepest] ?? 0) + (heightByDepth.get(deepest) ?? MIN_NODE_HEIGHT),
    maxDepth: deepest,
    levelTops: [],
    levelHeights: [],
    baseWidth: 160,
    baseHeight: 40,
    gapY: H_GAP_LEVEL_NARROW,
    mode: 'vertical',
  }
}

/* ---------------------------------------------------------
   视觉版布局：保持「根居中 / 章横排 / 叶挂章下」的骨架，
   叶排 2 列网格，章块宽度互不相等（间距 = 章块宽 + 48）
   --------------------------------------------------------- */

const VIS = {
  rootH: 56,
  chapterH: 64,
  leafH: 28,
  leafMaxW: 140,
  gutter: 8,
  rowGap: 10,
  chapterToLeaf: 30,
  chapterGap: 48,
  rootToChapter: 24,
  badge: 26,
  padX: 12,
  rootFont: '700 24px "PingFang SC", "Hiragino Sans GB", sans-serif',
  chapterFont: '600 16px "PingFang SC", "Hiragino Sans GB", sans-serif',
  leafFont: '400 15px "PingFang SC", "Hiragino Sans GB", sans-serif',
}

let visCtx: CanvasRenderingContext2D | null = null
function measureVisText(text: string, font: string): number {
  if (typeof document === 'undefined') return text.length * 14
  if (!visCtx) visCtx = document.createElement('canvas').getContext('2d')
  if (!visCtx) return text.length * 14
  visCtx.font = font
  return visCtx.measureText(text).width
}

const singleLine = (text: string) => text.replace(/\s+/g, ' ').trim()

export function layoutVisual(root: TreeNode): TreeLayout {
  const nodes: LayoutNode[] = []
  const edges: LayoutEdge[] = []
  const decorations: Decoration[] = []

  const rootTitle = singleLine(root.title || '未命名')
  const rootW = Math.max(96, Math.round(measureVisText(rootTitle, VIS.rootFont) + 40))

  const chapters = root.collapsed ? [] : root.children
  const blocks = chapters.map((chapter, index) => {
    const chapterTitle = singleLine(chapter.title || '未命名')
    const chapterW = Math.round(measureVisText(chapterTitle, VIS.chapterFont) + VIS.badge + VIS.padX * 2 + 10)
    const leaves = chapter.collapsed ? [] : chapter.children
    const leafTitles = leaves.map((leaf) => singleLine(leaf.title || '未命名'))
    const widestLeaf = leafTitles.reduce(
      (max, title) => Math.max(max, measureVisText(title, VIS.leafFont)),
      0,
    )
    const leafW = Math.min(VIS.leafMaxW, Math.max(88, Math.round(widestLeaf + 28)))
    // 每章的叶最多折成 2 行，列数随叶数走（不是固定 2 列）
    const cols = leaves.length ? Math.ceil(leaves.length / 2) : 0
    const rows = cols ? Math.ceil(leaves.length / cols) : 0
    const gridW = cols ? leafW * cols + VIS.gutter * (cols - 1) : 0
    const blockW = Math.max(chapterW, gridW)
    const blockH =
      VIS.chapterH +
      (leaves.length ? VIS.chapterToLeaf + rows * VIS.leafH + (rows - 1) * VIS.rowGap : 0)
    return {
      chapter,
      index,
      chapterTitle,
      chapterW,
      leaves,
      leafTitles,
      leafW,
      cols,
      rows,
      gridW,
      blockW,
      blockH,
    }
  })

  const totalW =
    blocks.reduce((sum, block) => sum + block.blockW, 0) +
    Math.max(0, blocks.length - 1) * VIS.chapterGap

  // 根居中
  const rootItem: LayoutNode = {
    node: root,
    depth: 0,
    x: Math.max(0, (totalW - rootW) / 2),
    y: 0,
    width: rootW,
    height: VIS.rootH,
    lines: [rootTitle],
    color: levelColor(0),
    soft: tint(levelColor(0), 0.2),
    softBorder: tint(levelColor(0), 0.15),
    ink: '#ffffff',
  }
  nodes.push(rootItem)

  const chapterTop = VIS.rootH + VIS.rootToChapter
  const chapterCenters: number[] = []
  let cursorX = 0

  for (const block of blocks) {
    const chapterX = cursorX + (block.blockW - block.chapterW) / 2
    const color = levelColor(1)
    const chapterItem: LayoutNode = {
      node: block.chapter,
      depth: 1,
      x: chapterX,
      y: chapterTop,
      width: block.chapterW,
      height: VIS.chapterH,
      lines: [block.chapterTitle],
      color,
      soft: tint(color, 0.2),
      softBorder: tint(color, 0.15),
      ink: color,
      badge: String(block.index + 1).padStart(2, '0'),
    }
    nodes.push(chapterItem)
    chapterCenters.push(chapterX + block.chapterW / 2)

    const gridX = cursorX + (block.blockW - block.gridW) / 2
    const leafTop = chapterTop + VIS.chapterH + VIS.chapterToLeaf

    block.leaves.forEach((leaf, leafIndex) => {
      const col = leafIndex % block.cols
      const row = Math.floor(leafIndex / block.cols)
      const leafColor = levelColor(2)
      const leafItem: LayoutNode = {
        node: leaf,
        depth: 2,
        x: gridX + col * (block.leafW + VIS.gutter),
        y: leafTop + row * (VIS.leafH + VIS.rowGap),
        width: block.leafW,
        height: VIS.leafH,
        lines: [block.leafTitles[leafIndex]],
        color: leafColor,
        soft: tint(leafColor, 0.2),
        softBorder: tint(leafColor, 0.15),
        ink: '#3A443C',
      }
      nodes.push(leafItem)
    })

    edges.push({ from: rootItem, to: chapterItem, color })

    // 章 → 叶：章底向下出总线，每列一条竖干线，每行一条短臂（圆角直角）
    if (block.leaves.length) {
      const cx = chapterItem.x + chapterItem.width / 2
      const chapterBottom = chapterTop + VIS.chapterH
      const busY = chapterBottom + 10
      const lastRowCenter =
        leafTop + (block.rows - 1) * (VIS.leafH + VIS.rowGap) + VIS.leafH / 2
      let d = `M ${cx} ${chapterBottom} V ${busY}`

      for (let col = 0; col < block.cols; col += 1) {
        const colHasLeaf = block.leaves.some((_, i) => i % block.cols === col)
        if (!colHasLeaf) continue
        const colLeft = gridX + col * (block.leafW + VIS.gutter)
        const busX = colLeft - 7
        d += ` M ${cx} ${busY} H ${busX}`
        d += ` M ${busX} ${busY} V ${lastRowCenter}`
        block.leaves.forEach((_, leafIndex) => {
          if (leafIndex % block.cols !== col) return
          const row = Math.floor(leafIndex / block.cols)
          const rowY = leafTop + row * (VIS.leafH + VIS.rowGap) + VIS.leafH / 2
          d += ` M ${busX} ${rowY} H ${colLeft}`
        })
      }

      decorations.push({
        id: `leaf-${block.chapter.id}`,
        d,
        kind: 'leaf',
        chapterId: block.chapter.id,
      })
    }

    cursorX += block.blockW + VIS.chapterGap
  }

  const maxBlockH = blocks.reduce((max, block) => Math.max(max, block.blockH), 0)
  const height = chapterTop + maxBlockH

  return {
    nodes,
    edges,
    decorations,
    width: Math.max(totalW, rootW),
    height,
    maxDepth: 2,
    levelTops: [0, chapterTop, chapterTop + VIS.chapterH + VIS.chapterToLeaf],
    levelHeights: [VIS.rootH, VIS.chapterH, 2 * VIS.leafH + VIS.rowGap],
    baseWidth: 140,
    baseHeight: 40,
    gapY: VIS.chapterGap,
    mode: 'visual',
  }
}


/* ---------------------------------------------------------
   视觉版纵向树：完全沿用 layoutTree 的骨架（根在上、同层同排），
   只调间距与格子尺寸。叶格 120 宽、单行 36 / 双行 52，标题换行不截断。
   --------------------------------------------------------- */

const LEAF_MAX_W = 72
const CHAPTER_W = 136
const LEAF_PAD_X = 10
const LEAF_LINE_H = 48
const LEAF_LINE_H_2 = 72
const LEAF_LINE_H_3 = 88

/** 按字符宽度折行，最多两行；中文逐字断，英文按空格优先。 */
function wrapVisText(text: string, font: string, maxWidth: number, maxLines = 2): string[] {
  const lines: string[] = []
  let current = ''
  for (const ch of text) {
    const next = current + ch
    if (current && measureVisText(next, font) > maxWidth) {
      lines.push(current)
      current = ch
      if (lines.length === maxLines) break
    } else {
      current = next
    }
  }
  if (current && lines.length < maxLines) lines.push(current)
  return lines.length ? lines : [text]
}

export function layoutTreeVisual(root: TreeNode, gaps: TreeGaps = DEFAULT_GAPS): TreeLayout {
  const base = layoutTree(
    root,
    (node, depth) => {
      const title = singleLine(node.title || '未命名')
      if (depth === 0) {
        const width = Math.round(measureVisText(title, VIS.rootFont) + 38)
        return { width: Math.min(220, Math.max(104, width)), height: VIS.rootH, lines: [title] }
      }
      if (depth === 1) {
        // 章格固定 152 宽，标题格内换行（左侧留 4px 竖条 + 徽标位）
        const lines = wrapVisText(title, VIS.chapterFont, CHAPTER_W - 12 - 16 - 6)
        return { width: CHAPTER_W, height: VIS.chapterH, lines }
      }
      // 叶格窄化到 68 宽，内容折行，最多三行
      const lines = wrapVisText(title, VIS.leafFont, LEAF_MAX_W - LEAF_PAD_X * 2 - 2, 3)
      return {
        width: LEAF_MAX_W,
        height:
          lines.length >= 3 ? LEAF_LINE_H_3 : lines.length === 2 ? LEAF_LINE_H_2 : LEAF_LINE_H,
        lines,
      }
    },
    gaps,
  )

  return base
}
