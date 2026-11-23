/**
 * 2D 树状图按「层」（深度）配色。
 *
 * 设计原则：不再让每一层都是同样重的实心绿块，而是分成两类材质——
 * - 结构层（根 / 一级）：实色绿，作为整棵树的两个视觉锚点；
 * - 内容层（二级及以下）：浅色卡片，只保留绿色描边和深色字。
 * 这样层级感来自「材质差异」，而不是「绿色深浅」，画布不会糊成一片。
 *
 * 色相统一收敛到带一点灰青的品牌绿，比纯 #1b5e20 柔和，也更耐看。
 */
export const LEVEL_COLORS = [
  '#2f6b4f', // 0 根：品牌深绿
  '#3d7f5f', // 1 章节
  '#4d9070', // 2
  '#5da07f', // 3
  '#6db08e', // 4
  '#7cc09d', // 5+
]

/** 结构层（实色）的最大深度；超过这个深度一律用浅色卡片。 */
export const SOLID_MAX_DEPTH = 1

/** 按深度取这一层的绿色（超过数组长度循环到最后一档）。 */
export function levelColor(depth: number): string {
  return LEVEL_COLORS[Math.min(depth, LEVEL_COLORS.length - 1)]
}

/** 判断这一层是否使用实色材质。 */
export function isSolidTier(depth: number): boolean {
  return depth <= SOLID_MAX_DEPTH
}

/** hex 与白色混合，whiteRatio 为白色占比（0~1），得到更浅的颜色。 */
export function tint(hex: string, whiteRatio: number): string {
  const { r, g, b } = hexToRgb(hex)
  const mix = (c: number) => Math.round(c + (255 - c) * whiteRatio)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

/** hex 与黑色混合，blackRatio 为黑色占比（0~1），得到更深的颜色。 */
export function shade(hex: string, blackRatio: number): string {
  const { r, g, b } = hexToRgb(hex)
  const mix = (c: number) => Math.round(c * (1 - blackRatio))
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace('#', '')
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  }
}
