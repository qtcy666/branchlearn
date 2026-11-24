/**
 * 阶段 1：树 diff
 *
 * 只做节点级对齐，不碰坐标。对齐键是「去掉编号后的标题」，
 * 因为现有树里的「第一章 行列式」和 AI 返回的「行列式」是同一个知识点。
 * 同层重名时按出现顺序依次配对，避免一个标题吃掉所有同名节点。
 */

import type { Tree, TreeNode } from '../types/tree'
import { stripNumbering, type SchemaNode, type SchemaTree } from './treeSchema'

export type DiffKind = 'same' | 'added' | 'changed' | 'removed'

export interface DiffNode {
  title: string
  kind: DiffKind
  children: DiffNode[]
}

export interface TreeDiff {
  root: DiffNode
  added: number
  changed: number
  removed: number
}

function alignKey(title: string): string {
  return stripNumbering(title).replace(/\s+/g, '')
}

interface Counters {
  added: number
  changed: number
  removed: number
}

function buildDiff(
  current: TreeNode | undefined,
  next: SchemaNode | undefined,
  counters: Counters,
): DiffNode {
  if (!current && next) {
    counters.added += 1
    return {
      title: next.title,
      kind: 'added',
      children: next.children.map((child) => buildDiff(undefined, child, counters)),
    }
  }
  if (current && !next) {
    counters.removed += 1
    return {
      title: current.title,
      kind: 'removed',
      children: current.children.map((child) => buildDiff(child, undefined, counters)),
    }
  }
  if (!current || !next) {
    throw new Error('diff 配对失败：current 与 next 不能同时为空')
  }

  const changed =
    current.title.trim() !== next.title.trim() || (current.note ?? '') !== (next.summary ?? '')
  if (changed) counters.changed += 1

  const pairs = pairChildren(current.children, next.children)
  return {
    title: next.title,
    kind: changed ? 'changed' : 'same',
    children: pairs.map((pair) => buildDiff(pair.current, pair.next, counters)),
  }
}

function pairChildren(
  current: TreeNode[],
  next: SchemaNode[],
): Array<{ current?: TreeNode; next?: SchemaNode }> {
  const used = new Set<number>()
  const result: Array<{ current?: TreeNode; next?: SchemaNode }> = []

  for (const item of next) {
    const key = alignKey(item.title)
    const index = current.findIndex(
      (candidate, candidateIndex) =>
        !used.has(candidateIndex) && alignKey(candidate.title) === key,
    )
    if (index >= 0) {
      used.add(index)
      result.push({ current: current[index], next: item })
    } else {
      result.push({ next: item })
    }
  }

  current.forEach((item, index) => {
    if (!used.has(index)) result.push({ current: item })
  })

  return result
}

/** current 为空时表示新建，整棵树都算新增。 */
export function diffTrees(current: Tree | null, next: SchemaTree): TreeDiff {
  const counters: Counters = { added: 0, changed: 0, removed: 0 }
  const root = buildDiff(current?.root, next.root, counters)
  return { root, ...counters }
}

/** 把 diff 树压平成带层级的列表，供预览面板直接渲染。 */
export interface DiffRow {
  title: string
  kind: DiffKind
  depth: number
  hasChildren: boolean
}

export function flattenDiff(node: DiffNode, depth = 0): DiffRow[] {
  const row: DiffRow = {
    title: node.title,
    kind: node.kind,
    depth,
    hasChildren: node.children.length > 0,
  }
  return [row, ...node.children.flatMap((child) => flattenDiff(child, depth + 1))]
}
