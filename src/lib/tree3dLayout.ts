import * as THREE from 'three'
import type { TreeNode } from '../types/tree'

/**
 * 3D 知识树的骨架。
 *
 * 这一版把"随机扇形树"改成了"镜像对称树"：
 *
 * 1. 结构关于 yz 平面（x = 0）严格镜像。每一对章枝在同一高度、同一仰角、
 *    同一长度上左右分开，二级枝的左右摆动幅度也逐对镜像；
 * 2. 主干笔直微弧，下粗上细；一级枝从 42° 起，越往上越收（32°），
 *    二级枝相对父枝左右各 25°，末梢再收一点，所以轮廓是上收的卵圆形；
 * 3. 每一根枝都是 CatmullRomCurve3，末端逐渐向上翘，不是直线扇骨；
 * 4. 叶子只在一半（左半 + 中轴）生成，最后整体镜像到右半，
 *    冠形、叶量、颜色层次都严格对称；
 * 5. 每个承载节点的枝都记录一个"贴名字"的锚点，叶片生成时主动避开锚点，
 *    给文字留出干净的树皮背景。
 *
 * 名字本身不画在 3D 纹理上——枝太细，弧面贴图会把字裹到侧面。
 * 名字由 Tree3D 的 HTML 标签层每帧按相机投影，贴在枝的旁边。
 */

export interface BranchNode {
  id: string
  depth: number
  curve: THREE.CatmullRomCurve3
  r0: number
  r1: number
  length: number
  /** -1 左半，0 中轴，1 右半。只用于生成，不参与渲染。 */
  side: -1 | 0 | 1
  /** 名字的首选参数位置（0..1）。 */
  labelT: number
  /** 允许沿枝滑动的范围，避免标签互相压住。 */
  labelSpan: number
  /** 名字挂在枝的哪一侧：1 上/外，-1 下/内。左右镜像时保持同号。 */
  labelSide: 1 | -1
  /** 是否承载节点名。后层装饰枝为 false。 */
  labeled: boolean
  /** 文字优先级：0 根，1 章，2 知识点，3 更深。 */
  labelRank: number
}

export interface TwigNode {
  curve: THREE.CatmullRomCurve3
  r0: number
  r1: number
  side: -1 | 0 | 1
  /** 只有左半/中轴的枝负责长叶子，右半靠镜像补齐。 */
  source: boolean
}

export interface LeafVisual {
  pos: THREE.Vector3
  size: number
  quat: THREE.Quaternion
  tone: number
}

export interface LabelAnchor {
  id: string
  depth: number
  point: THREE.Vector3
  radius: number
}

export interface TreeShape {
  branches: BranchNode[]
  twigs: TwigNode[]
  leaves: LeafVisual[]
  anchors: LabelAnchor[]
  height: number
  radius: number
  center: THREE.Vector3
}

// ---------------------------------------------------------------- 尺寸

const TRUNK_H = 1.6
const TRUNK_R0 = 0.185
const TRUNK_R1 = 0.085

const LEAF_MAX = 9000
const UP = new THREE.Vector3(0, 1, 0)

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const deg = (d: number) => (d * Math.PI) / 180

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// ---------------------------------------------------------------- 曲线

/** 主干：笔直微弧。x 恒为 0，左右镜像才不会被"歪一下"破坏。 */
function makeTrunk(): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0.52, 0.012),
      new THREE.Vector3(0, 1.22, -0.012),
      new THREE.Vector3(0, TRUNK_H, 0.004),
    ],
    false,
    'catmullrom',
    0.5,
  )
}

/** 方位角（相对竖直）→ 单位方向。side 决定左右，zDrift 给树冠一点前后厚度。 */
function dirFromAngle(angle: number, side: -1 | 0 | 1, zDrift: number): THREE.Vector3 {
  return new THREE.Vector3(side * Math.sin(angle), Math.cos(angle), zDrift).normalize()
}

/** 绕 z 轴旋转，用于让子枝相对父枝张开 20°-30°。 */
function rotateZ(v: THREE.Vector3, angle: number): THREE.Vector3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return new THREE.Vector3(v.x * c - v.y * s, v.x * s + v.y * c, v.z)
}

/**
 * 一根自然枝：起点沿 dir 出发，越往末梢越向上翘。
 * 用方向插值 + 弧长累加，CatmullRom 只负责把采样点磨圆，不会出现折线。
 */
