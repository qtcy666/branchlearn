import * as THREE from 'three'
import { Tree, TreePreset } from '@dgreenheck/ez-tree'

/**
 * 从 ez-tree 借树皮贴图。
 *
 * 这个文件原来还带着一整套随机生成树的逻辑（buildTreeRig），
 * 但 3D 视图改成「按知识树数据长出枝干」之后，那套逻辑已经没有调用方了，
 * 只留下真正在用的材质组装。
 */

function barkOptions(seed: number): unknown {
  const preset = JSON.parse(JSON.stringify(TreePreset['Oak Large'])) as Record<string, unknown>
  return {
    ...preset,
    seed,
    // 只要树皮贴图，枝叶参数随便给，生成完就丢弃
  }
}

/** 复用 ez-tree 的真实树皮材质（含颜色/法线/凹凸贴图）。 */
let cachedBarkMaterial: THREE.Material | null = null

export function getBarkMaterial(): THREE.Material {
  if (cachedBarkMaterial) return cachedBarkMaterial

  const tree = new Tree(barkOptions(20241118) as never)
  tree.generate()
  const source = tree.branchesMesh.material as THREE.MeshPhongMaterial

  // 颜色走均匀暖棕，质感交给法线/凹凸：枝干不花，刻上去的字才读得清。
  // 法线强度抬到 1.0、凹凸抬到 0.055 —— 旧版太温吞，远看就是一根光滑的管子。
  const material = new THREE.MeshStandardMaterial({
    // 枝色再提亮一档：字是深墨压在枝上，枝太深会把笔画吃掉
    color: 0xc2a078,
    roughness: 0.9,
    metalness: 0,
    normalMap: source.normalMap,
    normalScale: source.normalScale ? source.normalScale.clone().multiplyScalar(0.75) : new THREE.Vector2(1, 1),
    bumpMap: source.map,
    // 木纹压到 0.02：深色纹路会和深墨字混在一起，字就发虚
    bumpScale: 0.02,
  })

  const tuneRepeat = (texture?: THREE.Texture | null) => {
    if (!texture) return
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(3, 1)
    texture.needsUpdate = true
  }
  tuneRepeat(material.normalMap)
  tuneRepeat(material.bumpMap)

  tree.branchesMesh.geometry.dispose()
  tree.leavesMesh.geometry.dispose()

  cachedBarkMaterial = material
  return material
}
