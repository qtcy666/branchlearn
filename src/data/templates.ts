import { createNode, createTree, type Tree, type TreeNode } from '../types/tree'

interface OutlineNode {
  title: string
  children?: OutlineNode[]
}

export interface Template {
  id: string
  title: string
  description: string
  outline: OutlineNode[]
}

/**
 * 模板的作用只有一个：让新用户跳过"面对空白页不知道写什么"的阶段。
 * 内容按同济版教材的章节顺序写，用户建完可以直接改成自己老师的进度。
 */
export const TEMPLATES: Template[] = [
  {
    id: 'linear-algebra',
    title: '线性代数',
    description: '同济版前五章，期末复习用',
    outline: [
      {
        title: '第一章 行列式',
        children: [
          { title: '二阶与三阶行列式' },
          { title: '全排列与对换' },
          { title: '行列式的性质' },
          { title: '行列式按行（列）展开' },
          { title: '克拉默法则' },
        ],
      },
      {
        title: '第二章 矩阵及其运算',
        children: [
          { title: '矩阵的线性运算' },
          { title: '矩阵的乘法' },
          { title: '逆矩阵' },
          { title: '分块矩阵' },
          { title: '矩阵的秩' },
        ],
      },
      {
        title: '第三章 初等变换与线性方程组',
        children: [
          { title: '初等变换与初等矩阵' },
          { title: '用初等变换求逆矩阵' },
          { title: '齐次线性方程组' },
          { title: '非齐次线性方程组' },
        ],
      },
      {
        title: '第四章 向量组的线性相关性',
        children: [
          { title: '向量组及其线性组合' },
          { title: '线性相关与线性无关' },
          { title: '向量组的秩' },
          { title: '向量空间' },
        ],
      },
      {
        title: '第五章 相似矩阵及二次型',
        children: [
          { title: '特征值与特征向量' },
          { title: '相似矩阵与对角化' },
          { title: '二次型及其标准形' },
          { title: '正定二次型' },
        ],
      },
    ],
  },
  {
    id: 'calculus',
    title: '高等数学',
    description: '上册主干内容，按章节拆',
    outline: [
      {
        title: '第一章 函数与极限',
        children: [
          { title: '映射与函数' },
          { title: '数列的极限' },
          { title: '函数的极限' },
          { title: '无穷小与无穷大' },
          { title: '两个重要极限' },
          { title: '函数的连续性与间断点' },
        ],
      },
      {
        title: '第二章 导数与微分',
        children: [
          { title: '导数的定义' },
          { title: '求导法则' },
          { title: '高阶导数' },
          { title: '隐函数与参数方程求导' },
          { title: '函数的微分' },
        ],
      },
      {
        title: '第三章 微分中值定理与导数的应用',
        children: [
          { title: '罗尔定理与拉格朗日中值定理' },
          { title: '洛必达法则' },
          { title: '泰勒公式' },
          { title: '函数的单调性与极值' },
          { title: '曲线的凹凸性与拐点' },
        ],
      },
      {
        title: '第四章 不定积分',
        children: [
          { title: '原函数与不定积分' },
          { title: '换元积分法' },
          { title: '分部积分法' },
          { title: '有理函数的积分' },
        ],
      },
      {
        title: '第五章 定积分',
        children: [
          { title: '定积分的概念与性质' },
          { title: '微积分基本公式' },
          { title: '定积分的换元法与分部积分法' },
          { title: '反常积分' },
        ],
      },
    ],
  },
]

function buildNode(spec: OutlineNode): TreeNode {
  const node = createNode(spec.title)
  node.children = (spec.children ?? []).map(buildNode)
  return node
}

export function buildTreeFromTemplate(template: Template): Tree {
  const tree = createTree(template.title, template.description)
  tree.root.children = template.outline.map(buildNode)
  tree.root.collapsed = false
  return tree
}

export function countTemplateNodes(template: Template): number {
  const walk = (nodes: OutlineNode[]): number =>
    nodes.reduce((total, node) => total + 1 + walk(node.children ?? []), 0)
  return 1 + walk(template.outline)
}
