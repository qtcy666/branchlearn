import { create } from 'zustand'
import {
  createEmptyDocument,
  createId,
  createNode,
  createTree,
  type NodeStatus,
  type Tree,
  type TreeDocument,
  type TreeNode,
} from '../types/tree'
import { loadDocument, saveDocument } from '../lib/storage'
import {
  findNode,
  insertChild,
  moveNode as moveNodeInTree,
  removeNode,
  updateNode,
} from '../lib/treeOps'
import { buildTreeFromTemplate, type Template } from '../data/templates'
import { displayStatus } from '../lib/status'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface TreeStore {
  document: TreeDocument
  activeTreeId: string | null
  saveState: SaveState
  notice: string | null

  createTree: (title: string, description?: string) => string
  createTreeFromTemplate: (template: Template) => string
  createTreeWithOutline: (
    title: string,
    description: string,
    outline: { title: string; children?: { title: string }[] }[],
  ) => string
  createTreeWithDepth: (title: string, description: string, depth: number) => string
  selectTree: (id: string) => void
  dismissNotice: () => void
  notify: (message: string) => void

  addChild: (parentId: string, title: string) => string | null
  renameNode: (nodeId: string, title: string) => void
  deleteNode: (nodeId: string) => void
  toggleCollapse: (nodeId: string) => void
  moveNode: (draggedId: string, targetParentId: string, index: number) => boolean
  setNodeStatus: (nodeId: string, status: NodeStatus) => void
  cycleNodeStatus: (nodeId: string) => void
  importTrees: (trees: Tree[]) => number
  renameTree: (treeId: string, title: string) => void
  renameLevel: (depth: number, name: string) => void
  deleteTree: (treeId: string) => void
  restoreTrees: (trees: Tree[]) => void
}

const initial = loadDocument()

let saveTimer: ReturnType<typeof setTimeout> | null = null

/** 防抖写盘：连续操作时只在停下来 350ms 后写一次。 */
function scheduleSave(get: () => TreeStore, set: (partial: Partial<TreeStore>) => void) {
  if (saveTimer) clearTimeout(saveTimer)
  set({ saveState: 'saving' })
  saveTimer = setTimeout(() => {
    const store = get()
    try {
      saveDocument(store.document)
      set({ saveState: 'saved' })
    } catch {
      set({ saveState: 'error', notice: '保存失败：浏览器本地存储不可用或已满。' })
    }
  }, 350)
}

