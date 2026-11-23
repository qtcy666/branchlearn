import * as THREE from 'three'
import type { TreeNode } from '../types/tree'
import type { BranchNode, LeafVisual, TreeShape } from './tree3dLayout'

/**
 * 3D 知识树骨架 · 变体页（outputs/knowledge-tree-3d-variants.html）的移植版。
 *
 * 为什么要重写一份：旧骨架是"严格镜像的扇形树"，左右对称、每对枝同高同角，
 * 投到屏幕上像一把对称的扇骨。变体页那套是逐枝独立的偏冠生长：
 * 左右各自取挂点、长度、角度、前后位置，只保留"越靠下越外展、越靠上越收"的趋势，
 * 再靠末梢回坠和侧摆把它读成一棵真树。
 *
 * 移植的边界：
 *   · 只搬"枝怎么长、叶怎么结"，不搬数据、不搬 DOM 标签、不搬四风格；
 *   · 输出仍然是产品自己的 TreeShape，所以 Tree3D 的标签层、点击、进度、聚焦全部照旧；
 *   · 数据只有一个来源：树学里那棵真实的 TreeNode，不是变体页里写死的五章。
 *
 * 尺度说明：这套规则按"树高约 9 个世界单位"设计（AXIS_H = 9），
 * 产品的取景、阴影、雾都按 shape.height 自适应，所以不需要换算整棵树；
 * 但产品叶片几何只有 0.116 高，因此 leaf.size 要乘 LEAF_SCALE 才能和枝的尺度匹配。
 */

const UP = new THREE.Vector3(0, 1, 0)
const X_AXIS = new THREE.Vector3(1, 0, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const rad = (d: number) => (d * Math.PI) / 180

/** 写实自然风格：偏冠 1.0，抖动 1.0。其余三风格不进产品。 */
const P = {
  jitter: 1.0,
  // 偏冠收到 0.6：1.0 时左侧几乎空着，五章会挤到右边互相挤掉
  lean: 0.26,
  level: {
    1: { len: 5.6, fork: 46, zOff: 0.7, bend: 0.46, rMul: 0.62, rTip: 0.46, t0: 0.30, t1: 0.92, apexT: 0.985 },
    2: { len: 5.0, fork: 42, zOff: 0.56, bend: 0.12, rMul: 0.9, rTip: 0.72, t0: 0.13, t1: 0.92, apexT: 0.90 },
  },
  trunk: { r0: 0.38, r1: 0.115 },
} as const

const AXIS_H = 9.0
const TRUNK_R0 = P.trunk.r0
const TRUNK_R1 = P.trunk.r1

/** 产品叶片几何高 0.116；变体页 LEAF_L 为 0.42。换算后还要再放大一档：
 *  产品叶形偏窄（2:1），同样面积看着比变体页瘦，靠 1.25 的余量补回冠的饱满度。 */
const LEAF_SCALE = (0.42 / 0.116) * 1.25

/** 固定种子：同一份数据每次进来都长成同一棵树，刷新不会换一棵。 */
let seed = 20261120
function rnd() {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}

function makeBentCurve(start: THREE.Vector3, dir0: THREE.Vector3, length: number, bend: number, lateral = 0) {
  const d0 = dir0.clone().normalize()
  const tip = d0.clone().addScaledVector(UP, bend)
  if (tip.lengthSq() < 1e-6) tip.copy(UP)
  tip.normalize()
  if (tip.y < 0.1) {
    tip.y = 0.1
    tip.normalize()
  }

  // 与枝走向垂直的水平方向，用来做 S 形侧摆
  const perp = new THREE.Vector3(-d0.z, 0, d0.x)
  if (perp.lengthSq() < 1e-6) perp.set(1, 0, 0)
  perp.normalize()

  const pts = [start.clone()]
  const p = start.clone()
  for (let i = 1; i <= 6; i++) {
    const f = i / 6
    const w = f * f * (3 - 2 * f)
    const d = d0.clone().lerp(tip, w).normalize()
    p.addScaledVector(d, length / 6)
    if (lateral) p.addScaledVector(perp, (lateral * (Math.sin(Math.PI * f) * 0.55 + Math.pow(f, 1.7) * 0.85)) / 6)
    // 梢部回坠：没有这一下，粗枝就是一根根直杆
    if (f > 0.58) p.y -= (f - 0.58) * length * 0.13
    pts.push(p.clone())
  }
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5)
}

function subCurve(curve: THREE.CatmullRomCurve3, t0: number, t1: number, n = 12) {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= n; i++) pts.push(curve.getPointAt(t0 + (t1 - t0) * (i / n)))
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5)
}

