import {
  createEmptyDocument,
  SCHEMA_VERSION,
  createId,
  type NodeStatus,
  type Tree,
  type TreeDocument,
  type TreeNode,
} from '../types/tree'

const STORAGE_KEY = 'branchlearn.document'
const BACKUP_KEY = 'branchlearn.document.corrupted'

/** 单份文档的节点上限，防止异常数据把页面拖死。 */
const MAX_NODES = 20000
const MAX_DEPTH = 60

export interface LoadResult {
  document: TreeDocument
  /** 是否发生过数据损坏或降级 */
  recovered: boolean
  message?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function readTime(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Date.now()
}

function readStatus(value: unknown): NodeStatus {
  return value === 'learning' || value === 'done' ? value : 'todo'
}

interface SanitizeCounter {
  nodes: number
}

/**
 * 把任意输入清洗成合法 TreeNode。
 * 目标不是"报错"，而是"尽量救回来"——用户的学习数据比格式规范重要。
 */
function sanitizeNode(raw: unknown, counter: SanitizeCounter, depth = 0): TreeNode | null {
  if (!isRecord(raw)) return null
  if (counter.nodes >= MAX_NODES) return null
  if (depth > MAX_DEPTH) return null

  counter.nodes += 1
  const children: TreeNode[] = []

  if (Array.isArray(raw.children) && depth < MAX_DEPTH) {
    for (const child of raw.children) {
      const parsed = sanitizeNode(child, counter, depth + 1)
      if (parsed) children.push(parsed)
      if (counter.nodes >= MAX_NODES) break
    }
  }

  return {
    id: readString(raw.id) || createId(),
    title: readString(raw.title).slice(0, 200),
    note: readString(raw.note).slice(0, 2000),
    status: readStatus(raw.status),
    statusManual: raw.statusManual === true,
    collapsed: raw.collapsed === true,
    children,
    createdAt: readTime(raw.createdAt),
    updatedAt: readTime(raw.updatedAt),
  }
}

function sanitizeTree(raw: unknown, counter: SanitizeCounter): Tree | null {
  if (!isRecord(raw)) return null
  const root = sanitizeNode(raw.root, counter)
  if (!root) return null
  return {
    id: readString(raw.id) || createId('t'),
    title: readString(raw.title, root.title).slice(0, 200),
    description: readString(raw.description).slice(0, 500),
    root,
    levelNames: Array.isArray(raw.levelNames)
      ? raw.levelNames
          .filter((item): item is string => typeof item === 'string')
          .slice(0, 10)
      : [],
    createdAt: readTime(raw.createdAt),
    updatedAt: readTime(raw.updatedAt),
  }
}

/** 把未知版本的文档迁移到当前版本。目前只有 v1，留好入口。 */
function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  const version = typeof raw.version === 'number' ? raw.version : 0
  // 未来：if (version < 2) { ...把 v1 结构转成 v2... }
  return { ...raw, version: Math.max(version, SCHEMA_VERSION) }
}

function sanitizeDocument(raw: unknown): { document: TreeDocument; ok: boolean } {
  if (!isRecord(raw)) return { document: createEmptyDocument(), ok: false }

  const migrated = migrate(raw)
  const counter: SanitizeCounter = { nodes: 0 }
  const trees: Tree[] = []

  if (Array.isArray(migrated.trees)) {
    for (const item of migrated.trees) {
      const tree = sanitizeTree(item, counter)
      if (tree) trees.push(tree)
    }
  }

  const activeTreeIdRaw = migrated.activeTreeId
  const activeTreeId =
    typeof activeTreeIdRaw === 'string' && trees.some((t) => t.id === activeTreeIdRaw)
      ? activeTreeIdRaw
      : (trees[0]?.id ?? null)

  const document: TreeDocument = {
    version: SCHEMA_VERSION,
    trees,
    activeTreeId,
    updatedAt: readTime(migrated.updatedAt),
  }

  return { document, ok: true }
}

function storageAvailable(): boolean {
  try {
    const probe = '__branchlearn_probe__'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

export function loadDocument(): LoadResult {
  if (typeof window === 'undefined' || !storageAvailable()) {
    return {
      document: createEmptyDocument(),
      recovered: true,
      message: '浏览器禁用了本地存储，本次数据不会被保存。',
    }
  }

  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return { document: createEmptyDocument(), recovered: false }
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    const { document, ok } = sanitizeDocument(parsed)
    if (!ok) {
      return {
        document,
        recovered: true,
        message: '本地数据格式异常，已重置为空文档。',
      }
    }

    return { document, recovered: false }
  } catch {
    // 保留一份原始数据，方便日后排查；写不进去就放弃
    try {
      window.localStorage.setItem(BACKUP_KEY, raw.slice(0, 500000))
    } catch {
      /* 忽略 */
    }
    return {
      document: createEmptyDocument(),
      recovered: true,
      message: '本地数据无法解析，已备份原始内容并重置。',
    }
  }
}

export function saveDocument(document: TreeDocument): void {
  if (typeof window === 'undefined' || !storageAvailable()) {
    throw new Error('浏览器禁用了本地存储')
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(document))
}

export function clearDocument(): void {
  if (typeof window === 'undefined' || !storageAvailable()) return
  window.localStorage.removeItem(STORAGE_KEY)
}

/**
 * 解析用户导入的 JSON。
 * 兼容两种内容：单棵树对象，或一份完整文档（含 trees 数组）。
 * 解析失败返回空数组，由调用方给出提示。
 */
export function parseImportedTrees(raw: unknown): Tree[] {
  const counter: SanitizeCounter = { nodes: 0 }

  if (isRecord(raw) && Array.isArray(raw.trees)) {
    return raw.trees
      .map((item) => sanitizeTree(item, counter))
      .filter((tree): tree is Tree => tree !== null)
  }

  const single = sanitizeTree(raw, counter)
  return single ? [single] : []
}