export const useTreeStore = create<TreeStore>((set, get) => {
  /** 所有节点操作都走这里：只替换当前树，并统一打时间戳、触发保存。 */
  const commit = (updater: (tree: Tree) => Tree) => {
    const state = get()
    const activeId = state.activeTreeId
    if (!activeId) return

    const trees = state.document.trees.map((tree) =>
      tree.id === activeId ? { ...updater(tree), updatedAt: Date.now() } : tree,
    )

    set({ document: { ...state.document, trees, updatedAt: Date.now() } })
    scheduleSave(get, set)
  }

  const appendTree = (tree: Tree) => {
    const state = get()
    const document: TreeDocument = {
      ...state.document,
      trees: [...state.document.trees, tree],
      activeTreeId: tree.id,
      updatedAt: Date.now(),
    }
    set({ document, activeTreeId: tree.id })
    scheduleSave(get, set)
    return tree.id
  }

  return {
    document: initial.document,
    activeTreeId: initial.document.activeTreeId,
    saveState: 'idle',
    notice: initial.recovered ? (initial.message ?? null) : null,

    createTree: (title, description = '') => appendTree(createTree(title, description)),

    createTreeFromTemplate: (template) => appendTree(buildTreeFromTemplate(template)),

    createTreeWithOutline: (title, description, outline) => {
      const tree = createTree(title, description)
      tree.root.children = outline.map((item) => {
        const chapter = createNode(item.title)
        chapter.children = (item.children ?? []).map((child) => createNode(child.title))
        return chapter
      })
      tree.root.collapsed = false
      return appendTree(tree)
    },

    createTreeWithDepth: (title, description, depth) => {
      const tree = createTree(title, description)
      const maxDepth = Math.min(Math.max(depth, 2), 5)
      const build = (level: number): TreeNode[] => {
        if (level >= maxDepth) return []
        return Array.from({ length: 2 }, () => {
          const node = createNode('')
          node.children = build(level + 1)
          return node
        })
      }
      tree.root.children = build(1)
      tree.root.collapsed = false
      return appendTree(tree)
    },

    selectTree: (id) => {
      const state = get()
      if (!state.document.trees.some((tree) => tree.id === id)) return
      const document: TreeDocument = {
        ...state.document,
        activeTreeId: id,
        updatedAt: Date.now(),
      }
      set({ document, activeTreeId: id })
      scheduleSave(get, set)
    },

    dismissNotice: () => set({ notice: null }),
    notify: (message) => set({ notice: message }),

    addChild: (parentId, title) => {
      const trimmed = title.trim()
      if (!trimmed) return null

      const state = get()
      const tree = state.document.trees.find((item) => item.id === state.activeTreeId)
      if (!tree || !findNode(tree.root, parentId)) return null

      const child = createNode(trimmed)
      commit((current) => ({
        ...current,
        root: insertChild(current.root, parentId, child),
      }))
      return child.id
    },

    renameNode: (nodeId, title) => {
      const trimmed = title.trim()
      if (!trimmed) return

      commit((tree) => {
        const root = updateNode(tree.root, nodeId, (node) => ({
          ...node,
          title: trimmed,
          updatedAt: Date.now(),
        }))
        // 根节点就是这门课本身，改名时同步树的标题
        return { ...tree, root, title: root.id === nodeId ? trimmed : tree.title }
      })
    },

    deleteNode: (nodeId) => {
      const state = get()
      const tree = state.document.trees.find((item) => item.id === state.activeTreeId)
      if (!tree || tree.root.id === nodeId) return

      commit((current) => ({ ...current, root: removeNode(current.root, nodeId) }))
    },

    toggleCollapse: (nodeId) => {
      commit((tree) => ({
        ...tree,
        root: updateNode(tree.root, nodeId, (node) => ({
          ...node,
          collapsed: !node.collapsed,
        })),
      }))
    },

    moveNode: (draggedId, targetParentId, index) => {
      const state = get()
      const tree = state.document.trees.find((item) => item.id === state.activeTreeId)
      if (!tree) return false

      const moved = moveNodeInTree(tree.root, draggedId, targetParentId, index)
      if (!moved) return false

      commit((current) => ({ ...current, root: moved }))
      return true
    },

    setNodeStatus: (nodeId, status) => {
      const state = get()
      const tree = state.document.trees.find((item) => item.id === state.activeTreeId)
      if (!tree) return
      const node = findNode(tree.root, nodeId)
      if (!node) return
      // 有子节点的节点状态由子节点汇总决定，不能手动标完成
      if (node.children.length > 0) return

      commit((current) => ({
        ...current,
        root: updateNode(current.root, nodeId, (target) => ({
          ...target,
          status,
          statusManual: false,
          updatedAt: Date.now(),
        })),
      }))
    },

    cycleNodeStatus: (nodeId) => {
      const state = get()
      const tree = state.document.trees.find((item) => item.id === state.activeTreeId)
      if (!tree) return
      const node = findNode(tree.root, nodeId)
      if (!node) return
      // 同上：父节点的完成状态只能等子节点全部完成
      if (node.children.length > 0) return

      const currentStatus = displayStatus(node)
      const next: NodeStatus =
        currentStatus === 'todo' ? 'learning' : currentStatus === 'learning' ? 'done' : 'todo'

      commit((current) => ({
        ...current,
        root: updateNode(current.root, nodeId, (target) => ({
          ...target,
          status: next,
          statusManual: false,
          updatedAt: Date.now(),
        })),
      }))
    },

    importTrees: (incoming) => {
      if (incoming.length === 0) return 0

      const state = get()
      const existing = new Set(state.document.trees.map((tree) => tree.id))
      const added = incoming.map((tree) =>
        existing.has(tree.id) ? { ...tree, id: createId('t') } : tree,
      )

      const document: TreeDocument = {
        ...state.document,
        trees: [...state.document.trees, ...added],
        activeTreeId: added[0].id,
        updatedAt: Date.now(),
      }
      set({ document, activeTreeId: added[0].id })
      scheduleSave(get, set)
      return added.length
    },

    renameTree: (treeId, title) => {
      const trimmed = title.trim()
      if (!trimmed) return

      const state = get()
      const trees = state.document.trees.map((tree) =>
        tree.id === treeId
          ? {
              ...tree,
              title: trimmed,
              root: { ...tree.root, title: trimmed, updatedAt: Date.now() },
              updatedAt: Date.now(),
            }
          : tree,
      )

      set({ document: { ...state.document, trees, updatedAt: Date.now() } })
      scheduleSave(get, set)
    },

    renameLevel: (depth, name) => {
      const trimmed = name.trim()
      commit((tree) => {
        const names = [...tree.levelNames]
        while (names.length <= depth) names.push('')
        names[depth] = trimmed
        return { ...tree, levelNames: names }
      })
    },

    deleteTree: (treeId) => {
      const state = get()
      const trees = state.document.trees.filter((tree) => tree.id !== treeId)
      const activeTreeId =
        state.activeTreeId === treeId ? (trees[0]?.id ?? null) : state.activeTreeId

      set({
        document: { ...state.document, trees, activeTreeId, updatedAt: Date.now() },
        activeTreeId,
      })
      scheduleSave(get, set)
    },

    /** 撤销删除：按原 id 放回列表末尾，不改变当前正在看的树。 */
    restoreTrees: (incoming) => {
      if (incoming.length === 0) return
      const state = get()
      const existing = new Set(state.document.trees.map((tree) => tree.id))
      const added = incoming.filter((tree) => !existing.has(tree.id))
      if (added.length === 0) return

      set({
        document: {
          ...state.document,
          trees: [...state.document.trees, ...added],
          updatedAt: Date.now(),
        },
      })
      scheduleSave(get, set)
    },
  }
})

/** 测试与热更新时重置，避免模块级定时器残留。 */
export function resetStoreForTest() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  useTreeStore.setState({
    document: createEmptyDocument(),
    activeTreeId: null,
    saveState: 'idle',
    notice: null,
  })
}
