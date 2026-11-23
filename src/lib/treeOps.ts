import { countNodes, type TreeNode } from '../types/tree'

/**
 * 树操作全部做成纯函数：输入旧树，返回新树，不改原对象。
 * 这样 React 能靠引用变化判断要不要重渲染，也方便将来做撤销。
 */

export function findNode(root: TreeNode, id: string): TreeNode | null {
  if (root.id === id) return root
  for (const child of root.children) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

export function findParent(root: TreeNode, id: string): TreeNode | null {
  for (const child of root.children) {
    if (child.id === id) return root
    const found = findParent(child, id)
    if (found) return found
  }
  return null
}

function contains(node: TreeNode, id: string): boolean {
  if (node.id === id) return true
  return node.children.some((child) => contains(child, id))
}

/** targetId 是否是 ancestorId 的后代。拖拽时用来防止把父节点拖进自己的子树。 */
export function isDescendant(root: TreeNode, ancestorId: string, targetId: string): boolean {
  const ancestor = findNode(root, ancestorId)
  if (!ancestor) return false
  return ancestor.children.some((child) => contains(child, targetId))
}

export function updateNode(
  node: TreeNode,
  id: string,
  updater: (target: TreeNode) => TreeNode,
): TreeNode {
  if (node.id === id) return updater(node)

  let changed = false
  const children = node.children.map((child) => {
    const next = updateNode(child, id, updater)
    if (next !== child) changed = true
    return next
  })

  return changed ? { ...node, children } : node
}

export function removeNode(root: TreeNode, id: string): TreeNode {
  let changed = false
  const children: TreeNode[] = []

  for (const child of root.children) {
    if (child.id === id) {
      changed = true
      continue
    }
    const next = removeNode(child, id)
    if (next !== child) changed = true
    children.push(next)
  }

  return changed ? { ...root, children } : root
}

export function insertChild(
  root: TreeNode,
  parentId: string,
  child: TreeNode,
  index?: number,
): TreeNode {
  return updateNode(root, parentId, (parent) => {
    const children = [...parent.children]
    if (index === undefined || index < 0 || index > children.length) {
      children.push(child)
    } else {
      children.splice(index, 0, child)
    }
    return { ...parent, children, collapsed: false, updatedAt: Date.now() }
  })
}

/**
 * 把节点移动到新的父节点下。
 * 返回 null 表示这次移动非法（拖到自己身上、拖进自己的后代、目标不存在）。
 */
export function moveNode(
  root: TreeNode,
  draggedId: string,
  targetParentId: string,
  index: number,
): TreeNode | null {
  if (draggedId === targetParentId) return null
  if (isDescendant(root, draggedId, targetParentId)) return null

  const dragged = findNode(root, draggedId)
  if (!dragged) return null
  if (!findNode(root, targetParentId)) return null

  const without = removeNode(root, draggedId)
  const parent = findNode(without, targetParentId)
  if (!parent) return null

  const clamped = Math.max(0, Math.min(index, parent.children.length))
  return insertChild(without, targetParentId, { ...dragged, updatedAt: Date.now() }, clamped)
}

export function countDescendants(node: TreeNode): number {
  return countNodes(node) - 1
}

/** 把同级节点里被拖动的那个先去掉，算出插入位置。 */
export function computeDropIndex(
  siblingIds: string[],
  targetId: string,
  position: 'before' | 'after',
  draggedId: string,
): number {
  const filtered = siblingIds.filter((id) => id !== draggedId)
  const base = filtered.indexOf(targetId)
  if (base === -1) return filtered.length
  return position === 'before' ? base : base + 1
}
