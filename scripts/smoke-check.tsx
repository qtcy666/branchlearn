/**
 * 无头冒烟测试。
 *
 * 为什么需要它：项目里没有浏览器自动化环境，但"页面一打开就白屏"是最常见的
 * 低级错误。这个脚本用 react-dom/server 把组件渲染成字符串，验证三种关键状态
 * 都能产出预期内容：
 *   1. 空状态（App）
 *   2. 从模板创建的树的布局结果（layoutTree 纯函数）
 *   3. 折叠状态
 *
 * 注意：这里不通过 store 的 setState 来喂数据。zustand 在服务端渲染时读的是
 * 初始快照（getServerSnapshot），setState 之后 renderToString 仍然拿旧状态，
 * 会得到一个假的通过结果。所以树的部分直接把 tree 作为 props 传给组件。
 *
 * 它不替代人工验收，只用来在每次改完代码后快速排除"整页崩掉"。
 *
 * 运行：npm run smoke
 */
import { renderToString } from 'react-dom/server'
import App from '../src/App'
import { layoutTree, type LayoutNode } from '../src/lib/treeLayout'
import { TEMPLATES, buildTreeFromTemplate } from '../src/data/templates'
import { countNodes, createNode, createTree } from '../src/types/tree'
import { computeDropIndex, countDescendants, findNode, moveNode } from '../src/lib/treeOps'

function check(label: string, condition: boolean) {
  if (!condition) {
    console.error(`FAIL: ${label}`)
    process.exitCode = 1
  } else {
    console.log(`ok: ${label}`)
  }
}

// 1) 初始页（默认路由首屏）
const emptyHtml = renderToString(<App />)
check('初始页渲染出主标题', emptyHtml.includes('拆成今天做完的小事'))
check('初始页渲染出引导按钮', emptyHtml.includes('开始拆解'))

// 2) 从模板创建的树的布局（2D 纵向树的核心算法）
const template = TEMPLATES[0]
const tree = buildTreeFromTemplate(template)
const layout = layoutTree(tree.root)

const total = countNodes(tree.root)
check(`模板节点数正确（期望 28，实际 ${total}）`, total === 28)
check(`布局节点数与树一致（${layout.nodes.length} / ${total}）`, layout.nodes.length === total)
check('布局连线数 = 节点数 - 1', layout.edges.length === layout.nodes.length - 1)
check('根节点在左上角起点', layout.nodes[0]?.depth === 0 && layout.nodes[0]?.x >= 0)
check('布局宽高为正', layout.width > 0 && layout.height > 0)
check(`模板树有 3 层（深度 0..2，实际 ${layout.maxDepth}）`, layout.maxDepth === 2)

// 同一层里节点不能互相压住：这是手写 tidy 布局最容易错的地方
const overlaps = (() => {
  const byDepth = new Map<number, LayoutNode[]>()
  for (const item of layout.nodes) {
    const bucket = byDepth.get(item.depth) ?? []
    bucket.push(item)
    byDepth.set(item.depth, bucket)
  }
  let count = 0
  for (const bucket of byDepth.values()) {
    const sorted = [...bucket].sort((a, b) => a.x - b.x)
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].x < sorted[i - 1].x + sorted[i - 1].width - 0.01) count += 1
    }
  }
  return count
})()
check('同层节点没有重叠', overlaps === 0)

// 3) 折叠后子树不参与布局
const collapsed = buildTreeFromTemplate(template)
collapsed.root.children[0].collapsed = true
const collapsedLayout = layoutTree(collapsed.root)
check(
  `折叠后布局节点变少（${collapsedLayout.nodes.length} < ${layout.nodes.length}）`,
  collapsedLayout.nodes.length < layout.nodes.length,
)
check(
  '折叠后被隐藏的孙子节点不在布局里',
  !collapsedLayout.nodes.some((item) => item.node.title === '克拉默法则'),
)
check(
  '折叠后仍保留该章节本身',
  collapsedLayout.nodes.some((item) => item.node.title === '第一章 行列式'),
)

// 4) 树操作纯函数
const draft = createTree('测试树')
const nodeA = createNode('A')
const nodeB = createNode('B')
const nodeA1 = createNode('A1')
nodeA.children = [nodeA1]
draft.root.children = [nodeA, nodeB]

const siblingIds = draft.root.children.map((child) => child.id)
check(
  '把 B 拖到 A 之前，插入位置是 0',
  computeDropIndex(siblingIds, nodeA.id, 'before', nodeB.id) === 0,
)

const moved = moveNode(draft.root, nodeB.id, draft.root.id, 0)
check('moveNode 成功返回新树', moved !== null)
check('移动后 B 排到了 A 前面', moved?.children[0].id === nodeB.id)

check('不能把节点拖进自己的后代', moveNode(draft.root, nodeA.id, nodeA1.id, 0) === null)
check('countDescendants(A) 为 1', countDescendants(nodeA) === 1)
check('findNode 能找到深层节点', findNode(draft.root, nodeA1.id)?.title === 'A1')

console.log('\n渲染与逻辑检查结束')
