import { displayStatus } from './status'
import type { NodeStatus, Tree, TreeNode } from '../types/tree'

/**
 * 不用 html2canvas，直接用手绘。
 *
 * 原因：html2canvas 需要把 DOM 重新解释一遍，遇到 CSS 变量、backdrop-filter、
 * 中文字体回退时经常对不上，而且体积大。这棵树的视觉结构很简单（一列带缩进的文字），
 * 手绘反而更可控、更清晰、零依赖。
 */

const ROW_HEIGHT = 36
const INDENT = 22
const PAD_X = 40
const PAD_TOP = 108
const PAD_BOTTOM = 64
const WIDTH = 1000
const SCALE = 2

const CHAPTER_COLORS = ['#2f6b4f', '#8a5a2b', '#4a5a8a', '#7a4a6a', '#5a7a3a', '#8a4a4a']

interface Row {
  node: TreeNode
  depth: number
  color: string
}

function collectRows(root: TreeNode): Row[] {
  const rows: Row[] = []

  const walk = (node: TreeNode, depth: number, color: string) => {
    rows.push({ node, depth, color })
    if (node.collapsed) return
    node.children.forEach((child, index) => {
      walk(child, depth + 1, depth === 0 ? CHAPTER_COLORS[index % CHAPTER_COLORS.length] : color)
    })
  }

  walk(root, 0, CHAPTER_COLORS[0])
  return rows
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let result = text
  while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1)
  }
  return `${result}…`
}

function drawStatus(ctx: CanvasRenderingContext2D, x: number, y: number, status: NodeStatus) {
  ctx.beginPath()
  ctx.arc(x, y, 5, 0, Math.PI * 2)

  if (status === 'done') {
    ctx.fillStyle = '#2f6b4f'
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(x - 2.4, y)
    ctx.lineTo(x - 0.6, y + 1.9)
    ctx.lineTo(x + 2.6, y - 1.8)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
    return
  }

  if (status === 'learning') {
    ctx.fillStyle = '#d9a441'
    ctx.fill()
    return
  }

  ctx.strokeStyle = '#c9c3b6'
  ctx.lineWidth = 1.4
  ctx.stroke()
}

function safeFileName(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, '-').trim()
  return cleaned || 'branchlearn'
}

export async function exportTreeAsPng(tree: Tree): Promise<void> {
  const rows = collectRows(tree.root)
  const height = PAD_TOP + rows.length * ROW_HEIGHT + PAD_BOTTOM

  const canvas = document.createElement('canvas')
  canvas.width = WIDTH * SCALE
  canvas.height = height * SCALE

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持导出图片')

  ctx.scale(SCALE, SCALE)
  ctx.textBaseline = 'middle'

  // 纸张背景
  ctx.fillStyle = '#faf9f6'
  ctx.fillRect(0, 0, WIDTH, height)

  // 标题
  ctx.fillStyle = '#1b1a17'
  ctx.font = '600 26px "PingFang SC", -apple-system, "Microsoft YaHei", sans-serif'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(truncate(ctx, tree.title, WIDTH - PAD_X * 2), PAD_X, 52)

  if (tree.description) {
    ctx.fillStyle = '#8b877e'
    ctx.font = '13px "PingFang SC", -apple-system, "Microsoft YaHei", sans-serif'
    ctx.fillText(truncate(ctx, tree.description, WIDTH - PAD_X * 2), PAD_X, 76)
  }

  // 顶部细分隔线
  ctx.strokeStyle = '#e7e3da'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD_X, 92)
  ctx.lineTo(WIDTH - PAD_X, 92)
  ctx.stroke()

  ctx.textBaseline = 'middle'
  const titleMaxWidth = WIDTH - PAD_X * 2 - 60

  rows.forEach((row, index) => {
    const y = PAD_TOP + index * ROW_HEIGHT + ROW_HEIGHT / 2
    const left = PAD_X + row.depth * INDENT

    // 一级章节左侧色条
    if (row.depth === 1) {
      ctx.fillStyle = row.color
      ctx.globalAlpha = 0.85
      ctx.fillRect(left - 12, y - 9, 3, 18)
      ctx.globalAlpha = 1
    }

    drawStatus(ctx, left + 5, y, displayStatus(row.node))

    const isRoot = row.depth === 0
    ctx.fillStyle = displayStatus(row.node) === 'done' ? '#6d7a71' : '#1b1a17'
    ctx.font = isRoot
      ? '600 16px "PingFang SC", -apple-system, "Microsoft YaHei", sans-serif'
      : `${row.depth === 1 ? '600' : '400'} 14px "PingFang SC", -apple-system, "Microsoft YaHei", sans-serif`

    const text = truncate(ctx, row.node.title, titleMaxWidth - row.depth * INDENT)
    ctx.fillText(text, left + 18, y)
  })

  // 页脚
  ctx.fillStyle = '#8b877e'
  ctx.font = '12px "PingFang SC", -apple-system, "Microsoft YaHei", sans-serif'
  ctx.fillText('树学 · 今天学什么', PAD_X, height - 30)

  const date = new Date().toISOString().slice(0, 10)
  const dateWidth = ctx.measureText(date).width
  ctx.fillText(date, WIDTH - PAD_X - dateWidth, height - 30)

  await new Promise<void>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('导出失败：图片生成失败'))
        return
      }
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `branchlearn-${safeFileName(tree.title)}-${date}.png`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      resolve()
    }, 'image/png')
  })
}