/** 叶子不许落进名字的通道：每条带名字的枝上留一颗避让球。 */
interface LeafAnchor {
  point: THREE.Vector3
  r: number
}

export function buildTreeShape(root: TreeNode, opts: { leaves?: boolean } = {}): TreeShape {
  seed = 20261120
  const withLeaves = opts.leaves === true
  const branches: BranchNode[] = []
  const leaves: LeafVisual[] = []
  const anchors: LeafAnchor[] = []

  const mainCurve = new THREE.CatmullRomCurve3(
    [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.05, 1.05, 0.05), new THREE.Vector3(0.06, 2.4, -0.04),
     new THREE.Vector3(0.11, 3.6, 0.03), new THREE.Vector3(0.15, 5.2, -0.03), new THREE.Vector3(0.21, AXIS_H, 0.02)],
    false, 'catmullrom', 0.5,
  )
  // 0–0.58 是主干；再往上是中轴主梢，奇数章的最后一章长在那里
  const trunkCurve = subCurve(mainCurve, 0, 0.58)

  branches.push({
    id: root.id,
    depth: 0,
    curve: trunkCurve,
    r0: TRUNK_R0,
    r1: TRUNK_R1,
    length: trunkCurve.getLength(),
    side: 0,
    labelT: 0.5,
    labelSpan: 0,
    labelSide: 1,
    labeled: false,
    labelRank: 0,
  })

  const kidsOf = (n: TreeNode): TreeNode[] => (n.children || []).filter((c) => (c.title || '').trim())

  function sprout(parentCurve: THREE.CatmullRomCurve3, pr0: number, pr1: number, depth: number, kids: TreeNode[]) {
    const n = kids.length
    if (!n) return
    const L = P.level[depth as 1 | 2]
    if (!L) return

    const hasApex = n % 2 === 1
    const mid = (n - 1) / 2
    const pairs = hasApex ? mid : n / 2
    const J = P.jitter

    for (let i = 0; i < pairs; i++) {
      // i = 0 是最外一对（最低），越靠中间越高；挂点带抖动，左右不共用 t
      const base = pairs > 1 ? L.t0 + (L.t1 - L.t0) * (i / (pairs - 1)) : (L.t0 + L.t1) / 2
      const t = clamp(base + (rnd() * 2 - 1) * 0.035 * J, 0.08, 0.95)
      const a = hasApex ? kids[i] : kids[i * 2]
      const b = hasApex ? kids[n - 1 - i] : kids[i * 2 + 1]
      const f = pairs > 1 ? i / (pairs - 1) : 0

      for (const side of [-1, 1] as const) {
        const tSide = clamp(
          t + (rnd() * 2 - 1) * 0.055 * J + side * (rnd() * 2 - 1) * 0.03 * J,
          0.1, 0.94,
        )
        // 每对必定一前一后，且左右都分到前枝，避免一侧被自身遮挡
        const zSide = (i + (side > 0 ? 1 : 0)) % 2 === 0 ? 1 : -1
        const lenMul = (1.22 - 0.42 * f) * (0.66 + rnd() * 0.6)
        const forkMul = (1.12 - 0.6 * f) * (0.8 + rnd() * 0.42)
        const spreadMul = 0.62 + rnd() * 0.95
        grow(parentCurve, tSide, side, zSide, side < 0 ? a : b, depth, pr0, pr1,
          lenMul * (0.86 + rnd() * 0.26), forkMul * spreadMul)
      }
    }
    if (hasApex) {
      grow(parentCurve, clamp(L.apexT + (rnd() * 2 - 1) * 0.012 * J, 0.2, 0.99), 0, 0, kids[mid], depth, pr0, pr1)
    }
  }

  function grow(
    parentCurve: THREE.CatmullRomCurve3, t: number, side: -1 | 0 | 1, zSign: number,
    node: TreeNode | undefined, depth: number, pr0: number, pr1: number,
    lenMul = 1, forkMul = 1,
  ) {
    if (!node) return
    const L = P.level[depth as 1 | 2]
    const p = parentCurve.getPointAt(t)
    const tan = parentCurve.getTangentAt(t).normalize()
    const pr = pr0 + (pr1 - pr0) * t

    // 承载名字的枝必须有最小直径，否则字读成"浮在枝外"
    // 枝径要撑得住字号：size 上限 = stemPx/1.30，0.175 的章枝在 1280 宽下约 22px，刚好到 17 号字
    const stemFloor = depth === 1 ? 0.155 : 0.128
    const r0 = Math.max(side === 0 ? pr * 0.96 : pr * L.rMul * (0.86 + rnd() * 0.12), stemFloor * 1.05)
    const r1 = Math.max(r0 * L.rTip * (side === 0 ? 0.9 : 1), stemFloor)

    const J = P.jitter
    const jit = (a: number) => (rnd() * 2 - 1) * a * J

    let dir: THREE.Vector3
    if (side === 0) {
      dir = tan.clone()
    } else {
      const fork = Math.min(66, Math.max(12, L.fork * forkMul + jit(12)))
      dir = tan.clone().multiplyScalar(Math.cos(rad(fork)))
        .addScaledVector(X_AXIS, side * Math.sin(rad(fork)))
        .addScaledVector(Z_AXIS, zSign * L.zOff * (0.55 + rnd() * 0.95))
        .add(new THREE.Vector3(jit(0.16), jit(0.09), jit(0.26)))
        .normalize()
      // 结构性偏冠：迎光侧压平外展，背侧抬起收拢；只改方向不改长度，不会把树顶高
      const lw = side > 0 ? P.lean : -P.lean * 0.78
      dir.x *= 1 + lw * 0.14
      dir.y *= 1 - lw * 0.13
      dir.normalize()
    }

    // 树冠分层：越低挂的枝越平展，越高挂的枝越上扬
    if (side !== 0) {
      const lift = 0.52 + 1.1 * t
      dir.y *= lift * 0.86
      dir.normalize()
    }
    const yFloor = depth === 1 ? 0.2 : 0.03
    if (dir.y < yFloor) {
      dir.y = yFloor
      dir.normalize()
    }

    const len = L.len * lenMul * (1 + jit(0.22))
    const bend = L.bend * (0.72 + rnd() * 0.62)
    const start = p.clone().addScaledVector(tan, -pr * (0.5 + rnd() * 0.3))
    const latAmp = depth === 1 ? 0.26 : 0.34
    const lat = side === 0
      ? len * 0.18 * (rnd() < 0.5 ? -1 : 1)
      : (rnd() < 0.5 ? -1 : 1) * len * latAmp * (0.5 + rnd() * 0.7)
    const curve = makeBentCurve(start, dir, len, bend, lat)

    // 纸签取枝中段偏梢：太靠根会和主干打架，太靠梢会飘出树冠
    const labelT = depth === 1 ? 0.56 : 0.78
    const labeled = depth === 1 || depth === 2

    branches.push({
      id: node.id,
      depth,
      curve,
      r0,
      r1,
      length: curve.getLength(),
      side,
      labelT,
      labelSpan: 0.12,
      labelSide: 1,
      labeled,
      labelRank: depth,
    })

    if (labeled) {
      anchors.push({ point: curve.getPointAt(labelT), r: depth === 1 ? 0.62 : 0.42 })
    }

    const kids = kidsOf(node)
    // 只长两层：根 → 章 → 知识点。再深的名字会挤成一团，由侧栏承担
    if (kids.length && depth < 2) sprout(curve, r0, r1, depth + 1, kids)
  }

  sprout(trunkCurve, TRUNK_R0, TRUNK_R1, 1, kidsOf(root))

  // ---- 骨架包围盒与冠形参数 ----
  const box = new THREE.Box3()
  let maxReach = 1
  {
    const p = new THREE.Vector3()
    for (const b of branches) {
      for (let i = 0; i <= 8; i++) {
        b.curve.getPointAt(i / 8, p)
        box.expandByPoint(p)
        maxReach = Math.max(maxReach, Math.hypot(p.x, p.z))
      }
    }
  }
  const crownTop = box.max.y + 0.9
  const crownBottom = Math.max(2.2, box.max.y * 0.3)
  const cy = (crownTop + crownBottom) * 0.5
  const ry = (crownTop - crownBottom) * 0.5

  // ---- 叶簇：每根枝自己长，左右叶量自然不同 ----
  const keepOut = (p: THREE.Vector3) => !anchors.some((a) => p.distanceTo(a.point) < a.r)

  function cluster(center: THREE.Vector3, radius: number, count: number, toneBias: number) {
    // 先回到变体页原值：叶量一旦过密，产品每帧要重绘的叶片和阴影都翻倍
    radius *= 0.72
    count = Math.max(6, Math.round(count * 0.62))
    const ga = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < count; i++) {
      const y = 1 - ((i + 0.5) / count) * 2
      const ring = Math.sqrt(Math.max(0, 1 - y * y))
      const theta = ga * i
      const shell = radius * (0.45 + 0.55 * Math.cbrt(rnd()))
      const p = center.clone().add(new THREE.Vector3(
        Math.cos(theta) * ring * shell,
        y * shell * 0.9 + (rnd() - 0.5) * 0.06,
        Math.sin(theta) * ring * shell,
      ))
      if (!keepOut(p)) continue
      leaves.push({
        pos: p,
        size: (0.82 + rnd() * 0.4) * LEAF_SCALE,
        quat: randomQuat(),
        tone: toneBias + rnd() * 0.25,
      })
    }
  }

  for (const b of branches) {
    if (!withLeaves) break
    if (b.depth === 0) continue
    const jx = (rnd() * 2 - 1) * 0.2
    const jz = (rnd() * 2 - 1) * 0.2
    if (b.depth === 1) {
      cluster(b.curve.getPointAt(0.3).add(new THREE.Vector3(jx, 0, jz)), 0.8, 20, 0.18)
      cluster(b.curve.getPointAt(0.55).add(new THREE.Vector3(-jx * 0.5, 0, -jz * 0.5)), 0.9, 24, 0.2)
      cluster(b.curve.getPointAt(0.8), 0.9, 24, 0.22)
      if (b.side === 0) {
        cluster(b.curve.getPointAt(1), 1.2, 42, 0.26)
        const topY = box.max.y
        for (const s of [-1, 1]) {
          cluster(b.curve.getPointAt(0.92).add(new THREE.Vector3(s * (0.9 + rnd() * 0.25), 0.8 + rnd() * 0.2, (rnd() * 2 - 1) * 0.45)), 1.05, 26, 0.24)
          cluster(new THREE.Vector3(s * (1.2 + rnd() * 0.3), topY * 0.87 + rnd() * 0.25, (rnd() * 2 - 1) * 0.5), 0.95, 22, 0.25)
          cluster(new THREE.Vector3(s * (0.55 + rnd() * 0.22), topY * 0.92 + rnd() * 0.2, (rnd() * 2 - 1) * 0.4), 0.78, 17, 0.26)
        }
        cluster(new THREE.Vector3(jx, topY * 0.93, jz), 0.72, 18, 0.25)
      }
      continue
    }
    if (b.depth === 2) {
      cluster(b.curve.getPointAt(0.12).add(new THREE.Vector3(jx * 0.6, 0, jz * 0.6)), 0.68, 18, 0.14)
      cluster(b.curve.getPointAt(0.32), 0.8, 22, 0.15)
      cluster(b.curve.getPointAt(0.52).add(new THREE.Vector3(-jx * 0.4, 0, -jz * 0.4)), 0.9, 28, 0.16)
      cluster(b.curve.getPointAt(0.72), 1.0, 34, 0.18)
      cluster(b.curve.getPointAt(0.9).add(new THREE.Vector3(jx * 0.3, 0, jz * 0.3)), 1.1, 40, 0.2)
      cluster(b.curve.getPointAt(1), 1.2, 45, 0.22)
      cluster(b.curve.getPointAt(1).add(new THREE.Vector3(0, 0, -0.5)), 0.78, 18, 0.2)
    }
  }

  // ---- 冠形归一化：把叶子收进椭球，避免个别簇飘到树冠外 ----
  let maxX = maxReach
  for (const l of leaves) maxX = Math.max(maxX, Math.abs(l.pos.x))
  const rx = maxX * 1.03
  const rz = rx * 0.85
  for (const l of leaves) {
    const ex = Math.hypot(l.pos.x, l.pos.z) / rx
    const ey = (l.pos.y - cy) / ry
    const d = Math.sqrt(ex * ex + ey * ey)
    if (d > 1) {
      const k = 1 / d
      l.pos.x *= k
      l.pos.z *= k
      l.pos.y = cy + (l.pos.y - cy) * k
    }
    const rr = Math.hypot(l.pos.x, l.pos.z)
    if (rr > rz) {
      const k = rz / rr
      l.pos.x *= k
      l.pos.z *= k
    }
  }

  const height = box.max.y
  const center = new THREE.Vector3(0, height * 0.5, 0)

  return {
    branches,
    twigs: [],
    leaves,
    anchors: anchors.map((a) => ({ id: '', depth: 2, point: a.point, radius: a.r })),
    height,
    radius: Math.max(maxReach, 1),
    center,
  }
}

function randomQuat() {
  const u = rnd(), v = rnd(), w = rnd()
  const q = new THREE.Quaternion(
    Math.sqrt(1 - u) * Math.sin(2 * Math.PI * v),
    Math.sqrt(1 - u) * Math.cos(2 * Math.PI * v),
    Math.sqrt(u) * Math.sin(2 * Math.PI * w),
    Math.sqrt(u) * Math.cos(2 * Math.PI * w),
  )
  return q.normalize()
}
