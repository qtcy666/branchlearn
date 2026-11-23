import * as THREE from 'three'
import type { TreeNode } from '../types/tree'

/** 一根枝（对应一个知识节点）。 */
export interface BranchVisual {
  id: string
  depth: number
  curve: THREE.CatmullRomCurve3
  r0: number
  r1: number
  /** 标签锚点（枝中心线上一点）与枝的走向。 */
  labelPoint: THREE.Vector3
  labelTangent: THREE.Vector3
}

/** 不带名字的末梢细枝，只负责让枝头看起来是树。 */
export interface TwigVisual {
  curve: THREE.CatmullRomCurve3
  r0: number
  r1: number
}

/** 一片叶子：位置、尺寸、朝向、色阶（0 = 亮黄绿，1 = 深墨绿）。 */
export interface LeafVisual {
  pos: THREE.Vector3
  size: number
  quat: THREE.Quaternion
  tone: number
}

export interface TreeLayoutData {
  branches: BranchVisual[]
  twigs: TwigVisual[]
  leaves: LeafVisual[]
  height: number
  radius: number
  /** 树冠中心（世界坐标），用于取景与标签布局。 */
  center: THREE.Vector3
}

/** 每一层的起始半径。层级越深越细。 */
export const BRANCH_R0: Record<number, number> = {
  0: 0.078,
  1: 0.044,
  2: 0.034,
  3: 0.024,
  4: 0.017,
  5: 0.012,
}

/** 每一层的枝长：主干略长、一级枝最长，之后逐层收短。 */
export const BRANCH_LEN: Record<number, number> = {
  0: 1.0,
  1: 1.75,
  2: 1.0,
  3: 0.7,
  4: 0.5,
  5: 0.38,
}

export function radiusForDepth(depth: number): number {
  if (BRANCH_R0[depth] !== undefined) return BRANCH_R0[depth]
  return BRANCH_R0[5] * Math.pow(0.66, depth - 5)
}

export function lengthForDepth(depth: number): number {
  if (BRANCH_LEN[depth] !== undefined) return BRANCH_LEN[depth]
  return BRANCH_LEN[5] * Math.pow(0.78, depth - 5)
}

function hashSeed(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function perpendicular(dir: THREE.Vector3, roll: number): THREE.Vector3 {
  const axis = Math.abs(dir.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const side = new THREE.Vector3().crossVectors(dir, axis).normalize()
  const up = new THREE.Vector3().crossVectors(side, dir).normalize()
  return side.multiplyScalar(Math.cos(roll)).add(up.multiplyScalar(Math.sin(roll))).normalize()
}

/**
 * 从起点沿 dir 生长一段自然弯曲的枝。
 * 弯曲克制，保证每根枝的走向一眼可读；末梢枝略向下垂，像真实树冠的外缘。
 */
function growCurve(
  start: THREE.Vector3,
  dir: THREE.Vector3,
  length: number,
  depth: number,
  rng: () => number,
): THREE.CatmullRomCurve3 {
  const steps = 5
  const points: THREE.Vector3[] = [start.clone()]
  let p = start.clone()
  let d = dir.clone().normalize()
  const wander = depth === 0 ? 0.13 : 0.09 + depth * 0.006
  // 越深的枝越接近水平，末梢轻微下垂：树冠外缘自然回落
  const upBias = depth === 0 ? 0.08 : depth <= 2 ? 0.05 : -0.01 + depth * 0.004

  for (let i = 1; i <= steps; i++) {
    const roll = rng() * Math.PI * 2
    const tilt = (rng() - 0.5) * wander * 2
    const side = perpendicular(d, roll)
    d = d.clone().addScaledVector(side, tilt)
    d.y += upBias * (1 - i / (steps + 2))
    d.normalize()
    p = p.clone().addScaledVector(d, length / steps)
    points.push(p)
  }

  return new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5)
}

/** 叶片朝向：大致朝外、朝上，带随机翻滚。 */
function leafQuaternion(out: THREE.Vector3, rng: () => number): THREE.Quaternion {
  const yaw = rng() * Math.PI * 2
  const tilt = (rng() - 0.5) * 0.9
  const spin = rng() * Math.PI * 2
  const q = new THREE.Quaternion()
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
  const qt = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw)),
    tilt,
  )
  const qs = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), spin)
  q.copy(qy).multiply(qt).multiply(qs)
  void out
  return q
}

