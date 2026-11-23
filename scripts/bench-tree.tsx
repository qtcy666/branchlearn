/**
 * 布局性能基准：构造一棵 1001 个节点的树，测一次完整布局需要多久。
 *
 * 早先这里测的是「渲染 1000 个节点的 DOM」，但那个列表视图已经被画布视图取代，
 * 渲染成本不再是瓶颈；真正随节点数增长的是 tidy 布局本身，所以现在直接压纯函数。
 *
 * 用法：npm run bench
 */
import { layoutTree } from '../src/lib/treeLayout'
import { createNode, createTree } from '../src/types/tree'

const tree = createTree('压测课程', '1000 节点场景')

for (let chapterIndex = 0; chapterIndex < 20; chapterIndex += 1) {
  const chapter = createNode(`第${chapterIndex + 1}章 测试章节`)
  for (let itemIndex = 0; itemIndex < 49; itemIndex += 1) {
    chapter.children.push(createNode(`知识点 ${chapterIndex + 1}-${itemIndex + 1}`))
  }
  tree.root.children.push(chapter)
}

let count = 0
const walk = (node: { children: { children: unknown[] }[] }) => {
  count += 1
  for (const child of node.children as never[]) walk(child)
}
walk(tree.root)

// 先热身一次，避免把 JIT 编译时间算进去
layoutTree(tree.root)

const rounds = 20
const start = performance.now()
let last = layoutTree(tree.root)
for (let i = 0; i < rounds; i += 1) last = layoutTree(tree.root)
const elapsed = (performance.now() - start) / rounds

console.log(`节点数: ${count}`)
console.log(`布局节点数: ${last.nodes.length}，连线数: ${last.edges.length}`)
console.log(`画布尺寸: ${Math.round(last.width)} × ${Math.round(last.height)}，深度 ${last.maxDepth}`)
console.log(`单次布局耗时: ${elapsed.toFixed(2)} ms（${rounds} 次平均）`)
