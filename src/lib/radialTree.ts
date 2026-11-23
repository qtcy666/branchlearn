import { hierarchy, tree } from 'd3-hierarchy'
import { levelColor } from './colors'
import type { TreeNode } from '../types/tree'

/**
 * 径向树布局（Radial / Sunburst 风格）。
 *
 * 与纵向树的关系：
 * - 纵向树用 `treeLayout.ts` 的手写 tidy 布局，一层一层往下排；
 * - 这里直接交给 `d3.tree()` 算「角度 × 半径」，再转成笛卡尔坐标。
 *   同一棵数据、同一套折叠语义，只是换了投影方式。
 *
 * 为什么用 d3：
 * `separation()` 能按子树深度调节角间距，外层更挤、内层更松，
 * 这正是径向树最容易「糊成一团」的地方，手写数组加法替代不了。
 */

export interface RadialNode {
  id: string
  title: string
  depth: number
  /** 极坐标半径（0 = 圆心）。 */
  r: number
  /** 极坐标角度，弧度；0 = 正上方，顺时针递增。 */
  angle: number
  /** 以树心为原点的笛卡尔坐标。 */
  x: number
  y: number
  /** 本层主色（与 2D 纵向树一致）。 */
  color: string
  /** 节点圆点半径。 */
  dot: number
  /** 该节点是否被折叠。 */
  collapsed: boolean
  /** 折叠时被藏起来的后代数量，用来提示「还有几块没展开」。 */
  hidden: number
  /** 从根到父节点的标题链，hover 时做面包屑用。 */
  path: string[]
  /** 祖先 id 链（不含自身），用于高亮这条枝。 */
  ancestorIds: string[]
  node: TreeNode
}

export interface RadialLink {
  id: string
  fromId: string
  toId: string
  depth: number
  color: string
  path: string
}

export interface RadialLayout {
  nodes: RadialNode[]
  links: RadialLink[]
  /** 最外层半径，组件据此做自适应取景。 */
  radius: number
  maxDepth: number
}

interface HierDatum {
  node: TreeNode
  children?: HierDatum[]
}

/** 折叠的节点不再向下挂 children，d3 就只排它自己。 */
function toHierDatum(node: TreeNode): HierDatum {
  if (node.collapsed || node.children.length === 0) {
    return { node }
  }
  return { node, children: node.children.map(toHierDatum) }
}

/** 折叠时统计被藏起来的后代数量。 */
function countHidden(node: TreeNode): number {
  let total = 0
  for (const child of node.children) {
    total += 1 + countHidden(child)
  }
  return total
}

/** 节点圆点半径：越深越小，但保留最小可点击尺寸。 */
function dotRadius(depth: number): number {
  if (depth === 0) return 5.5
  if (depth === 1) return 6.2
  if (depth === 2) return 5
  return 4.2
}

function polarToXY(r: number, angle: number): { x: number; y: number } {
  return { x: r * Math.cos(angle), y: r * Math.sin(angle) }
}

/**
 * 径向连线：两段径向切线之间用三次贝塞尔过渡。
 * 等价于 d3.linkRadial 的形状，但不额外引 d3-shape。
 */
export function radialLinkPath(
  from: { r: number; angle: number },
  to: { r: number; angle: number },
): string {
  const start = polarToXY(from.r, from.angle)
  const end = polarToXY(to.r, to.angle)
  const midR = (from.r + to.r) / 2
  const c1 = polarToXY(midR, from.angle)
  const c2 = polarToXY(midR, to.angle)

  return `M${start.x.toFixed(2)},${start.y.toFixed(2)} C${c1.x.toFixed(2)},${c1.y.toFixed(2)} ${c2.x.toFixed(2)},${c2.y.toFixed(2)} ${end.x.toFixed(2)},${end.y.toFixed(2)}`
}

export function layoutRadial(root: TreeNode, radius: number): RadialLayout {
  const hier = hierarchy<HierDatum>(toHierDatum(root))
  const maxDepth = hier.height
  const safeRadius = Math.max(80, radius)

  const treeLayout = tree<HierDatum>()
    .size([Math.PI * 2, safeRadius])
    // 同父的兄弟给 1 份角距，跨子树给 1.7 份；再按深度稀释，
    // 让外层节点不会因为数量多而挤成一片。
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.7) / Math.max(1, a.depth))

  treeLayout(hier)

  const nodes: RadialNode[] = []
  const links: RadialLink[] = []

  // d3 的 x 是 [0, 2π] 角度、y 是半径；减 π/2 让第一根枝从正上方开始。
  hier.each((item) => {
    // tree() 布局后 x / y 一定被赋值，类型上仍是可选的，这里收敛一次
    const angle = (item.x ?? 0) - Math.PI / 2
    const r = item.y ?? 0
    const { x, y } = polarToXY(r, angle)
    const node = item.data.node
    const depth = item.depth
    const color = levelColor(depth)
    // ancestors() 是 [自身, 父, ..., 根]，反过来就是根 → 父的链
    const ancestors = item.ancestors().slice(1).reverse()
    const ancestorIds = ancestors.map((a) => a.data.node.id)
    const path = ancestors.map((a) => a.data.node.title)

    nodes.push({
      id: node.id,
      title: node.title,
      depth,
      r,
      angle,
      x,
      y,
      color,
      dot: dotRadius(depth),
      collapsed: node.collapsed && node.children.length > 0,
      hidden: node.collapsed ? countHidden(node) : 0,
      path,
      ancestorIds,
      node,
    })

    if (item.parent) {
      const parentNode = item.parent.data.node
      links.push({
        id: `${parentNode.id}->${node.id}`,
        fromId: parentNode.id,
        toId: node.id,
        depth,
        color,
        path: radialLinkPath(
          { r: item.parent.y ?? 0, angle: (item.parent.x ?? 0) - Math.PI / 2 },
          { r, angle },
        ),
      })
    }
  })

  return { nodes, links, radius: safeRadius, maxDepth }
}