/**
 * 全局叶密度。
 *
 * 0.62 不是随手调的：枝上要烙名字，叶子太密会把枝干整个盖住，
 * 名字就永远藏在树冠里。降到六成之后枝干结构露出来，树冠仍有体积。
 */
const LEAF_DENSITY = 0.62

/**
 * 叶簇：在枝的末段周围撒一圈叶片，形成有体积、有缺口的树冠，
 * 而不是一颗颗实心小球。
 */
function scatterLeaves(
  curve: THREE.CatmullRomCurve3,
  length: number,
  rng: () => number,
  leaves: LeafVisual[],
  from = 0.3,
  count = 26,
): void {
  const center = new THREE.Vector3()
  const tan = new THREE.Vector3()
  const radial = new THREE.Vector3()

  const total = Math.max(1, Math.round(count * LEAF_DENSITY))
  for (let k = 0; k < total; k++) {
    const t = from + (1 - from) * (k / total) + (rng() - 0.5) * 0.04
    curve.getPointAt(THREE.MathUtils.clamp(t, 0, 1), center)
    curve.getTangentAt(THREE.MathUtils.clamp(t, 0, 1), tan).normalize()

    // 叶簇整体像一团蓬松的云：靠外的枝撒得更开
    const spread = (0.05 + rng() * 0.12) * (0.75 + (t - from) * 0.8)
    const roll = rng() * Math.PI * 2
    radial.copy(perpendicular(tan, roll))
    const pos = center
      .clone()
      .addScaledVector(radial, spread)
      .addScaledVector(tan, (rng() - 0.5) * length * 0.1)
    pos.y += (rng() - 0.5) * 0.1

    leaves.push({
      pos,
      size: 0.056 + rng() * 0.034,
      quat: leafQuaternion(tan, rng),
      tone: rng(),
    })
  }
}

/** 叶团簇：树冠由一簇簇叶子叠出来，簇间留空隙，轮廓才像真树。 */
function scatterLeafCloud(
  center: THREE.Vector3,
  radius: number,
  count: number,
  rng: () => number,
  leaves: LeafVisual[],
): void {
  const clusters = Math.max(2, Math.round(count / 30))
  const perCluster = Math.max(1, Math.ceil((count * LEAF_DENSITY) / clusters))

  for (let c = 0; c < clusters; c++) {
    const u = rng() * 2 - 1
    const phi = rng() * Math.PI * 2
    const s = Math.sqrt(Math.max(0, 1 - u * u))
    const spread = radius * 0.72 * Math.cbrt(rng())
    const cc = center
      .clone()
      .add(new THREE.Vector3(s * Math.cos(phi), u * 0.85, s * Math.sin(phi)).multiplyScalar(spread))
    const clusterR = radius * (0.26 + rng() * 0.14)

    for (let i = 0; i < perCluster; i++) {
      const v = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1)
      if (v.lengthSq() < 1e-6) v.set(0, 1, 0)
      v.normalize()
      leaves.push({
        pos: cc.clone().addScaledVector(v, clusterR * Math.cbrt(rng())),
        size: 0.062 + rng() * 0.036,
        quat: leafQuaternion(v, rng),
        // 冠外沿偏亮、冠内偏深，叶子才有体积
        tone: THREE.MathUtils.clamp(0.3 + (spread / radius) * 0.45 + (rng() - 0.5) * 0.45, 0, 1),
      })
    }
  }
}

/** 装饰枝：不带语义的过渡枝，把稀疏的节点枝补成自然的枝网。 */
function addDecorativeTwigs(
  curve: THREE.CatmullRomCurve3,
  length: number,
  r1: number,
  depth: number,
  rng: () => number,
  twigs: TwigVisual[],
  leaves: LeafVisual[],
): void {
  const n = depth === 0 ? 2 : depth === 1 ? 5 : 2
  for (let i = 0; i < n; i++) {
    const t = THREE.MathUtils.clamp(0.4 + (0.48 * (i + 0.5)) / n + (rng() - 0.5) * 0.05, 0.32, 0.92)
    const base = curve.getPointAt(t)
    const tan = curve.getTangentAt(t).normalize()
    const roll = rng() * Math.PI * 2
    // 侧向外展为主、略向上翘，长得像树枝而不是刺
    const dir = tan.clone().multiplyScalar(0.48).add(perpendicular(tan, roll).multiplyScalar(0.78))
    dir.y += 0.24
    dir.normalize()

    const len = length * (0.28 + rng() * 0.16)
    const tw = growCurve(base, dir, len, depth + 1, rng)
    twigs.push({
      curve: tw,
      r0: Math.max(r1 * 0.42, 0.006),
      r1: Math.max(r1 * 0.12, 0.002),
    })
    scatterLeaves(tw, len, rng, leaves, 0.28, 16)
    scatterLeafCloud(tw.getPointAt(1), 0.22, 56, rng, leaves)
  }
}

