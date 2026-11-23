export type Route =
  | { view: 'landing' }
  | { view: 'home' }
  | { view: 'tree'; id: string }
  | { view: 'share'; payload: string }

const TREE_PREFIX = '#/tree/'
const SHARE_PREFIX = '#tree='

export function parseRoute(hash?: string): Route {
  // 允许显式传入 hash：无头渲染和测试环境下没有 window
  const value = hash ?? (typeof window === 'undefined' ? '' : window.location.hash)

  if (value.startsWith(SHARE_PREFIX)) {
    return { view: 'share', payload: value.slice(SHARE_PREFIX.length) }
  }

  if (value.startsWith(TREE_PREFIX)) {
    const raw = value.slice(TREE_PREFIX.length)
    if (raw) return { view: 'tree', id: decodeURIComponent(raw) }
  }

  return { view: 'landing' }
}

export function goLanding(): void {
  if (window.location.hash !== '#/') {
    window.location.hash = '#/'
  }
}

export function goHome(): void {
  // 回到课程列表时清掉 hash：刷新后仍会先看到初始页
  if (window.location.hash) {
    window.location.hash = ''
  }
}

export function goTree(id: string): void {
  const next = `${TREE_PREFIX}${encodeURIComponent(id)}`
  if (window.location.hash !== next) {
    window.location.hash = next
  }
}
