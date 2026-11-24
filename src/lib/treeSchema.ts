/**
 * AI 树数据契约（阶段 0）
 *
 * 这一层只服务 AI 的输入/输出，和界面用的 `Tree` 保持隔离：
 * - AI 只产出这份 JSON，坐标/尺寸仍由现有渲染代码计算。
 * - 现有 `Tree` 通过 `toSchemaTree` 导出一份「规范化副本」喂给 AI，
 *   不会修改原树，页面因此没有任何变化。
 * - 所有约束集中在这里，阶段 1/2 的重试与 diff 都复用同一个 `validateTree`。
 *
 * 契约：
 * {"version":1,"root":{"id","title","summary","meta":{"progress":"0/0"},"children":[...]}}
 */

import type { Tree, TreeNode } from '../types/tree'
import { displayStatus } from './status'

/** AI 契约版本，和本地存储的 SCHEMA_VERSION 是两套东西，别混用。 */
export const SCHEMA_TREE_VERSION = 1

/** 契约硬约束。改这里等于改所有阶段的验收标准。 */
export const LIMITS = {
  maxDepth: 3,
  maxChildren: 8,
  maxTitle: 14,
  maxSummary: 20,
} as const

export interface SchemaNode {
  /** 全局唯一，只允许 [a-z0-9-]。 */
  id: string
  /** 不带编号，≤14 个字符。 */
  title: string
  /** ≤20 个字符，可为空字符串。 */
  summary: string
  /** 形如 "3/10"，按叶子节点统计。 */
  meta: { progress: string }
  children: SchemaNode[]
}

export interface SchemaTree {
  version: typeof SCHEMA_TREE_VERSION
  root: SchemaNode
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

const ID_PATTERN = /^[a-z0-9-]+$/
const PROGRESS_PATTERN = /^\d+\/\d+$/

/** 按用户看到的字符数算长度，避免 emoji 被算成两个。 */
export function charLength(text: string): number {
  return [...text].length
}

/** 去掉「第一章」「1.」「（二）」这类编号前缀；只用于 AI 副本，不写回原树。 */
export function stripNumbering(title: string): string {
  return title
    .replace(
      /^\s*(第[一二三四五六七八九十百零两\d]+[章节讲部篇单元]|[（(]?[一二三四五六七八九十百零两\d]+[）).、]|\d+[.、])\s*/,
      '',
    )
    .trim()
}

export function truncateChars(text: string, max: number): string {
  const chars = [...text]
  return chars.length <= max ? text : chars.slice(0, max).join('')
}

/** 现有节点 → 契约节点：重编合法 id，标题去编号并截断，summary 取备注。 */
function toSchemaNode(
  node: TreeNode,
  path: string,
  depth: number,
  rootDescription: string,
): SchemaNode {
  const cleaned = truncateChars(stripNumbering(node.title), LIMITS.maxTitle)
  const summarySource = depth === 0 ? rootDescription || node.note : node.note
  return {
    id: depth === 0 ? 'root' : `n-${path}`,
    title: cleaned,
    summary: truncateChars(summarySource.trim(), LIMITS.maxSummary),
    meta: { progress: leafProgress(node) },
    children: node.children.map((child, index) =>
      toSchemaNode(child, path ? `${path}-${index}` : String(index), depth + 1, rootDescription),
    ),
  }
}

/** 只统计叶子：父节点的完成是聚合出来的，不该在进度里重复计一次。 */
function leafProgress(node: TreeNode): string {
  let done = 0
  let total = 0
  const walk = (current: TreeNode) => {
    if (current.children.length === 0) {
      total += 1
      if (displayStatus(current) === 'done') done += 1
      return
    }
    for (const child of current.children) walk(child)
  }
  walk(node)
  return `${done}/${total}`
}

/**
 * 导出给 AI 的只读副本。
 * 不修改入参；id 按路径重编，保证符合 [a-z0-9-] 且全局唯一。
 */
export function toSchemaTree(tree: Tree): SchemaTree {
  return {
    version: SCHEMA_TREE_VERSION,
    root: toSchemaNode(tree.root, '', 0, tree.description),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 校验契约树。
 * errors 里每条都带路径，例如：
 *   root.children[2].title 超长（16 > 14 字）
 * 这些字符串会原样回喂给模型重试，所以要保持短、可定位、可执行。
 */
export function validateTree(input: unknown): ValidationResult {
  const errors: string[] = []

  if (!isRecord(input)) {
    return { ok: false, errors: ['root 必须是对象'] }
  }

  if (input.version !== SCHEMA_TREE_VERSION) {
    errors.push(`version 必须是 ${SCHEMA_TREE_VERSION}`)
  }

  const seenIds = new Map<string, string>()

  const walk = (value: unknown, path: string, depth: number) => {
    if (!isRecord(value)) {
      errors.push(`${path} 必须是对象`)
      return
    }

    if (depth > LIMITS.maxDepth) {
      errors.push(`${path} 超过 ${LIMITS.maxDepth} 层`)
      return
    }

    const id = value.id
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      errors.push(`${path}.id 必须是 [a-z0-9-] 且非空`)
    } else {
      const firstSeen = seenIds.get(id)
      if (firstSeen) {
        errors.push(`${path}.id 重复（已在 ${firstSeen} 出现）`)
      } else {
        seenIds.set(id, path)
      }
    }

    const title = value.title
    if (typeof title !== 'string' || title.trim() === '') {
      errors.push(`${path}.title 为空`)
    } else if (charLength(title) > LIMITS.maxTitle) {
      errors.push(`${path}.title 超长（${charLength(title)} > ${LIMITS.maxTitle} 字）`)
    }

    const summary = value.summary
    if (typeof summary !== 'string') {
      errors.push(`${path}.summary 必须是字符串`)
    } else if (charLength(summary) > LIMITS.maxSummary) {
      errors.push(`${path}.summary 超长（${charLength(summary)} > ${LIMITS.maxSummary} 字）`)
    }

    const meta = value.meta
    if (!isRecord(meta)) {
      errors.push(`${path}.meta 缺失`)
    } else if (typeof meta.progress !== 'string' || !PROGRESS_PATTERN.test(meta.progress)) {
      errors.push(`${path}.meta.progress 必须是 "已完成/总数"`)
    }

    const children = value.children
    if (!Array.isArray(children)) {
      errors.push(`${path}.children 必须是数组`)
      return
    }
    if (children.length > LIMITS.maxChildren) {
      errors.push(`${path}.children 过多（${children.length} > ${LIMITS.maxChildren} 个）`)
    }
    children.forEach((child, index) => walk(child, `${path}.children[${index}]`, depth + 1))
  }

  walk(input.root, 'root', 1)

  return { ok: errors.length === 0, errors }
}