function makeBentCurve(
  start: THREE.Vector3,
  dir0: THREE.Vector3,
  length: number,
  bend: number,
): THREE.CatmullRomCurve3 {
  const d0 = dir0.clone().normalize()
  const tip = d0.clone().addScaledVector(UP, bend)
  if (tip.lengthSq() < 1e-6) tip.copy(UP)
  tip.normalize()
  if (tip.y < 0.1) {
    tip.y = 0.1
    tip.normalize()
  }

  const points: THREE.Vector3[] = [start.clone()]
  const p = start.clone()
  const steps = 6
  for (let i = 1; i <= steps; i++) {
    const f = i / steps
    const w = f * f * (3 - 2 * f)
    const d = d0.clone().lerp(tip, w).normalize()
    p.addScaledVector(d, length / steps)
    points.push(p.clone())
  }
  return new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5)
}

// ---------------------------------------------------------------- 骨架

interface BuildCtx {
  branches: BranchNode[]
  twigs: TwigNode[]
  leaves: LeafVisual[]
  anchors: LabelAnchor[]
}

function pushBranch(
  ctx: BuildCtx,
  node: TreeNode,
  depth: number,
  curve: THREE.CatmullRomCurve3,
  r0: number,
  r1: number,
  length: number,
  side: -1 | 0 | 1,
  labelT: number,
  labelSpan: number,
  labelSide: 1 | -1 = 1,
): void {
  ctx.branches.push({
    id: node.id,
    depth,
    curve,
    r0,
    r1,
    length,
    side,
    labelT,
    labelSpan,
    labelSide,
    labeled: true,
    labelRank: Math.min(depth, 3),
  })

  if (depth === 0) return
  const t = clamp(labelT, 0.05, 0.95)
  ctx.anchors.push({
    id: node.id,
    depth,
    point: curve.getPointAt(t),
    radius: r0 + (r1 - r0) * t,
  })
}

/** 在枝的中后段分出两根装饰细梢，让枝头像"分叉"而不是"一根棍插着叶子"。 */
function addTwigs(ctx: BuildCtx, branch: BranchNode, hasKids: boolean, r1: number): void {
  if (branch.depth < 1) return

  const defs: [number, number, number][] = hasKids
    ? [[0.94, 0.34, 1]]
    : [
        [0.66, 0.42, 1],
        [0.86, 0.32, -1],
      ]

  for (const [t, lenBase, dirSign] of defs) {
    const p = branch.curve.getPointAt(t)
    const tan = branch.curve.getTangentAt(t).normalize()
    const rot = branch.side === 0 ? dirSign * 0.5 : branch.side * dirSign * 0.5
    const dir = rotateZ(tan, rot)
    dir.z += 0.03
    dir.normalize()
    if (dir.y < 0.16) {
      dir.y = 0.16
      dir.normalize()
    }

    const len = lenBase * clamp(branch.length / 2.4, 0.55, 1.1)
    ctx.twigs.push({
      curve: makeBentCurve(p, dir, len, 0.28),
      r0: Math.max(r1 * 0.72, 0.005),
      r1: 0.0024,
      side: branch.side,
      source: branch.side <= 0,
    })
  }
}

/**
 * 沿父枝分出子枝。
 *
 * 左右两侧用同一个 sigma 序列，但旋转角乘 side：
 * 左侧转 -sigmaδ、右侧转 +sigmaδ，于是两边在世界上正好互为镜像。
 * 中轴枝（side = 0）按"成对"分配，奇数的最后一个直接长在正中。
 */