/** 末级枝头补几根短细枝：不递归、不覆盖主枝，只让枝头不是一根光杆。 */
function addTipTwigs(
  curve: THREE.CatmullRomCurve3,
  length: number,
  r1: number,
  depth: number,
  rng: () => number,
  state: TwigVisual[],
  leaves: LeafVisual[],
): void {
  for (let i = 0; i < 3; i++) {
    const t = THREE.MathUtils.clamp(0.5 + 0.16 * i + (rng() - 0.5) * 0.05, 0.4, 0.94)
    const base = curve.getPointAt(t)
    const tan = curve.getTangentAt(t).normalize()
    const roll = (i / 3) * Math.PI * 2 + rng() * 0.7
    const dir = tan.clone().multiplyScalar(0.6).add(perpendicular(tan, roll).multiplyScalar(0.6))
    dir.y += 0.1
    dir.normalize()

    const twigCurve = growCurve(base, dir, length * (0.16 + rng() * 0.06), depth + 1, rng)
    state.push({
      curve: twigCurve,
      r0: Math.max(r1 * 0.5, 0.006),
      r1: Math.max(r1 * 0.2, 0.0025),
    })
    // 细枝本身就是叶子的载体
    scatterLeaves(twigCurve, length * 0.25, rng, leaves, 0.12, 16)
  }
}

function growNode(
  node: TreeNode,
  depth: number,
  start: THREE.Vector3,
  dir: THREE.Vector3,
  length: number,
  r0: number,
  branches: BranchVisual[],
  twigs: TwigVisual[],
  leaves: LeafVisual[],
): void {
  const rng = mulberry32(hashSeed(node.id + ':' + depth))
  const curve = growCurve(start, dir, length, depth, rng)
  const r1 = Math.max(r0 * 0.42, 0.006)

  // 有子枝时，名字放在分叉点之前，避免文字压在分叉口
  const labelT = node.children.length > 0 ? 0.34 : 0.3
  const labelPoint = curve.getPointAt(labelT)
  const labelTangent = curve.getTangentAt(labelT).normalize()

  branches.push({ id: node.id, depth, curve, r0, r1, labelPoint, labelTangent })

  const children = node.children
  const n = children.length

  if (n === 0) {
    addTipTwigs(curve, length, r1, depth, rng, twigs, leaves)
    scatterLeaves(curve, length, rng, leaves, 0.26, 60)
    // 枝头一团叶云，冠形由这些云团叠出来
    scatterLeafCloud(curve.getPointAt(1), 0.34, 110, rng, leaves)
    return
  }

  for (let i = 0; i < n; i++) {
    const child = children[i]
    const frac = n === 1 ? 0.5 : i / (n - 1)

    // 分叉点沿主干拉开，枝不挤在同一高度，观感才不是三叉戟
    const tBase = depth === 0 ? 0.38 + 0.54 * frac : 0.3 + 0.58 * ((i + 0.5) / n)
    const t = THREE.MathUtils.clamp(tBase + (rng() - 0.5) * 0.04, 0.26, 0.94)
    const tan = curve.getTangentAt(t).normalize()

    // 方位角均匀环绕 + 层间错位，避免枝条在上视方向重叠
    const roll =
      (i / Math.max(n, 1)) * Math.PI * 2 + depth * 1.35 + i * 0.62 + (rng() - 0.5) * 0.3
    const side = perpendicular(tan, roll)

    // 分叉角：冠身外张、冠顶收口，越深越收拢
    const angleDeg =
      depth === 0
        ? 62 - 16 * frac + rng() * 4
        : depth === 1
          ? 40 - 8 * frac + rng() * 4
          : depth === 2
            ? 34 - 6 * frac + rng() * 4
            : 27 + rng() * 4
    const angle = (angleDeg * Math.PI) / 180

    const childDir = tan
      .clone()
      .multiplyScalar(Math.cos(angle))
      .add(side.multiplyScalar(Math.sin(angle)))
      .normalize()

    // 长度按冠形轮廓走：冠身中段最长，冠底冠顶略短，整体是饱满的卵形
    const profile =
      depth === 0 ? 0.82 + 0.4 * Math.sin(Math.PI * (0.2 + 0.65 * frac)) : 1
    const childLen = lengthForDepth(depth + 1) * profile * (0.95 + rng() * 0.1)
    const childR0 = radiusForDepth(depth + 1)

    const origin = curve.getPointAt(t).addScaledVector(childDir, Math.max(r1 * 0.5, 0.01))

    growNode(child, depth + 1, origin, childDir, childLen, childR0, branches, twigs, leaves)
  }

  // 内部节点也在枝身挂少量叶片，树冠内部不至于空心
  if (depth >= 2) scatterLeaves(curve, length, rng, leaves, 0.5, 10)
  // 主干与一级枝的枝端也要有叶，否则顶端是断头枯枝
  if (depth <= 2) addDecorativeTwigs(curve, length, r1, depth, rng, twigs, leaves)
  if (depth === 0) scatterLeaves(curve, length, rng, leaves, 0.4, 60)
  if (depth === 1) scatterLeaves(curve, length, rng, leaves, 0.2, 70)
}

