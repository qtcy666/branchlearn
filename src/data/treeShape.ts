import { createNode, createTree, type Tree, type TreeNode } from '../types/tree'

/** 模板里的一层：角色、给 AI 的说明、数量区间、标题字数上限。 */
export interface ShapeLevel {
  role: string
  label: string
  count: [number, number]
  maxChars: number
}

/** 一套树的形状。levels[0] 是根，数组长度就是层数。 */
export interface TreeShape {
  id: string
  name: string
  description: string
  levels: ShapeLevel[]
}

/** AI 返回的填充结果，结构与 ShapeLevel 对齐。 */
export interface FilledNode {
  title: string
  note?: string
  children?: FilledNode[]
}

export interface FillResult {
  root: string
  description?: string
  children: FilledNode[]
  sources?: { title: string; url: string }[]
}

/**
 * V1 只内置这一套三层模板。
 * 以后加模板只需往 SHAPES 追加，校验和组装逻辑不变。
 */
export const COURSE_SHAPE: TreeShape = {
  id: 'course-3',
  name: '课程三阶',
  description: '课程 → 章节 → 知识点',
  levels: [
    { role: 'root', label: '课程名', count: [1, 1], maxChars: 12 },
    { role: 'chapter', label: '章节', count: [4, 8], maxChars: 12 },
    { role: 'point', label: '知识点', count: [3, 7], maxChars: 16 },
  ],
}

export const SHAPES: TreeShape[] = [COURSE_SHAPE]

export function getShape(id: string): TreeShape | null {
  return SHAPES.find((shape) => shape.id === id) ?? null
}

const MAX_NOTE = 2000
const MIN_TOTAL = 20
const MAX_TOTAL = 120

/**
 * 递归校验一层子节点，把问题写进 errors，返回这一支的节点数。
 * 注意：数量检查针对“同一个父节点下”的子节点，不是全层汇总。
 */
function validateLevel(
  items: FilledNode[],
  levelIndex: number,
  shape: TreeShape,
  errors: string[],
): number {
  const level = shape.levels[levelIndex]
  if (!level) {
    errors.push(`第 ${levelIndex + 1} 层超出了模板的层数`)
    return items.length
  }

  const [min, max] = level.count
  if (items.length < min || items.length > max) {
    errors.push(`${level.label}有 ${items.length} 个，应在 ${min}–${max} 个之间`)
  }

  let total = 0
  for (const item of items) {
    total += 1
    const title = (item.title ?? '').trim()
    if (!title) {
      errors.push(`${level.label}里有空标题`)
    } else if (title.length > level.maxChars) {
      errors.push(`「${title}」超过 ${level.maxChars} 字`)
    }

    const children = item.children ?? []
    const isLeafLevel = levelIndex === shape.levels.length - 1
    if (isLeafLevel) {
      if (children.length > 0) {
        errors.push(`「${title}」已经是最底层，不应再有子节点`)
      }
    } else if (children.length === 0) {
      errors.push(`「${title}」缺少${shape.levels[levelIndex + 1].label}`)
    } else {
      total += validateLevel(children, levelIndex + 1, shape, errors)
    }
  }

  return total
}

/** 校验 AI 返回的填充结果；返回空数组表示通过。 */
export function validateFill(result: FillResult, shape: TreeShape): string[] {
  const errors: string[] = []
  const root = (result.root ?? '').trim()
  const rootLevel = shape.levels[0]

  if (!root) {
    errors.push('课程名为空')
  } else if (root.length > rootLevel.maxChars) {
    errors.push(`课程名超过 ${rootLevel.maxChars} 字`)
  }

  const total = 1 + validateLevel(result.children ?? [], 1, shape, errors)

  if (total < MIN_TOTAL) errors.push(`整棵树只有 ${total} 个节点，拆得不够细`)
  if (total > MAX_TOTAL) errors.push(`整棵树有 ${total} 个节点，太碎了，不好用`)

  return errors
}

function buildNodes(items: FilledNode[]): TreeNode[] {
  return items.map((item) => {
    const node = createNode(item.title ?? '')
    if (item.note) node.note = item.note.slice(0, MAX_NOTE)
    node.children = buildNodes(item.children ?? [])
    return node
  })
}

/** 把通过校验的填充结果组装成树；调用前请先跑 validateFill。 */
export function buildTreeFromFill(result: FillResult, shape: TreeShape): Tree {
  const tree = createTree(result.root, result.description ?? '')
  const rootMax = shape.levels[0].maxChars
  if (tree.root.title.length > rootMax) {
    tree.root.title = tree.root.title.slice(0, rootMax)
  }
  tree.root.children = buildNodes(result.children ?? [])
  tree.root.collapsed = false
  return tree
}