function growChildren(
  node: TreeNode,
  depth: number,
  parentCurve: THREE.CatmullRomCurve3,
  pr0: number,
  pr1: number,
  side: -1 | 0 | 1,
  parentLen: number,
  ctx: BuildCtx,
): void {
  const kids = node.children
  const k = kids.length
  const spread = depth === 1 ? deg(25) : deg(22)

  for (let j = 0; j < k; j++) {
    const child = kids[j]
    let t: number
    let sigma: number

    if (side === 0) {
      const pairs = Math.max(1, Math.ceil(k / 2))
      if (k % 2 === 1 && j === k - 1) {
        t = 0.88
        sigma = 0
      } else {
        const pair = Math.floor(j / 2)
        t = 0.34 + (0.42 * (pair + 0.5)) / pairs
        sigma = j % 2 === 0 ? -1 : 1
      }
    } else {
      t = 0.32 + (0.52 * (j + 0.5)) / Math.max(1, k)
      sigma = j % 2 === 0 ? 1 : -1
    }

    const p = parentCurve.getPointAt(t)
    const tan = parentCurve.getTangentAt(t).normalize()
    const rot = side === 0 ? sigma * spread : side * sigma * spread
    const dir = rotateZ(tan, rot)
    // 左右两侧做同样的前后错位，镜像不被破坏，侧看却有厚度
    dir.z += side === 0 ? 0.04 : j % 2 === 0 ? 0.075 : -0.055
    dir.normalize()
    if (dir.y < 0.14) {
      dir.y = 0.14
      dir.normalize()
    }

    const parentR = pr0 + (pr1 - pr0) * t
    const start = p.clone().addScaledVector(tan, -parentR * 0.55)

    const f = k > 1 ? j / (k - 1) : 0
    const lenBase =
      depth === 1 ? 1.08 - 0.24 * f : Math.max(0.5, 0.86 - 0.2 * f)
    const len = lenBase * clamp(parentLen / 2.4, 0.62, 1.12)
    const r0 = depth === 1 ? 0.026 - 0.004 * f : Math.max(0.0045, 0.012 - 0.002 * f)
    const r1 = depth === 1 ? 0.0088 : Math.max(0.0024, r0 * 0.38)

    const curve = makeBentCurve(start, dir, len, 0.68)
    // 知识点名字挂在枝梢外侧；相邻两根上下错开，牌子才不叠在一起
    const labelT = 0.9
    const labelSpan = 0.14
    const labelSide: 1 | -1 = j % 2 === 0 ? 1 : -1

    pushBranch(ctx, child, depth + 1, curve, r0, r1, len, side, labelT, labelSpan, labelSide)

    const branch = ctx.branches[ctx.branches.length - 1]
    growChildren(child, depth + 1, curve, r0, r1, side, len, ctx)
    addTwigs(ctx, branch, child.children.length > 0, r1)
  }
}

// ---------------------------------------------------------------- 叶片

function randomQuat(rng: () => number): THREE.Quaternion {
  const axis = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1)
  if (axis.lengthSq() < 1e-5) axis.set(1, 0, 0)
  axis.normalize()
  const q = new THREE.Quaternion().setFromAxisAngle(axis, rng() * Math.PI * 2)
  q.multiply(
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (rng() - 0.5) * 1.2),
  )
  return q
}

/** 叶子要主动避开"贴名字"的位置，否则名字会被叶簇埋掉。 */
function clearOfLabels(p: THREE.Vector3, ctx: BuildCtx): boolean {
  for (const a of ctx.anchors) {
    const r = a.depth === 1 ? 0.26 : a.depth === 2 ? 0.09 : 0.08
    if (p.distanceToSquared(a.point) < r * r) return false
    // 名字通常贴在枝的上方，再单独给上方留一个球
    const up = a.point.y + 0.2
    const dx = p.x - a.point.x
    const dy = p.y - up
    const dz = p.z - a.point.z
    const ru = r * 0.75
    if (dx * dx + dy * dy + dz * dz < ru * ru) return false
  }
  return true
}

function leafCluster(
  center: THREE.Vector3,
  radius: number,
  count: number,
  rng: () => number,
  ctx: BuildCtx,
  height: number,
  toneBias: number,
): void {
  for (let i = 0; i < count; i++) {
    if (ctx.leaves.length >= LEAF_MAX) return

    const u = rng() * 2 - 1
    const phi = rng() * Math.PI * 2
    const r = Math.cbrt(rng()) * radius
    const s = Math.sqrt(Math.max(0, 1 - u * u))
    const pos = center
      .clone()
      .add(new THREE.Vector3(s * Math.cos(phi) * r, u * r * 0.58, s * Math.sin(phi) * r))

    if (!clearOfLabels(pos, ctx)) continue

    ctx.leaves.push({
      pos,
      size: 0.78 + rng() * 0.44,
      quat: randomQuat(rng),
      tone: clamp(toneBias + (pos.y / height) * 0.46 + (rng() - 0.5) * 0.18, 0, 1),
    })
  }
}