export function buildTreeLayout(root: TreeNode): TreeLayoutData {
  const branches: BranchVisual[] = []
  const twigs: TwigVisual[] = []
  const leaves: LeafVisual[] = []
  growNode(
    root,
    0,
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 1, 0),
    BRANCH_LEN[0],
    BRANCH_R0[0],
    branches,
    twigs,
    leaves,
  )

  // 冠层叶团：在椭球体积内均匀铺开，保证冠形饱满、不裂成几团
  const box = new THREE.Box3()
  const tmp = new THREE.Vector3()
  let radius = 0.5
  const expand = (curve: THREE.CatmullRomCurve3, steps: number) => {
    for (let i = 0; i <= steps; i++) {
      curve.getPointAt(i / steps, tmp)
      box.expandByPoint(tmp)
      radius = Math.max(radius, Math.hypot(tmp.x, tmp.z))
    }
  }
  for (const b of branches) expand(b.curve, 10)
  for (const t of twigs) expand(t.curve, 4)
  for (const leaf of leaves) {
    box.expandByPoint(leaf.pos)
    radius = Math.max(radius, Math.hypot(leaf.pos.x, leaf.pos.z))
  }

  const height = Math.max(box.max.y, 1)

  // 冠层叶团：中心一律落在枝上，冠饱满但不会出现悬空的叶子
  const crownRng = mulberry32(hashSeed(root.id + ':crown'))
  for (const b of branches) {
    if (b.depth < 1) continue
    const perBranch = b.depth === 1 ? 5 : b.depth === 2 ? 4 : 3
    for (let i = 0; i < perBranch; i++) {
      const t = THREE.MathUtils.clamp(0.18 + (0.84 * (i + 0.5)) / perBranch, 0.14, 1)
      scatterLeafCloud(
        b.curve.getPointAt(t),
        0.34 + crownRng() * 0.14,
        88,
        crownRng,
        leaves,
      )
    }
    // 枝尖补团：不加的话，向上伸的枝会像天线一样戳出树冠
    scatterLeafCloud(b.curve.getPointAt(1), 0.33, 72, crownRng, leaves)
    if (b.depth >= 2) scatterLeafCloud(b.curve.getPointAt(0.86), 0.28, 44, crownRng, leaves)
  }

  for (const t of twigs) {
    scatterLeafCloud(t.curve.getPointAt(1), 0.2, 34, crownRng, leaves)
  }

  return {
    branches,
    twigs,
    leaves,
    height,
    radius,
    center: new THREE.Vector3(0, height * 0.52, 0),
  }
}

/** 生成一根上粗下细的管状枝干几何。 */
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
    const t = THREE.MathUtils.clamp(uv.getX(i), 0, 1)
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
