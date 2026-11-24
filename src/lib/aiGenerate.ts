/**
 * 阶段 1：mock 生成 + 契约树落地
 *
 * 这里只负责「把一份合法的契约树变成可渲染的 Tree」，以及在没有后端时
 * 用确定性数据把整条链路（进度 → 预览 → 应用 → 撤销）跑通。
 * 阶段 2 接真接口时，只需要把 mockGenerate 换成 SSE 版本，其余不动。
 */

import { createNode, createTree, type Tree, type TreeNode } from '../types/tree'
import {
  SCHEMA_TREE_VERSION,
  stripNumbering,
  truncateChars,
  type SchemaNode,
  type SchemaTree,
} from './treeSchema'

export type GenerateEvent =
  | { type: 'progress'; done: number; total: number }
  | { type: 'tree'; tree: SchemaTree }

interface MockSpec {
  title: string
  children?: MockSpec[]
}

/**
 * mock 数据刻意用真实教材目录，且每条都满足契约约束：
 * 3 层、每层 ≤8、标题 ≤14 字、不带编号。
 */
const MOCK_OUTLINE: MockSpec[] = [
  {
    title: '行列式',
    children: [
      { title: '二阶与三阶行列式' },
      { title: '全排列与对换' },
      { title: '行列式的性质' },
      { title: '行列式按行展开' },
      { title: '克拉默法则' },
    ],
  },
  {
    title: '矩阵',
    children: [
      { title: '矩阵的线性运算' },
      { title: '矩阵的乘法' },
      { title: '逆矩阵' },
      { title: '分块矩阵' },
      { title: '矩阵的秩' },
    ],
  },
  {
    title: '线性方程组',
    children: [
      { title: '初等变换与初等矩阵' },
      { title: '齐次线性方程组' },
      { title: '非齐次线性方程组' },
      { title: '解的结构' },
    ],
  },
  {
    title: '向量组',
    children: [
      { title: '线性相关与无关' },
      { title: '向量组的秩' },
      { title: '向量空间' },
      { title: '基与维数' },
    ],
  },
  {
    title: '二次型',
    children: [
      { title: '特征值与特征向量' },
      { title: '相似矩阵与对角化' },
      { title: '二次型及其标准形' },
      { title: '正定二次型' },
    ],
  },
]

function toSchemaNode(spec: MockSpec, path: string): SchemaNode {
  return {
    id: path === '' ? 'root' : `n-${path}`,
    title: truncateChars(stripNumbering(spec.title), 14),
    summary: '',
    meta: { progress: '0/0' },
    children: (spec.children ?? []).map((child, index) =>
      toSchemaNode(child, path === '' ? String(index) : `${path}-${index}`),
    ),
  }
}

/** 按主题生成一棵确定性的 mock 树；主题只影响根节点标题。 */
export function buildMockTree(topic: string): SchemaTree {
  const title = truncateChars(stripNumbering(topic.trim()) || '未命名课程', 14)
  return {
    version: SCHEMA_TREE_VERSION,
    root: {
      id: 'root',
      title,
      summary: 'AI 生成草稿',
      meta: { progress: '0/0' },
      children: MOCK_OUTLINE.map((item, index) => toSchemaNode(item, String(index))),
    },
  }
}

function countSchemaNodes(node: SchemaNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countSchemaNodes(child), 0)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('已取消', 'AbortError'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('已取消', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 模拟流式生成：每 55ms 报一次进度，最后吐出完整树。
 * 用 AsyncGenerator 是为了阶段 2 能原地替换成 SSE 解析，不用改调用方。
 */
export async function* mockGenerate(
  topic: string,
  signal?: AbortSignal,
): AsyncGenerator<GenerateEvent> {
  const tree = buildMockTree(topic)
  const total = countSchemaNodes(tree.root)
  yield { type: 'progress', done: 0, total }
  for (let done = 1; done <= total; done += 1) {
    await sleep(55, signal)
    yield { type: 'progress', done, total }
  }
  yield { type: 'tree', tree }
}

function buildNode(schema: SchemaNode): TreeNode {
  const node = createNode(schema.title)
  node.note = schema.summary
  node.source = 'ai'
  node.children = schema.children.map(buildNode)
  return node
}

/**
 * 契约树 → 本地 Tree。
 * 本地 id 全部重新生成，AI 的 id 只用于 diff 对齐，不进入存储。
 */
export function schemaToTree(schema: SchemaTree, description = ''): Tree {
  const tree = createTree(schema.root.title, description || schema.root.summary)
  tree.root.note = schema.root.summary
  tree.root.source = 'ai'
  tree.root.collapsed = false
  tree.root.children = schema.root.children.map(buildNode)
  return tree
}