function decorateBranch(branch: BranchNode, node: TreeNode, ctx: BuildCtx, height: number): void {
  // 只给左半和中轴长叶子，右半最后整体镜像，冠形才会严格对称
  if (branch.side > 0) return

  const rng = mulberry32(hashSeed(node.id + ':leaf'))

  if (branch.depth === 0) {
    leafCluster(branch.curve.getPointAt(0.84).add(new THREE.Vector3(0, 0.12, 0)), 0.2, 10, rng, ctx, height, 0.28)
    leafCluster(branch.curve.getPointAt(0.94).add(new THREE.Vector3(0, 0.14, 0)), 0.24, 12, rng, ctx, height, 0.32)
    return
  }

  if (branch.depth === 1) {
    if (node.children.length === 0) return
    const bands: [number, number, number, number][] = [
      [0.26, 0.15, 9, 0.1],
      [0.44, 0.19, 12, 0.12],
      [0.62, 0.21, 14, 0.12],
      [0.8, 0.22, 14, 0.1],
    ]
    for (const [t, r, n, dy] of bands) {
      const c = branch.curve.getPointAt(t).add(new THREE.Vector3(0, dy, 0))
      leafCluster(c, r, n, rng, ctx, height, 0.14 + t * 0.12)
    }
    return
  }

  // 知识点小枝：叶团集中在中后段与枝头，形成"冠"，但枝干仍露得出来
  const bands: [number, number, number, number][] =
    node.children.length > 0
      ? [
          [0.4, 0.16, 10, 0.08],
          [0.62, 0.18, 13, 0.08],
          [0.84, 0.19, 14, 0.07],
        ]
      : [
          [0.34, 0.16, 11, 0.08],
          [0.54, 0.18, 14, 0.08],
          [0.74, 0.2, 16, 0.08],
          [0.94, 0.21, 18, 0.06],
        ]

  for (const [t, r, n, dy] of bands) {
    const c = branch.curve.getPointAt(t).add(new THREE.Vector3(0, dy, 0))
    leafCluster(c, r, n, rng, ctx, height, 0.16 + t * 0.14)
  }
}

function decorateFiller(branch: BranchNode, ctx: BuildCtx, height: number, seed: number): void {
  if (branch.side > 0) return
  const rng = mulberry32(seed)
  const bands: [number, number, number][] = [
    [0.28, 0.18, 12],
    [0.52, 0.2, 14],
    [0.76, 0.21, 16],
    [0.95, 0.22, 16],
  ]
  for (const [t, r, n] of bands) {
    const c = branch.curve.getPointAt(t).add(new THREE.Vector3(0, 0.08, 0))
    leafCluster(c, r, n, rng, ctx, height, 0.13 + t * 0.13)
  }
}

function decorateTwig(twig: TwigNode, ctx: BuildCtx, height: number, seed: number): void {
  if (!twig.source) return
  const rng = mulberry32(seed)
  const mid = twig.curve.getPointAt(0.72).add(new THREE.Vector3(0, 0.04, 0))
  leafCluster(mid, 0.15, 11, rng, ctx, height, 0.2)
  const tip = twig.curve.getPointAt(1).add(new THREE.Vector3(0, 0.03, 0))
  leafCluster(tip, 0.19, 13, rng, ctx, height, 0.24)
}

// ---------------------------------------------------------------- 组装

function computeBounds(branches: BranchNode[], twigs: TwigNode[]): THREE.Box3 {
  const box = new THREE.Box3()
  const tmp = new THREE.Vector3()
  for (const b of branches) {
    for (let i = 0; i <= 8; i++) {
      b.curve.getPointAt(i / 8, tmp)
      box.expandByPoint(tmp)
    }
  }
  for (const t of twigs) {
    for (let i = 0; i <= 2; i++) {
      t.curve.getPointAt(i / 2, tmp)
      box.expandByPoint(tmp)
    }
  }
  return box
}

