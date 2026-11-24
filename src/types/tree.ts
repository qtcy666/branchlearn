/**
 * 树学 数据结构
 *
 * 设计原则：
 * 1. 一棵树 = 一个课程 / 一个学习目标。树的根节点就是这门课本身。
 *    这样"根节点"和其他节点没有特殊类型，折叠、标状态、计数都能用同一套逻辑。
 * 2. 状态只存三个值，不存派生值。父节点的"已掌握"由聚合函数算出来，
 *    但允许手动覆盖（statusManual），因为现实里"这章我看过但没完全会"很常见。
 * 3. 所有节点都带 createdAt / updatedAt，后面做"最近改动"和排序时不用再改结构。
 * 4. 文档带 version 字段，将来加字段时可以写迁移函数，不会让老数据直接报废。
 */

/** 当前数据结构版本。任何字段变更都要 +1，并在 storage 的 migrate 里补一条。 */
export const SCHEMA_VERSION = 1

/**
 * 节点状态。
 * - todo     : 还没开始
 * - learning : 正在学
 * - done     : 已掌握
 *
 * 不用数字是因为数字会诱导去做"进度百分比"这种伪精确的东西。
 */
export type NodeStatus = 'todo' | 'learning' | 'done'

export interface TreeNode {
  /** 稳定唯一 id，用于 React key、拖拽、分享链接。 */
  id: string
  /** 节点标题，例如「矩阵乘法」。 */
  title: string
  /** 备注，可空。预留给「这一节的重点是什么」。 */
  note: string
  /** 自身状态。父节点的展示状态由聚合函数推导，不直接写回这里。 */
  status: NodeStatus
  /**
   * 旧版的「手动覆盖」标记，仅为兼容已存数据保留。
   * 现在父节点的展示状态一律由子节点聚合推导，任何地方都不再读取这个字段。
   */
  statusManual: boolean
  /** 折叠状态要持久化，否则刷新后整棵树全部展开，很吵。 */
  collapsed: boolean
  /** 子节点。叶子节点是空数组，不用 null，避免到处都是可选链。 */
  children: TreeNode[]
  /** AI 生成的节点会带这个标记，手写节点没有该字段。 */
  source?: 'ai'
  createdAt: number
  updatedAt: number
}

/** 层级默认名称，用户可以在界面上逐层改掉。 */
export const DEFAULT_LEVEL_NAMES = ['壹', '贰', '叁', '肆', '伍']

export interface Tree {
  /** 树 id，与 root.id 不同：root 是内容节点，Tree 是容器。 */
  id: string
  /** 树标题，通常等于课程名，但允许用户改得更好听。 */
  title: string
  /** 一句话说明这棵树要达成什么。 */
  description: string
  /** 根节点，即课程本身。 */
  root: TreeNode
  /** 每一层的显示名称，索引即深度。空数组表示全部使用默认名称。 */
  levelNames: string[]
  createdAt: number
  updatedAt: number
}

export interface TreeDocument {
  /** 与 SCHEMA_VERSION 对应，用于迁移判断。 */
  version: number
  trees: Tree[]
  /** 当前打开的树；null 表示还没建过树。 */
  activeTreeId: string | null
  /** 整份文档最后一次写入时间，用于「已保存」提示。 */
  updatedAt: number
}

/** 生成稳定 id。crypto.randomUUID 在非安全上下文可能不存在，留一个降级。 */
export function createId(prefix = 'n'): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}_${uuid}`
}

export function createNode(title: string): TreeNode {
  const now = Date.now()
  return {
    id: createId(),
    title: title.trim(),
    note: '',
    status: 'todo',
    statusManual: false,
    collapsed: false,
    children: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function createTree(title: string, description = ''): Tree {
  const now = Date.now()
  return {
    id: createId('t'),
    title: title.trim(),
    description: description.trim(),
    root: createNode(title),
    levelNames: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function createEmptyDocument(): TreeDocument {
  return {
    version: SCHEMA_VERSION,
    trees: [],
    activeTreeId: null,
    updatedAt: Date.now(),
  }
}

/** 递归统计节点总数（含根节点）。 */
export function countNodes(node: TreeNode): number {
  let total = 1
  for (const child of node.children) total += countNodes(child)
  return total
}

/** 递归统计指定状态的节点数。 */
export function countByStatus(node: TreeNode, status: NodeStatus): number {
  let total = node.status === status ? 1 : 0
  for (const child of node.children) total += countByStatus(child, status)
  return total
}
