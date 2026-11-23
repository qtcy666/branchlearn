import * as THREE from 'three'
import type { NodeStatus } from '../types/tree'

/**
 * 沿枝刻字（变体页 labelPlans / updateLabels 的移植）。
 *
 * 和纸签方案的区别：
 *   · 纸签是"贴在枝旁边的便签"，字永远水平，树是背景；
 *   · 沿枝刻字是"名字本身长在枝上"，每个字按枝的走向旋转，
 *     章名占枝的内段、知识点占外段，父子天然分开。
 *
 * 为什么不用 3D 贴图烙字：枝半径 0.02–0.08，192px 贴图在屏幕上缩 5–8 倍，
 * 字一定糊。这里每个字都是真实 DOM，缩放到 12.5px 仍然锐利。
 *
 * 排版规则（缺一条就回到"字浮在枝外"）：
 *   1. 字号上限由脚下枝的屏幕直径决定（stemPx / 1.30），近粗远细；
 *   2. 整串按枝的弧长等距铺，靠梢右对齐，枝根让给父级章名；
 *   3. 字只保留 72% 倾角并封顶 ±38°，竖枝（中轴章）保持竖排；
 *   4. 知识点转到背面（相机 z 差 < -0.6）整串隐去，章名保留但降不透明度；
 *   5. 章名先占位，知识点只沿法线挪 3–6px 找空位，找不到就本帧不显示。
 */

export interface LabelBranch {
  id: string
  label: string
  kind: 'chapter' | 'point'
  curve: THREE.CatmullRomCurve3
  r0: number
  r1: number
  /** 中轴上的章名：竖排，字序从上往下 */
  vertical: boolean
  status: NodeStatus
  /** 所属章 id：目录悬停聚焦时用来判断"这一串该不该留" */
  chapterId: string
}

export interface BranchLabelsOptions {
  container: HTMLElement
  camera: THREE.Camera
  branches: LabelBranch[]
  /** 树冠中心，用来判前后与换算像素比例 */
  crown: THREE.Vector3
}

interface Glyph {
  ch: string
  el: HTMLSpanElement
  sx: number
  sy: number
  ang: number
  radius: number
  visible: boolean
}