export function buildTreeShape(root: TreeNode): TreeShape {
  const ctx: BuildCtx = { branches: [], twigs: [], leaves: [], anchors: [] }
  const trunk = makeTrunk()

  pushBranch(ctx, root, 0, trunk, TRUNK_R0, TRUNK_R1, TRUNK_H, 0, 0, 0)

  const chapters = root.children
  const pairCount = Math.floor(chapters.length / 2)
  const hasCenter = chapters.length % 2 === 1

  // 章枝成对出现在同一高度：低位枝长而平，高位枝短而陡，冠形自然上收
  for (let k = 0; k < pairCount; k++) {
    const f = pairCount > 1 ? k / (pairCount - 1) : 0
    const heightT = 0.38 + 0.26 * f
    const angle = deg(40 - 8 * f)
    const len = 2.55 - 0.4 * f
    const zDrift = 0.05
    const r0 = 0.086 - 0.008 * f
    const r1 = 0.024

    for (const side of [-1, 1] as const) {
      const node = chapters[k * 2 + (side === -1 ? 0 : 1)]
      if (!node) continue
      const base = trunk.getPointAt(heightT)
      const dir0 = dirFromAngle(angle, side, zDrift)
      const start = base.clone().addScaledVector(dir0, -0.02)
      const curve = makeBentCurve(start, dir0, len, 0.8)
      // 章名挂在枝的基部侧面，离开中轴，避免五块牌子挤在树心
      const labelT = 0.28
      const labelSpan = 0.1

      pushBranch(ctx, node, 1, curve, r0, r1, len, side, labelT, labelSpan, 1)
      const branch = ctx.branches[ctx.branches.length - 1]
      growChildren(node, 1, curve, r0, r1, side, len, ctx)
      addTwigs(ctx, branch, node.children.length > 0, r1)
    }
  }

  // 奇数个章时，最后一章长在中轴顶端，作为整棵树的顶梢
  if (hasCenter) {
    const node = chapters[chapters.length - 1]
    const base = trunk.getPointAt(0.87)
    const dir0 = new THREE.Vector3(0, 1, 0.03).normalize()
    const start = base.clone().addScaledVector(dir0, -0.05)
    const len = 1.62
    const r0 = 0.05
    const r1 = 0.018
    const curve = makeBentCurve(start, dir0, len, 0.05)

    pushBranch(ctx, node, 1, curve, r0, r1, len, 0, 0.2, 0.1, 1)
    const branch = ctx.branches[ctx.branches.length - 1]
    growChildren(node, 1, curve, r0, r1, 0, len, ctx)
    addTwigs(ctx, branch, node.children.length > 0, r1)
  } else {
    // 没有中轴章时，给主干顶留一根短顶梢，树不会平头
    const top = trunk.getPointAt(0.98)
    const leader = makeBentCurve(top, new THREE.Vector3(0, 1, 0.02), 0.55, 0.08)
    ctx.twigs.push({ curve: leader, r0: 0.052, r1: 0.012, side: 0, source: true })
  }

  // 后层装饰枝：不挂节点，只把树冠从"一块纸板"撑成有厚度的冠。
  // 左右成对、前后同号，所以整体仍然关于 x = 0 镜像。
  const fillers: [number, number, number, number, number][] = [
    [0.42, 50, 2.25, -0.62, 0.055],
    [0.54, 60, 1.55, -0.28, 0.05],
    [0.66, 36, 1.65, -0.5, 0.042],
    [0.74, 46, 1.45, -0.3, 0.038],
  ]
  for (let fi = 0; fi < fillers.length; fi++) {
    const [heightT, ang, len, z, r0] = fillers[fi]
    for (const side of [-1, 1] as const) {
      const base = trunk.getPointAt(heightT)
      const dir0 = dirFromAngle(deg(ang), side, z)
      const curve = makeBentCurve(base, dir0, len, 0.75)
      ctx.branches.push({
        id: `__filler_${fi}_${side}`,
        depth: 1,
        curve,
        r0,
        r1: 0.009,
        length: len,
        side,
        labelT: 0,
        labelSpan: 0,
        labelSide: 1,
        labeled: false,
        labelRank: 1,
      })
    }
  }

  // 叶子生成前先量骨架高度：叶片色阶需要它做归一化
  const skeletonBox = computeBounds(ctx.branches, ctx.twigs)
  const skeletonHeight = Math.max(skeletonBox.max.y, 1.5)

  const byId = new Map<string, TreeNode>()
  const walk = (n: TreeNode) => {
    byId.set(n.id, n)
    for (const c of n.children) walk(c)
  }
  walk(root)

  let fillerSeed = 4117
  for (const branch of ctx.branches) {
    const node = byId.get(branch.id)
    if (node) {
      decorateBranch(branch, node, ctx, skeletonHeight)
    } else if (!branch.labeled) {
      decorateFiller(branch, ctx, skeletonHeight, (fillerSeed = (fillerSeed * 1664525 + 1013904223) >>> 0))
    }
  }

  let twigSeed = 9173
  for (const twig of ctx.twigs) {
    decorateTwig(twig, ctx, skeletonHeight, (twigSeed = (twigSeed * 1664525 + 1013904223) >>> 0))
  }

  // ---- 镜像：左半 + 中轴的叶子全部翻到右半 ----
  const mirrorSource = ctx.leaves.slice()
  for (const leaf of mirrorSource) {
    if (Math.abs(leaf.pos.x) < 0.02) continue
    ctx.leaves.push({
      pos: new THREE.Vector3(-leaf.pos.x, leaf.pos.y, leaf.pos.z),
      size: leaf.size,
      quat: new THREE.Quaternion(leaf.quat.x, -leaf.quat.y, -leaf.quat.z, leaf.quat.w),
      tone: leaf.tone,
    })
  }

  // ---- 冠形收束：把叶子限制在一个左右对称的卵圆里 ----
  const crownBox = new THREE.Box3()
  for (const b of ctx.branches) {
    for (let i = 0; i <= 6; i++) crownBox.expandByPoint(b.curve.getPointAt(i / 6))
  }

  let maxX = 0.6
  for (const l of ctx.leaves) maxX = Math.max(maxX, Math.abs(l.pos.x))
  const top = Math.max(crownBox.max.y + 0.38, maxX * 1.08)
  const bottom = Math.max(0.9, top * 0.32)
  const cy = (top + bottom) * 0.5
  const ry = Math.max(0.8, (top - bottom) * 0.5)
  const rx = Math.max(1.1, maxX * 1.02)

  for (const leaf of ctx.leaves) {
    const ex = Math.abs(leaf.pos.x) / rx
    const ey = (leaf.pos.y - cy) / ry
    const d = ex * ex + ey * ey
    if (d > 1) {
      const s = 1 / Math.sqrt(d)
      leaf.pos.x *= s
      leaf.pos.y = cy + (leaf.pos.y - cy) * s
    }
    leaf.pos.z = clamp(leaf.pos.z, -0.95, 0.95)
  }

  // ---- 最终包围盒 ----
  const box = computeBounds(ctx.branches, ctx.twigs)
  let radius = 0.5
  const tmp = new THREE.Vector3()
  for (const b of ctx.branches) {
    for (let i = 0; i <= 8; i++) {
      b.curve.getPointAt(i / 8, tmp)
      box.expandByPoint(tmp)
      radius = Math.max(radius, Math.hypot(tmp.x, tmp.z))
    }
  }
  for (const t of ctx.twigs) {
    t.curve.getPointAt(1, tmp)
    box.expandByPoint(tmp)
    radius = Math.max(radius, Math.hypot(tmp.x, tmp.z))
  }
  for (const l of ctx.leaves) {
    box.expandByPoint(l.pos)
    radius = Math.max(radius, Math.hypot(l.pos.x, l.pos.z))
  }

  const height = Math.max(box.max.y, 1)

  return {
    branches: ctx.branches,
    twigs: ctx.twigs,
    leaves: ctx.leaves,
    anchors: ctx.anchors,
    height,
    radius,
    center: new THREE.Vector3(0, height * 0.5, 0),
  }
}

/** 上粗下细的管状枝干。TubeGeometry 的 uv.x 就是沿曲线的参数，按它缩放半径。 */
export function createTaperedTube(
  curve: THREE.CatmullRomCurve3,
  r0: number,
  r1: number,
  tubular = 10,
  radial = 7,
): THREE.BufferGeometry {
  const geo = new THREE.TubeGeometry(curve, tubular, 1, radial, false)
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute
  const center = new THREE.Vector3()
  const v = new THREE.Vector3()

  for (let i = 0; i < pos.count; i++) {
    const t = clamp(uv.getX(i), 0, 1)
    curve.getPointAt(t, center)
    v.fromBufferAttribute(pos, i).sub(center)
    const r = r0 + (r1 - r0) * t
    v.multiplyScalar(r).add(center)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}
