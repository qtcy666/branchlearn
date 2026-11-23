import type { NodeStatus, TreeNode } from '../types/tree'

/**
 * 状态的两层含义：
 * - 存储的 status：用户对这个节点本身标了什么
 * - 展示的 displayStatus：父节点在界面上应该显示成什么
 *
 * 父节点没被子节点"手动覆盖"时，显示状态由子节点聚合推导：
 *   全部子节点 done       → done
 *   有任意子节点非 todo   → learning
 *   其余                  → todo
 * 这样用户不需要逐个点父节点，标完小节，章节自动变绿。
 */

export function displayStatus(node: TreeNode): NodeStatus {
  // 叶子节点的状态就是它自己，聚合没有意义
  if (node.children.length === 0) return node.status
  if (node.statusManual) return node.status
  return aggregateStatus(node)
}

/** 忽略节点自身的 status / statusManual，只看子节点。 */
export function aggregateStatus(node: TreeNode): NodeStatus {
  if (node.children.length === 0) return node.status

  let allDone = true
  let anyStarted = false

  for (const child of node.children) {
    const status = displayStatus(child)
    if (status !== 'done') allDone = false
    if (status !== 'todo') anyStarted = true
  }

  if (allDone) return 'done'
  return anyStarted ? 'learning' : 'todo'
}

export interface Progress {
  done: number
  total: number
  percent: number
}

export function computeProgress(root: TreeNode): Progress {
  let done = 0
  let total = 0

  const walk = (node: TreeNode) => {
    total += 1
    if (displayStatus(node) === 'done') done += 1
    for (const child of node.children) walk(child)
  }

  walk(root)
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) }
}

export interface Candidate {
  node: TreeNode
  parent: TreeNode | null
  /** 从根到父节点的标题链，用来在卡片上显示"这在哪一章"。 */
  path: string[]
  reason: string
}

/**
 * 今日推荐的候选池。
 *
 * 规则：
 * 1. 整枝已完成的直接跳过，不浪费时间往下找；
 * 2. 只推荐叶子节点——父节点是容器，不是"今天能动手做完"的东西；
 * 3. "在学"的子节点优先排在前面，因为继续一件事比开新坑更容易；
 * 4. 其余保持树的原始顺序，保证推荐结果稳定、可解释。
 */
export function collectCandidates(root: TreeNode): Candidate[] {
  const result: Candidate[] = []

  const walk = (node: TreeNode, parent: TreeNode | null, path: string[]) => {
    if (displayStatus(node) === 'done') return

    if (node.children.length === 0) {
      // 空树的根节点不是任务，不给它排期
      if (parent === null) return
      result.push({
        node,
        parent,
        path,
        reason: buildReason(node, parent),
      })
      return
    }

    const ordered = [...node.children].sort((a, b) => {
      const aLearning = displayStatus(a) === 'learning' ? 0 : 1
      const bLearning = displayStatus(b) === 'learning' ? 0 : 1
      return aLearning - bLearning
    })

    for (const child of ordered) {
      walk(child, node, [...path, node.title])
    }
  }

  walk(root, null, [])
  return result
}

function buildReason(node: TreeNode, parent: TreeNode | null): string {
  if (node.status === 'learning') return '你正在学这一块'

  // 先看紧邻的上一块，这比"整章正在学"更具体
  if (parent) {
    const index = parent.children.findIndex((child) => child.id === node.id)
    const previous = index > 0 ? parent.children[index - 1] : null
    if (previous && displayStatus(previous) === 'done') {
      return `上一块「${previous.title}」已完成`
    }
  }

  if (parent && displayStatus(parent) === 'learning') {
    return `「${parent.title}」正在学，这是下一块`
  }

  return '按课程顺序，这块轮到你了'
}