interface GlyphString {
  pl: { isChapter: boolean; vertical: boolean; ref: LabelBranch }
  items: Glyph[]
  vis: number
  show: boolean
  size: number
  depthDbg: number
  ox: number
  oy: number
  baseCx: number
  baseCy: number
  halfW: number
  halfH: number
  nx: number
  ny: number
  area: number
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export function createBranchLabels(opts: BranchLabelsOptions) {
  const { container, camera, branches, crown } = opts

  const layer = document.createElement('div')
  layer.className = 't3d-glyphs'
  container.appendChild(layer)

  const strings: GlyphString[] = []
  for (const ref of branches) {
    const chars = Array.from((ref.label || '').replace(/\s+/g, ''))
    if (!chars.length) continue
    const isChapter = ref.kind === 'chapter'
    const items: Glyph[] = chars.map((ch) => {
      const el = document.createElement('span')
      el.className = 't3d-glyph'
      el.dataset.kind = isChapter ? 'chapter' : 'point'
      el.dataset.status = ref.status
      el.textContent = ch
      el.style.display = 'none'
      layer.appendChild(el)
      return { ch, el, sx: 0, sy: 0, ang: 0, radius: 0, visible: false }
    })
    strings.push({
      pl: { isChapter, vertical: ref.vertical, ref },
      items,
      vis: 0, show: false, size: 0, depthDbg: 0,
      ox: 0, oy: 0, baseCx: 0, baseCy: 0, halfW: 0, halfH: 0,
      nx: 0, ny: -1, area: 0,
    })
  }

  const _v = new THREE.Vector3()
  const _relCam = new THREE.Vector3()
  const _crownCam = new THREE.Vector3()

  const project = (p: THREE.Vector3, vw: number, vh: number) => {
    _v.copy(p).project(camera)
    return { x: (_v.x * 0.5 + 0.5) * vw, y: (-_v.y * 0.5 + 0.5) * vh, z: _v.z }
  }

  function update(focusChapter: string | null = null) {
    const vw = container.clientWidth
    const vh = container.clientHeight
    if (vw < 20 || vh < 20) return

    camera.updateMatrixWorld()
    const crownCam = _crownCam.copy(crown)
    camera.worldToLocal(crownCam)
    const crownDist = Math.max(1, camera.position.distanceTo(crown))
    const view = camera as THREE.PerspectiveCamera
    const pxPerUnit = vh / (2 * Math.tan((view.fov * Math.PI) / 360) * crownDist)
    // 窄面板（DeepWorks 内嵌约 290px 宽）：同时排满一章以上的串必然互相挤掉，
    // 改成"单章专注"——字可以比枝宽，只排聚焦章的知识点
    const narrow = vw < 720

    for (const s of strings) {
      s.show = false
      s.vis = 0
      s.ox = 0
      s.oy = 0
      s.baseCx = 0
      s.baseCy = 0
      s.halfW = 0
      s.halfH = 0
    }

    // ---- 1. 枝投影成折线，按弧长把字排上去 ----
    for (const s of strings) {
      const pl = s.pl.ref
      const n = s.items.length
      if (!n) continue

      // 窄幅是单章特写：画面里只有聚焦章这一片，其余章（含章名）整串跳过
      if (narrow && focusChapter) {
        const cid = s.pl.isChapter ? s.pl.ref.id : s.pl.ref.chapterId
        if (cid && cid !== focusChapter) continue
      }

      // 章名占枝的内段（靠主干），知识点占外段（靠梢）
      // 窄幅特写只有一根枝可用，段长直接决定能不能排下整串，所以放开到接近全枝
      const tA = narrow ? 0.12 : s.pl.isChapter ? (s.pl.vertical ? 0.3 : 0.14) : 0.4
      const tB = narrow ? 0.97 : s.pl.isChapter ? (s.pl.vertical ? 1.0 : 0.9) : 0.94

      const pts: { x: number; y: number; len: number }[] = []
      let total = 0
      let prev: { x: number; y: number } | null = null
      for (let k = 0; k <= 26; k++) {
        const t = tA + (tB - tA) * (k / 26)
        const q = project(pl.curve.getPointAt(t), vw, vh)
        if (prev) total += Math.hypot(q.x - prev.x, q.y - prev.y)
        pts.push({ x: q.x, y: q.y, len: total })
        prev = q
      }

      // 章名是"题字"，枝几乎笔直时用首尾连线整行排
      if (s.pl.isChapter && pts.length > 2) {
        const p0 = pts[0]
        const p1 = pts[pts.length - 1]
        const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y)
        if (chord > 4 && total / chord < 1.06) {
          pts.length = 0
          const N = 26
          for (let k = 0; k <= N; k++) {
            const f = k / N
            pts.push({ x: p0.x + (p1.x - p0.x) * f, y: p0.y + (p1.y - p0.y) * f, len: chord * f })
          }
          total = chord
        }
      }
      if (total < 4) continue

      const base = s.pl.isChapter ? 19.4 : 16.2
      const midR = pl.r0 + (pl.r1 - pl.r0) * 0.62
      const stemPx = 2 * midR * pxPerUnit
      // 1.12 而不是 1.30：枝直径收到与字同宽，字才像刻进枝条，而不是贴在木棒上的小签
      // 窄幅下允许字比枝宽（0.84），否则枝投到屏幕上只有十几像素，字会被压到读不出
      // 窄幅特写里枝被放大，字必须跟得上才读得出；这里不再用枝径上限，直接按可读性给
      let size = narrow
        ? Math.max(13, Math.min(base + 1, stemPx / 0.62))
        : Math.max(13, Math.min(base, stemPx / 1.12))
      let spacing = size * 1.16

      const need = spacing * (n - 1) + size * 0.9
      if (total < need) {
        const floor = narrow ? 10.4 : s.pl.isChapter ? 11.8 : 11.2
        size = Math.max(floor, Math.min(size, total / ((n - 1) * 1.16 + 0.9)))
        spacing = size * 1.16
        if (total < spacing * (n - 1) + size * 0.9) continue
      }

      // 靠梢右对齐：枝根留给父枝的章名
      const start = Math.max(0, total - spacing * (n - 1) - size * 0.3)

      const dirX = pts[pts.length - 1].x - pts[0].x
      const dirY = pts[pts.length - 1].y - pts[0].y
      const steep = Math.abs(dirY) > Math.abs(dirX) * 1.2
      const reverseOrder = dirX < 0 || (steep && dirY < 0)
      const order = reverseOrder ? s.items.slice().reverse() : s.items

      let k = 0
      for (let i = 0; i < n; i++) {
        const d = Math.min(total, start + i * spacing)
        while (k < pts.length - 1 && pts[k + 1].len < d) k++
        const a = pts[k]
        const b = pts[Math.min(k + 1, pts.length - 1)]
        const segLen = Math.max(0.0001, b.len - a.len)
        const f = clamp((d - a.len) / segLen, 0, 1)
        const x = a.x + (b.x - a.x) * f
        const y = a.y + (b.y - a.y) * f
        const dx = b.x - a.x
        const dy = b.y - a.y
        let ang = 0
        if (Math.hypot(dx, dy) > 0.5) {
          ang = (Math.atan2(dy, dx) * 180) / Math.PI
          while (ang > 90) ang -= 180
          while (ang < -90) ang += 180
          // 只有几乎完全竖立的枝才把字放正
          if (Math.abs(ang) > 84) ang = 0
        }
        const g = order[i]
        g.sx = x
        g.sy = y
        g.ang = ang
        g.radius = midR
        g.visible = true
      }

      // 整串沿法线向上侧让开枝干，字仍贴着枝
      {
        const dx0 = pts[pts.length - 1].x - pts[0].x
        const dy0 = pts[pts.length - 1].y - pts[0].y
        if (Math.hypot(dx0, dy0) > 1) {
          let nx = -dy0 / Math.hypot(dx0, dy0)
          let ny = dx0 / Math.hypot(dx0, dy0)
          if (ny > 0) {
            nx = -nx
            ny = -ny
          }
          const off = size * 0.02
          for (const g of s.items) {
            g.sx += nx * off
            g.sy += ny * off
          }
        }
      }

      // ---- 前后判断：相机局部 z 差 ----
      const worldMid = pl.curve.getPointAt(0.72)
      const relCam = _relCam.copy(worldMid)
      camera.worldToLocal(relCam)
      // 远处点 z 更负，减去树冠中心得到负值；< -0.6 才是真正被枝挡在后面的那一片
      const depth = relCam.z - crownCam.z
      // 知识点只在正面清晰时显示；章名任何视角都要齐
      let ok = true
      if (!s.pl.isChapter && depth < -0.6) ok = false

      s.vis = ok ? n : 0
      s.size = size
      s.depthDbg = depth

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const g of s.items) {
        if (!g.visible) continue
        const ra = s.pl.vertical ? g.ang : clamp(g.ang * 0.72, -38, 38)
        const rr = (ra * Math.PI) / 180
        const r = size * 0.5 * (Math.abs(Math.cos(rr)) + Math.abs(Math.sin(rr)))
        minX = Math.min(minX, g.sx - r)
        maxX = Math.max(maxX, g.sx + r)
        minY = Math.min(minY, g.sy - r)
        maxY = Math.max(maxY, g.sy + r)
      }
      s.baseCx = (minX + maxX) * 0.5
      s.baseCy = (minY + maxY) * 0.5
      s.halfW = (maxX - minX) * 0.5
      s.halfH = (maxY - minY) * 0.5
    }

