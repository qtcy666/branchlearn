import LZString from 'lz-string'
import type { Tree } from '../types/tree'
import { parseImportedTrees } from './storage'

const HASH_PREFIX = '#tree='

/** 分享链接的安全上限。超过这个长度，部分聊天软件会把链接截断。 */
export const MAX_SHARE_URL_LENGTH = 8000

export function encodeTree(tree: Tree): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(tree))
}

export function decodeTree(payload: string): Tree | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(payload)
    if (!json) return null
    const parsed: unknown = JSON.parse(json)
    const trees = parseImportedTrees(parsed)
    return trees[0] ?? null
  } catch {
    return null
  }
}

export function buildShareUrl(tree: Tree): string {
  const base = `${window.location.origin}${window.location.pathname}`
  return `${base}${HASH_PREFIX}${encodeTree(tree)}`
}

export function readSharePayload(): string | null {
  const hash = window.location.hash
  if (!hash.startsWith(HASH_PREFIX)) return null
  return hash.slice(HASH_PREFIX.length)
}

export function clearShareHash(): void {
  const { pathname, search } = window.location
  window.history.replaceState(null, '', `${pathname}${search}`)
}
