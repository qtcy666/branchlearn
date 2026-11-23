import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Tree, TreeNode } from '../types/tree'
import { displayStatus } from '../lib/status'
import {
  createTaperedTube,
  type TreeShape,
} from '../lib/tree3dLayout'
// 骨架换成变体页那套"逐枝偏冠"的生长规则，输出仍是产品自己的 TreeShape
import { buildTreeShape } from '../lib/tree3dShape'
// 文字从纸签改成沿枝刻字：每个字按枝的走向旋转，章名占内段、知识点占外段
import { createBranchLabels, type LabelBranch } from '../lib/branchLabels'
import { getBarkMaterial } from '../lib/ezTreeRig'

interface Props {
  tree: Tree
}

function makeContactShadowTexture(): THREE.Texture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.03, size / 2, size / 2, size * 0.5)
  g.addColorStop(0, 'rgba(40,44,32,0.5)')
  g.addColorStop(0.4, 'rgba(40,44,32,0.2)')
  g.addColorStop(1, 'rgba(40,44,32,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeGroundTintTexture(): THREE.Texture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.5)
  g.addColorStop(0, 'rgba(197, 217, 172, 0.85)')
  g.addColorStop(0.3, 'rgba(200, 220, 176, 0.55)')
  g.addColorStop(0.7, 'rgba(206, 224, 186, 0.18)')
  g.addColorStop(1, 'rgba(206, 224, 186, 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function disposeGeometries(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
  })
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export function Tree3D({ tree }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const groupRef = useRef<THREE.Group | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const rafRef = useRef<number | null>(null)
  const framedRef = useRef(false)
  // 视口比例变了要重新取景：只在挂载时定焦的话，窄窗口初始化后一直维持远景
  const reframeRef = useRef<(() => void) | null>(null)
  // 窄幅特写要知道当前聚焦哪一章，reframe 在另一个 effect 里，用 ref 传
  const focusRef = useRef<string | null>(null)
  const framedSizeRef = useRef(0)
  const sunRef = useRef<THREE.DirectionalLight | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  // 相机一变动就重投影文字；resize 在另一个 effect 里触发，用 ref 把绘制函数递过去
  const updateRef = useRef<(() => void) | null>(null)
  // 页首章节目录：树上一帧放不下/转到背面的章，在这里变淡标注
  const chaptersRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = null
    sceneRef.current = scene
    // 空气透视：只让最远的枝头略淡，近端 18 起步，树全在雾里会发灰
    scene.fog = new THREE.Fog(0xf2f7ec, 20, 52)

    const camera = new THREE.PerspectiveCamera(
      33,
      container.clientWidth / container.clientHeight,
      0.05,
      200,
    )
    camera.position.set(0, 3.6, 9.2)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.06
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // 只保留观察：旋转、缩放、平移。没有拾取、没有点击、没有拖拽节点。
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.075
    controls.rotateSpeed = 0.75
    controls.zoomSpeed = 0.85
    controls.panSpeed = 0.8
    controls.minDistance = 1.6
    controls.maxDistance = 30
    controls.minPolarAngle = Math.PI * 0.06
    controls.maxPolarAngle = Math.PI * 0.52
    controlsRef.current = controls

    // 天光偏冷 + 地面反弹偏暖；主光暖白，带出树皮的体积
    scene.add(new THREE.HemisphereLight(0xe8f3ff, 0x9a8f63, 1.15))

    const sun = new THREE.DirectionalLight(0xfff1d8, 2.2)
    sun.position.set(4.2, 9, 5.2)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.bias = -0.0008
    sun.shadow.normalBias = 0.02
    sun.shadow.radius = 3
    scene.add(sun)
    scene.add(sun.target)
    sunRef.current = sun

    const fill = new THREE.DirectionalLight(0xdceaff, 0.45)
    fill.position.set(-6, 3.5, -4)
    scene.add(fill)

    // 背光轮廓：树冠边缘一圈亮边，绿色才通透
    const rim = new THREE.DirectionalLight(0xfff8e6, 0.55)
    rim.position.set(-2.5, 5, -8)
    scene.add(rim)

    const group = new THREE.Group()
    scene.add(group)
    groupRef.current = group

    const onResize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      reframeRef.current?.()
      updateRef.current?.()
    }
    window.addEventListener('resize', onResize)

    const animate = () => {
      controls.update()
      renderer.render(scene, camera)
      rafRef.current = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', onResize)
      controls.dispose()
      disposeGeometries(group)
      renderer.dispose()
      renderer.domElement.remove()
      groupRef.current = null
      controlsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const group = groupRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current
    const container = containerRef.current
    const renderer = rendererRef.current
    if (!group || !camera || !controls || !container || !renderer) return

    disposeGeometries(group)
    group.clear()
    group.rotation.y = 0

    // 无叶子：名字直接刻在枝上，叶会遮住字，也会把"枝就是文字载体"这件事盖掉
    const shape: TreeShape = buildTreeShape(tree.root, { leaves: false })
    const barkMat = getBarkMaterial()

    // 雾距跟着树高走：新骨架树高约 9 个世界单位，旧的固定 20–52 会把冠顶吞掉
    const fog = sceneRef.current?.fog as THREE.Fog | null
    if (fog) {
      fog.near = shape.height * 2.4
      fog.far = shape.height * 7
    }

    const byId = new Map<string, TreeNode>()
    const parentOf = new Map<string, string>()
    const walk = (n: TreeNode) => {
      byId.set(n.id, n)
      for (const c of n.children) {
        parentOf.set(c.id, n.id)
        walk(c)
      }
    }
    walk(tree.root)
    // 往上数到 depth 1 的那一章：知识点要知道自己属于哪章
    const chapterOf = (id: string): string => {
      let cur = id
      for (let guard = 0; guard < 12; guard++) {
        const p = parentOf.get(cur)
        if (!p) return ''
        if (p === tree.root.id) return cur
        cur = p
      }
      return ''
    }

    // ---- 枝干 ----
    for (const branch of shape.branches) {
      const tubular = branch.depth === 0 ? 32 : branch.depth === 1 ? 22 : 12
      const radial = branch.depth === 0 ? 12 : branch.depth === 1 ? 10 : 6
      const mesh = new THREE.Mesh(
        createTaperedTube(branch.curve, branch.r0, branch.r1, tubular, radial),
        barkMat,
      )
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.add(mesh)

      // 接头处加一颗略大的球：子枝从父枝里"鼓"出来，不会留下生硬的 T 型截面
      if (branch.depth > 0) {
        const joint = new THREE.Mesh(
          new THREE.SphereGeometry(branch.r0 * 1.1, 10, 8),
          barkMat,
        )
        joint.position.copy(branch.curve.getPointAt(0))
        joint.castShadow = true
        group.add(joint)
      }

      const cap = new THREE.Mesh(new THREE.SphereGeometry(branch.r1 * 0.95, 8, 6), barkMat)
      cap.position.copy(branch.curve.getPointAt(1))
      cap.castShadow = true
      group.add(cap)
    }

    // ---- 叶片：这一版不建 ----
    // 名字要刻在枝上，叶子会从枝间长出来把字盖掉；变体页默认也是无叶枯枝。

    // ---- 地面与落影 ----
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.ShadowMaterial({ color: 0x6b5a3e, opacity: 0.07 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    group.add(ground)

    const tintTex = makeGroundTintTexture()
    const tint = new THREE.Mesh(
      new THREE.CircleGeometry(shape.radius * 3.0, 48),
      new THREE.MeshBasicMaterial({ map: tintTex, transparent: true, depthWrite: false }),
    )
    tint.rotation.x = -Math.PI / 2
    tint.position.y = -0.002
    group.add(tint)

    const contactTex = makeContactShadowTexture()
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(shape.radius * 2.0, shape.radius * 2.0),
      new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, opacity: 0.38, depthWrite: false }),
    )
    contact.rotation.x = -Math.PI / 2
    contact.position.y = 0.003
    group.add(contact)

    // ---- 取景 ----
    const size = Math.max(shape.height, shape.radius * 2)
    const vFov = (camera.fov * Math.PI) / 180
    const fitH = shape.height / (2 * Math.tan(vFov / 2))
    const fitW = (shape.radius * 2) / (2 * Math.tan(vFov / 2) * Math.max(camera.aspect, 0.30))
    // 1.22 的余量：树底留出根标题，树冠顶部留给出枝
    const dist = Math.max(fitH, fitW) * 1.02

    controls.minDistance = Math.max(1.2, size * 0.24)
    controls.maxDistance = size * 4.5

    const center = shape.center.clone()
    // 目标点抬高一点：树顶的竖排章名要给导航条让位，底部主干也不至于贴地被根纸签压住
    center.y += shape.height * 0.05
    // 机位略高于树冠中线：枯枝树的可读性靠"俯视一点"，正视会让枝叶叠成一条带
    const reframe = () => {
      const vF = (camera.fov * Math.PI) / 180
      const tanHalf = Math.tan(vF / 2)
      const narrow = container.clientWidth < 720
      let target = center.clone()
      let d: number

      // 窄面板：树冠宽是树高的两倍，全景在竖长画幅里只能到 14px/单位，字必然糊。
      // 改成单章特写——相机推到聚焦章那根枝上，字才有可读的像素。
      const chapterBranch = narrow && focusRef.current
        ? shape.branches.find((b) => b.depth === 1 && b.id === focusRef.current)
        : undefined
      if (chapterBranch) {
        const box = new THREE.Box3()
        for (let i = 0; i <= 10; i++) box.expandByPoint(chapterBranch.curve.getPointAt(i / 10))
        const sz = box.getSize(new THREE.Vector3())
        // 目标点取章枝外段（字主要在这里），而不是包围盒中心——中心会落到主干上
        target = chapterBranch.curve.getPointAt(0.62)
        // 只框章枝本身：子枝允许出画，否则横向范围翻倍，特写就白做了
        const halfH = Math.max(sz.y * 0.40, 0.95)
        const halfW = Math.max(sz.x * 0.55 + 0.4, 1.0)
        d = Math.max(halfH / tanHalf, halfW / (tanHalf * Math.max(camera.aspect, 0.3))) * 1.0
      } else {
        const fH = shape.height / (2 * tanHalf)
        const fW = (shape.radius * 2) / (2 * tanHalf * Math.max(camera.aspect, 0.3))
        d = Math.max(fH, fW) * 1.02
      }

      const dir = camera.position.clone().sub(controls.target)
      if (dir.lengthSq() < 1e-6) dir.set(0, 0.2, 1)
      dir.normalize()
      controls.target.copy(target)
      camera.position.copy(target).addScaledVector(dir, d)
      camera.lookAt(target)
      controls.update()
      camera.updateMatrixWorld(true)
    }
    reframeRef.current = reframe

    if (!framedRef.current || Math.abs(framedSizeRef.current - size) > 0.001) {
      camera.position.copy(center)
        .addScaledVector(new THREE.Vector3(0, 0.2, 1).normalize(), dist)
      camera.lookAt(center)
      framedRef.current = true
      framedSizeRef.current = size
    }
    controls.update()
    camera.updateMatrixWorld(true)
    group.updateMatrixWorld(true)

    // 阴影相机跟着树的大小走
    const s = Math.max(shape.height, shape.radius) * 1.3
    const sun = sunRef.current
    if (sun) {
      sun.target.position.copy(center)
      sun.position.set(center.x + s * 0.35, shape.height * 2.1, center.z + s * 0.6)
      sun.shadow.camera.near = 0.5
      sun.shadow.camera.far = shape.height * 4
      sun.shadow.camera.left = -s
      sun.shadow.camera.right = s
      sun.shadow.camera.top = s
      sun.shadow.camera.bottom = -s
      sun.shadow.camera.updateProjectionMatrix()
    }

    // ---------------------------------------------------------------- 沿枝刻字
    //
    // 名字不再是贴在枝边的纸签，而是长在枝上：每个字按枝的走向旋转，
    // 章名占枝的内段（靠主干）、知识点占外段（靠梢），父子天然分开。
    // 排版细节全部在 branchLabels.ts 里，和变体页是同一套规则。
    const labelList: LabelBranch[] = []
    for (const branch of shape.branches) {
      if (branch.depth === 0 || !branch.labeled) continue
      const node = byId.get(branch.id)
      if (!node) continue
      // 树上章名去掉"第X章"前缀：目录已经有 01–05 编号，
      // 留着前缀会让"第三章 初等变换与线性方程组"变成 12 个字，一根枝放不下只能整串放弃
      const raw = node.title.trim() || '未命名'
      const label = branch.depth === 1 ? raw.replace(/^第[一二三四五六七八九十]+章\s*/, '') || raw : raw
      labelList.push({
        id: node.id,
        label,
        kind: branch.depth === 1 ? 'chapter' : 'point',
        curve: branch.curve,
        r0: branch.r0,
        r1: branch.r1,
        // 中轴上的章名竖排，字从上往下读
        vertical: branch.depth === 1 && branch.side === 0,
        status: displayStatus(node),
        chapterId: chapterOf(node.id),
      })
    }

    const labels = createBranchLabels({
      container,
      camera,
      branches: labelList,
      crown: shape.center,
    })

    // 根标题：贴主干下部，不参与枝上避让
    const rootEl = document.createElement('div')
    rootEl.className = 't3d-label t3d-label--root'
    rootEl.dataset.depth = '0'
    rootEl.dataset.status = displayStatus(tree.root)
    rootEl.textContent = tree.root.title.trim() || '知识树'
    labelLayerFallback(container).appendChild(rootEl)

    // 目录悬停即聚焦：只留这一章的字，其余压到背景里
    // 窄面板没有可靠的悬停，点一下要能"锁住"当前章
    let focusChapter: string | null = null
    let manualFocus: string | null = null
    const navCleanup: Array<() => void> = []
    const navEl = chaptersRef.current
    if (navEl) {
      for (const span of Array.from(navEl.children)) {
        const el = span as HTMLElement
        const id = el.dataset.chapter || ''
        if (!id) continue
        const enter = () => {
          focusChapter = id
          focusRef.current = id
          reframeRef.current?.()
          updateRef.current?.()
        }
        const leave = () => {
          focusChapter = manualFocus
          const narrow = container.clientWidth < 720
          focusRef.current = focusChapter ?? (narrow ? (tree.root.children[0]?.id ?? null) : null)
          reframeRef.current?.()
          updateRef.current?.()
        }
        const pick = () => {
          manualFocus = id
          focusChapter = id
          focusRef.current = id
          reframeRef.current?.()
          updateRef.current?.()
        }
        el.addEventListener('pointerenter', enter)
        el.addEventListener('pointerleave', leave)
        el.addEventListener('click', pick)
        navCleanup.push(() => {
          el.removeEventListener('pointerenter', enter)
          el.removeEventListener('pointerleave', leave)
          el.removeEventListener('click', pick)
        })
      }
    }

    const tmpV = new THREE.Vector3()

    const update = () => {
      const vw = container.clientWidth
      const vh = container.clientHeight
      if (vw < 20 || vh < 20) return

      // 窄面板默认聚焦第一章：全栈同时排字在 290px 宽里只会剩下个位数
      container.classList.toggle('is-narrow', vw < 720)
      const autoFocus = focusChapter ?? (vw < 720 ? (manualFocus ?? tree.root.children[0]?.id ?? null) : null)
      if (focusRef.current !== autoFocus) {
        focusRef.current = autoFocus
        // 聚焦章变了要重新取景：窄幅特写的机位由 focusRef 决定
        reframeRef.current?.()
      }
      labels.update(autoFocus)

      // 根标题跟着主干走：横排放在主干下段，压住树脚
      camera.updateMatrixWorld()
      tmpV.set(0, 1.1, 0).project(camera)
      const rx = (tmpV.x * 0.5 + 0.5) * vw
      const ry = (-tmpV.y * 0.5 + 0.5) * vh
      // 窄幅特写里根纸签正好压在枝上，直接收起
      const hideRoot = vw < 720
      rootEl.style.opacity = hideRoot ? '0' : '1'
      rootEl.style.pointerEvents = hideRoot ? 'none' : ''
      const rw = rootEl.offsetWidth
      const rh = rootEl.offsetHeight
      rootEl.style.transform =
        `translate3d(${clamp(rx - rw / 2, 8, vw - 8 - rw).toFixed(1)}px, ${clamp(ry - rh / 2, 8, vh - 8 - rh).toFixed(1)}px, 0)`

      // 目录跟随：本帧没显示出来的章，标"转动可见"
      const shown = labels.shownChapters()
      if (navEl) {
        for (const span of Array.from(navEl.children)) {
          const el = span as HTMLElement
          const id = el.dataset.chapter || ''
          el.classList.toggle('on', autoFocus === id)
          el.classList.toggle('off', autoFocus !== null && autoFocus !== id)
          el.classList.toggle('back', id !== '' && !shown.has(id))
        }
      }
    }

    updateRef.current = update
    controls.addEventListener('change', update)
    update()

    // 取景后相机矩阵才最终确定，下一帧再校一次
    const raf = requestAnimationFrame(update)
    const raf2 = requestAnimationFrame(() => update())

    return () => {
      cancelAnimationFrame(raf)
      cancelAnimationFrame(raf2)
      controls.removeEventListener('change', update)
      for (const fn of navCleanup) fn()
      updateRef.current = null
      labels.dispose()
      rootEl.remove()
      contactTex.dispose()
      ;(contact.material as THREE.Material).dispose()
      contact.geometry.dispose()
      tintTex.dispose()
      tint.geometry.dispose()
      ;(tint.material as THREE.Material).dispose()
      ground.geometry.dispose()
      ;(ground.material as THREE.Material).dispose()
    }
  }, [tree])

  return (
    <div className="tree3d-wrap">
      <div ref={containerRef} className="tree3d" />
      <div ref={chaptersRef} className="tree3d-chapters" aria-label="章节目录">
        {tree.root.children.map((ch, i) => (
          <span key={ch.id} data-chapter={ch.id}>
            <b>{String(i + 1).padStart(2, '0')}</b>
            {ch.title.trim().replace(/^第[一二三四五六七八九十]+章\s*/, '') || '未命名'}
          </span>
        ))}
      </div>
      <div className="tree3d-hint">
        <span className="tree3d-hint-op">拖拽旋转 · 滚轮缩放 · 右键平移 · 悬停目录聚焦某章</span>
        <span className="tree3d-legend">
          <i className="legend-dot legend-dot--todo" />
          未开始
          <i className="legend-dot legend-dot--learning" />
          在学
          <i className="legend-dot legend-dot--done" />
          已掌握
        </span>
      </div>
    </div>
  )
}

/** 根标题需要一层绝对定位容器；沿枝字的层已经在 branchLabels 里建好了 */
function labelLayerFallback(container: HTMLElement): HTMLElement {
  let layer = container.querySelector<HTMLElement>('.t3d-root-layer')
  if (!layer) {
    layer = document.createElement('div')
    layer.className = 't3d-root-layer'
    container.appendChild(layer)
  }
  return layer
}