    // ---- 2. 优先级避让：章名先占位，知识点只沿法线小挪 ----
    for (const s of strings) {
      if (!s.vis) continue
      let fx = 0, fy = 0, lx = 0, ly = 0
      let first = true
      for (const g of s.items) {
        if (!g.visible) continue
        if (first) {
          fx = g.sx
          fy = g.sy
          first = false
        }
        lx = g.sx
        ly = g.sy
      }
      const dx = lx - fx
      const dy = ly - fy
      const len = Math.hypot(dx, dy)
      if (len > 1) {
        s.nx = -dy / len
        s.ny = dx / len
      } else {
        s.nx = 0
        s.ny = -1
      }
      s.area = s.halfW * s.halfH
    }

    const ordered = strings
      .filter((s) => s.vis)
      .sort((a, b) => {
        if (a.pl.isChapter !== b.pl.isChapter) return a.pl.isChapter ? -1 : 1
        return a.area - b.area
      })

    const taken: { x: number; y: number; w: number; h: number }[] = []
    // 窄幅特写只有一根枝的范围，格点互斥会把所有串都判掉，直接关掉
    const CELL = narrow ? 100000 : 36
    const cells = new Set<string>()

    const boxOf = (s: GlyphString, ox: number, oy: number) => ({
      x: s.baseCx + ox - s.halfW - 5,
      y: s.baseCy + oy - s.halfH - 5,
      w: s.halfW * 2 + 10,
      h: s.halfH * 2 + 10,
    })
    const overlapOf = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => {
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      return ix > 0 && iy > 0 ? ix * iy : 0
    }

    // 章名：原位贴着各自的枝，不推离枝心；撞了就让位于更靠前的那串
    const chapters = ordered
      .filter((s) => s.pl.isChapter)
      .sort((a, b) => {
        const av = a.pl.vertical ? 1 : 0
        const bv = b.pl.vertical ? 1 : 0
        if (av !== bv) return bv - av
        return (b.depthDbg || 0) - (a.depthDbg || 0)
      })
    const points = ordered.filter((s) => !s.pl.isChapter)

    for (const s of chapters) {
      let bestOx = 0, bestOy = 0, bestCost = Infinity
      for (const t of [0, 4, -4, 8, -8]) {
        const box = boxOf(s, s.nx * t, s.ny * t)
        let cost = 0
        for (const b of taken) cost += overlapOf(box, b)
        if (cost < bestCost) {
          bestCost = cost
          bestOx = s.nx * t
          bestOy = s.ny * t
        }
        if (cost === 0) break
      }
      // 窄幅允许一点重叠（小于自身面积的四分之一），否则小画幅里永远排不满
      if (bestCost > 0 && bestCost > s.halfW * s.halfH * (narrow ? 0.3 : 0)) continue
      s.ox = bestOx
      s.oy = bestOy
      s.show = true
      taken.push(boxOf(s, bestOx, bestOy))
    }

    for (const s of points) {
      let bestOx = 0, bestOy = 0, bestCost = Infinity
      for (const t of [0, 3, -3, 6, -6, 9, -9]) {
        const ox = s.nx * t
        const oy = s.ny * t
        const box = boxOf(s, ox, oy)
        let cost = 0
        for (const b of taken) cost += overlapOf(box, b)
        if (cost < bestCost) {
          bestCost = cost
          bestOx = ox
          bestOy = oy
        }
        if (cost === 0) break
      }
      if (bestCost > 0 && bestCost > s.halfW * s.halfH * (narrow ? 0.5 : 0)) continue
      // 同一片区域最多一串知识点，避免小字堆成一团
      const key = `${Math.floor((s.baseCx + bestOx) / CELL)},${Math.floor((s.baseCy + bestOy) / CELL)}`
      if (cells.has(key)) continue
      cells.add(key)
      s.ox = bestOx
      s.oy = bestOy
      s.show = true
      taken.push(boxOf(s, bestOx, bestOy))
    }

    // ---- 3. 落到 DOM ----
    for (const s of strings) {
      if (!s.vis || !s.show) {
        for (const g of s.items) g.el.style.display = 'none'
        continue
      }
      const size = s.size
      for (const g of s.items) {
        if (!g.visible) {
          g.el.style.display = 'none'
          continue
        }
        const x = g.sx + s.ox
        const y = g.sy + s.oy
        g.el.style.display = 'block'
        g.el.style.fontSize = `${size.toFixed(1)}px`
        const baseOpacity = s.pl.isChapter && s.depthDbg < -0.6 ? 0.88 : 1
        // 目录悬停聚焦：只留这一章，其余压到背景里
        const dimmed = focusChapter !== null && s.pl.ref.chapterId !== focusChapter
        g.el.style.opacity = dimmed ? '0.1' : String(baseOpacity)
        g.el.style.zIndex = String(s.pl.isChapter ? 50 : 45)
        const rotAng = s.pl.vertical ? g.ang : clamp(g.ang * 0.72, -38, 38)
        g.el.style.transform =
          `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) rotate(${rotAng.toFixed(2)}deg) translateY(-0.16em)`
      }
    }

  }

  return {
    update,
    /** 本帧真正显示出来的章：目录据此标注"转动可见" */
    shownChapters(): Set<string> {
      const out = new Set<string>()
      for (const s of strings) if (s.pl.isChapter && s.show) out.add(s.pl.ref.id)
      return out
    },
    dispose() {
      layer.remove()
      strings.length = 0
    },
  }
}
